import fs from 'fs';
import path from 'path';

import {
    assertExplicitSkillsDir,
    getAgentRestartCommand,
    getSkillsCacheDirectory,
    getSkillsDirectory
} from './config';
import logger from './logger';
import { GetSkillError, getErrorCode } from './errors';
import {
    assertPackageUrlAllowed,
    downloadFile,
    fetchSkillsIndex,
    findSkillIndexEntry,
    getSkillPackageUrl,
    normalizeSkillIndexKey
} from './network';
import {
    computeSkillDirHash,
    copySkillFiles,
    listInstalledSkillNames,
    normalizeCliSkillArgument,
    pruneInstallState,
    readInstallState,
    recordMatchesCurrentSkillsDir,
    removeInstalledSkill,
    resolveLocalSkillName,
    updateInstallState,
    withStateLockAsync
} from './state';
import { ensureDirectoryExists, executeCommand } from './system';
import { extractZip, resolveSkillRoot } from './unzip';
import { compareVersions } from './version';
import type {
    DownloadOptions,
    DownloadResult,
    RemoveInstalledSkillResult,
    SkillIndexEntry,
    SkillStateRecord,
    UpdateAllOptions,
    UpdateAllResult
} from './types';

export interface FetchSkillToCacheResult {
    repoPath: string;
    cachePath: string;
    entry: SkillIndexEntry;
    warnings: string[];
}

function assertVersionAvailable(
    entry: SkillIndexEntry,
    requestedVersion?: string
): void {
    if (!requestedVersion) {
        return;
    }

    if (requestedVersion !== entry.version) {
        throw new GetSkillError(
            'VERSION_NOT_AVAILABLE',
            `技能 ${entry.id} 不提供版本 ${requestedVersion}，站点当前仅提供最新版本 ${entry.version}`
        );
    }
}

export async function fetchSkillToCache(
    skillName: string,
    options: DownloadOptions = {}
): Promise<FetchSkillToCacheResult> {
    const normalizedSkillName = normalizeCliSkillArgument(skillName);
    const entry = await findSkillIndexEntry(normalizedSkillName, {
        forceRefresh: options.refresh === true
    });
    if (!entry) {
        throw new GetSkillError(
            'SKILL_NOT_FOUND',
            `技能不存在: ${normalizedSkillName}，请先使用 getskill search <关键词> 查询可用技能`
        );
    }

    const requestedVersion = options.version?.trim();
    assertVersionAvailable(entry, requestedVersion);

    const cacheDir = getSkillsCacheDirectory();
    ensureDirectoryExists(cacheDir);

    // 缓存目录与安装目录使用同一规范名（entry.id 解析出的本地名）
    const localSkillName = resolveLocalSkillName(entry.id);
    const cachePath = path.join(cacheDir, localSkillName);
    // H4：唯一临时 zip/解压目录名，同技能并发安装不再互踩
    const uniqueSuffix = `${process.pid}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;
    const zipPath = path.join(
        cacheDir,
        `${localSkillName}.zip.tmp-${uniqueSuffix}`
    );
    const tempExtractDir = path.join(
        cacheDir,
        `${localSkillName}.tmp-${uniqueSuffix}`
    );
    const downloadUrl = getSkillPackageUrl(entry);
    assertPackageUrlAllowed(downloadUrl);

    const warnings: string[] = [];
    logger.info(`下载技能包: ${downloadUrl}`);
    const receivedBytes = await downloadFile(downloadUrl, zipPath);
    if (
        typeof entry.size === 'number' &&
        entry.size > 0 &&
        receivedBytes !== entry.size
    ) {
        const message = `技能包体积与索引声明不一致（声明 ${entry.size} bytes，实际 ${receivedBytes} bytes）: ${entry.id}`;
        logger.warn(message);
        warnings.push(message);
    }
    logger.info(`下载完成 (${receivedBytes} bytes)，正在解压...`);

    try {
        ensureDirectoryExists(tempExtractDir);
        extractZip(zipPath, tempExtractDir);
    } catch (error) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
        throw error;
    } finally {
        fs.rmSync(zipPath, { force: true });
    }

    // 解压成功后再替换规范缓存目录；并发替换失败时重试一次
    if (fs.existsSync(cachePath)) {
        fs.rmSync(cachePath, { recursive: true, force: true });
    }
    try {
        fs.renameSync(tempExtractDir, cachePath);
    } catch {
        fs.rmSync(cachePath, { recursive: true, force: true });
        fs.renameSync(tempExtractDir, cachePath);
    }

    const repoPath = resolveSkillRoot(cachePath);
    logger.info(`技能包已解压: ${repoPath}`);
    return { repoPath, cachePath, entry, warnings };
}

export async function cloneOrUpdateRepo(
    skillName: string,
    options: DownloadOptions = {}
): Promise<string> {
    const { repoPath } = await fetchSkillToCache(skillName, options);
    return repoPath;
}

export interface RestartAgentResult {
    /** 是否配置了重载命令（预设或 GETSKILL_RESTART_CMD）。 */
    attempted: boolean;
    /** 命令是否执行成功（未配置时为 false）。 */
    ok: boolean;
    command: string | null;
}

/**
 * 安装/更新后的可选 Agent 重载钩子。
 * 仅当 Agent 预设定义了重启命令，或设置了 `GETSKILL_RESTART_CMD` 时才执行。
 */
export async function restartAgentGateway(): Promise<RestartAgentResult> {
    const restartCommand = getAgentRestartCommand();

    if (!restartCommand) {
        return { attempted: false, ok: false, command: null };
    }

    logger.info(`尝试执行: ${restartCommand}`);

    try {
        await executeCommand(restartCommand);
        logger.info('Agent 服务重启成功，新技能应已生效。');
        return { attempted: true, ok: true, command: restartCommand };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
            `自动执行 "${restartCommand}" 失败，请手动重启 Agent 以加载新技能。`
        );
        logger.warn(`失败原因: ${message}`);
        return { attempted: true, ok: false, command: restartCommand };
    }
}

/** 覆盖安装前检测本地内容是否被修改过（与安装时记录的哈希对比）。 */
function detectLocalModification(
    record: SkillStateRecord | undefined,
    skillDir: string
): boolean {
    if (!record?.contentHash || !fs.existsSync(skillDir)) {
        return false;
    }
    const currentHash = computeSkillDirHash(skillDir);
    const modified = currentHash !== null && currentHash !== record.contentHash;
    if (modified) {
        logger.warn(
            `检测到本地修改: ${skillDir} 的内容与安装时记录不一致，本次安装/更新将覆盖本地改动`
        );
    }
    return modified;
}

/**
 * S2（安装/更新侧）：无安装记录的手工技能目录默认拒绝覆盖，需 --force 显式确认。
 * 与 uninstall 的 UNMANAGED_SKILL 保护对称，防止远端内容静默覆盖手工放置的技能。
 */
function assertManagedOrForced(
    skillDir: string,
    record: SkillStateRecord | undefined,
    force: boolean | undefined
): void {
    const managed = Boolean(record && recordMatchesCurrentSkillsDir(record));
    if (fs.existsSync(skillDir) && !managed && force !== true) {
        throw new GetSkillError(
            'UNMANAGED_SKILL',
            `技能目录 ${skillDir} 已存在且不由 getskill 管理（无安装记录），为保护手工放置的内容已拒绝覆盖。确认覆盖请使用 --force，或先手动清理该目录`
        );
    }
}

/** 「复制技能文件 + 写 state」整体持锁，避免并发安装互相覆盖。 */
async function installFromCache(
    canonicalName: string,
    repoPath: string,
    action: 'install' | 'update',
    requestedVersion: string | undefined,
    version: string
): Promise<{ files: string[]; warnings: string[] }> {
    return withStateLockAsync(async () => {
        const warnings: string[] = [];
        const copiedFiles = copySkillFiles(repoPath, canonicalName, warnings);
        const contentHash = computeSkillDirHash(copiedFiles[0]);
        await updateInstallState(
            canonicalName,
            repoPath,
            copiedFiles[0],
            action,
            requestedVersion,
            version,
            contentHash
        );
        return { files: copiedFiles, warnings };
    });
}

export async function downloadSkill(
    skillName: string,
    options: DownloadOptions = {}
): Promise<DownloadResult> {
    assertExplicitSkillsDir();
    logger.info(`下载技能: ${skillName}...`);
    const normalizedSkillName = normalizeCliSkillArgument(skillName);
    const requestedVersion = options.version?.trim();

    const entry = await findSkillIndexEntry(normalizedSkillName, {
        forceRefresh: options.refresh === true
    });
    if (!entry) {
        throw new GetSkillError(
            'SKILL_NOT_FOUND',
            `技能不存在: ${normalizedSkillName}，请先使用 getskill search <关键词> 查询可用技能`
        );
    }
    assertVersionAvailable(entry, requestedVersion);

    // 规范名：以索引 entry.id 为准解析本地目录/state 键，
    // 保证 install PDF-Toolkit 与 uninstall pdf-toolkit 指向同一技能。
    const canonicalName = resolveLocalSkillName(entry.id);
    const skillDir = path.join(getSkillsDirectory(), canonicalName);
    const record = readInstallState().skills[canonicalName];
    assertManagedOrForced(skillDir, record, options.force);

    // 本地版本不低于站点版本时跳过（semver 比较，避免误降级）；
    // 显式 --version 时按精确版本判断，--force 强制重装。
    const alreadySatisfied =
        Boolean(record?.version) &&
        fs.existsSync(skillDir) &&
        (requestedVersion
            ? record?.version === requestedVersion
            : compareVersions(
                  record?.version as string,
                  entry.version || '0'
              ) >= 0);

    if (options.force !== true && alreadySatisfied) {
        logger.info(
            `技能 ${entry.id} 已安装且版本不低于站点版本 (${record?.version})，跳过重复安装。如需强制重装请使用 --force`
        );
        return {
            skillName: entry.id,
            repoPath:
                record?.repoPath ||
                path.join(getSkillsCacheDirectory(), canonicalName),
            files: [skillDir],
            requestedVersion: requestedVersion || null,
            version: record?.version || entry.version,
            upToDate: true,
            warnings: []
        };
    }

    const localModified = detectLocalModification(record, skillDir);
    const { repoPath, warnings: fetchWarnings } = await fetchSkillToCache(
        entry.id,
        { version: requestedVersion }
    );
    const { files: copiedFiles, warnings: installWarnings } =
        await installFromCache(
            canonicalName,
            repoPath,
            'install',
            requestedVersion,
            entry.version
        );

    logger.info(`技能 ${entry.id} (v${entry.version}) 安装成功！`);
    return {
        skillName: entry.id,
        repoPath,
        files: copiedFiles,
        requestedVersion: requestedVersion || null,
        version: entry.version,
        localModified,
        warnings: [...fetchWarnings, ...installWarnings]
    };
}

export async function updateSkill(
    skillName: string,
    options: DownloadOptions = {}
): Promise<DownloadResult> {
    assertExplicitSkillsDir();
    const normalizedSkillName = normalizeCliSkillArgument(skillName);
    const requestedVersion = options.version?.trim();
    logger.info(`正在更新技能: ${normalizedSkillName}...`);

    // update 语义是检查在线最新版本，强制刷新索引（每进程最多一次下载）
    const entry = await findSkillIndexEntry(normalizedSkillName, {
        forceRefresh: true
    });
    if (!entry) {
        throw new GetSkillError(
            'SKILL_NOT_FOUND',
            `技能不存在: ${normalizedSkillName}，无法更新`
        );
    }
    assertVersionAvailable(entry, requestedVersion);

    const canonicalName = resolveLocalSkillName(entry.id);
    const skillDir = path.join(getSkillsDirectory(), canonicalName);
    const cachePath = path.join(getSkillsCacheDirectory(), canonicalName);
    const record = readInstallState().skills[canonicalName];
    assertManagedOrForced(skillDir, record, options.force);

    // semver 比较：本地版本不低于站点版本即视为最新（不静默降级）；
    // 显式 --version 指定旧版本时才允许降级。
    const alreadyLatest =
        Boolean(record?.version) &&
        fs.existsSync(skillDir) &&
        (requestedVersion
            ? record?.version === requestedVersion
            : compareVersions(
                  record?.version as string,
                  entry.version || '0'
              ) >= 0);

    if (alreadyLatest) {
        logger.info(
            `技能 ${entry.id} 已是最新版本 (${record?.version})，无需更新`
        );
        return {
            skillName: entry.id,
            repoPath: record?.repoPath || cachePath,
            files: [skillDir],
            requestedVersion: requestedVersion || null,
            version: record?.version || entry.version,
            upToDate: true,
            warnings: []
        };
    }

    if (record) {
        logger.info(
            `发现新版本: ${record.version || 'unknown'} -> ${entry.version}`
        );
    }

    const localModified = detectLocalModification(record, skillDir);
    const { repoPath, warnings: fetchWarnings } = await fetchSkillToCache(
        entry.id,
        { version: requestedVersion }
    );
    const { files: copiedFiles, warnings: installWarnings } =
        await installFromCache(
            canonicalName,
            repoPath,
            'update',
            requestedVersion,
            entry.version
        );

    logger.info(`技能 ${entry.id} 更新成功！`);
    return {
        skillName: entry.id,
        repoPath,
        files: copiedFiles,
        requestedVersion: requestedVersion || null,
        version: entry.version,
        localModified,
        warnings: [...fetchWarnings, ...installWarnings]
    };
}

export async function updateAllSkills(
    options: UpdateAllOptions = {}
): Promise<{ results: UpdateAllResult[]; pruned: string[] }> {
    assertExplicitSkillsDir();
    const installedSkills = listInstalledSkillNames();
    const results: UpdateAllResult[] = [];

    if (installedSkills.length === 0) {
        return { results, pruned: [] };
    }

    // 一次性拉取最新索引，用于识别已下架/改名的历史安装记录
    let indexKeys: Set<string> | null = null;
    try {
        const entries = await fetchSkillsIndex({ forceRefresh: true });
        indexKeys = new Set<string>();
        entries.forEach((entry) => {
            indexKeys?.add(normalizeSkillIndexKey(entry.id));
            if (entry.name) {
                indexKeys?.add(normalizeSkillIndexKey(entry.name));
            }
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`技能索引获取失败，将逐个尝试更新: ${message}`);
    }

    const staleSkillNames: string[] = [];
    const state = readInstallState();

    for (const skillName of installedSkills) {
        const missingInIndex = Boolean(
            indexKeys && !indexKeys.has(normalizeSkillIndexKey(skillName))
        );

        // 记录存在但安装目录被手动删除 → 标记 missing 跳过，不静默“复活”重装；
        // 若索引中也已下架，则记录彻底失效，归入 stale 以便 --prune 清理
        const localName = resolveLocalSkillName(skillName);
        const record = state.skills[localName];
        if (record && record.installDir && !fs.existsSync(record.installDir)) {
            if (missingInIndex) {
                staleSkillNames.push(skillName);
                results.push({
                    skillName,
                    ok: false,
                    skipped: true,
                    status: 'stale',
                    error: '安装目录已不存在且技能索引中已下架（记录失效，--prune 可清理）'
                });
            } else {
                results.push({
                    skillName,
                    ok: false,
                    skipped: true,
                    status: 'missing',
                    error: '安装目录已不存在（可能被手动删除），已跳过；如需恢复请执行 getskill install <技能名称>'
                });
            }
            continue;
        }

        if (missingInIndex) {
            staleSkillNames.push(skillName);
            results.push({
                skillName,
                ok: false,
                skipped: true,
                status: 'stale',
                error: '技能索引中已不存在该技能（历史安装记录失效）'
            });
            continue;
        }

        try {
            const result = await updateSkill(skillName, {
                force: options.force
            });
            results.push({
                skillName,
                ok: true,
                status: result.upToDate ? 'up_to_date' : 'updated',
                version: result.version ?? null,
                result
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            const code = getErrorCode(error);
            const skipped =
                code === 'SKILL_NOT_FOUND' || message.includes('技能不存在');
            if (skipped) {
                staleSkillNames.push(skillName);
            }
            results.push({
                skillName,
                ok: false,
                skipped,
                status: skipped ? 'stale' : 'failed',
                error: message,
                code
            });
        }
    }

    let pruned: string[] = [];
    if (options.prune && staleSkillNames.length > 0) {
        pruned = pruneInstallState(staleSkillNames);
        if (pruned.length > 0) {
            logger.info(`已清理失效安装记录: ${pruned.join(', ')}`);
        }
    }

    return { results, pruned };
}

export async function uninstallSkill(
    skillName: string,
    options: { removeCache?: boolean; force?: boolean } = {}
): Promise<RemoveInstalledSkillResult> {
    // 与 install/update 相同的安全门禁：避免误删非当前 Agent 目录下的技能
    assertExplicitSkillsDir();
    const result = removeInstalledSkill(skillName, options);
    if (result.removedInstall) {
        logger.info(`已卸载技能目录: ${result.skillDir}`);
    }
    if (result.removedCache) {
        logger.info(`已移除缓存仓库: ${result.repoPath}`);
    }
    if (!result.removedInstall && !result.removedCache) {
        logger.info(
            `技能 ${result.localSkillName} 未安装（技能目录与缓存均不存在），无需卸载`
        );
    }

    return result;
}
