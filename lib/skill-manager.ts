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
    downloadFile,
    fetchSkillsIndex,
    findSkillIndexEntry,
    getSkillPackageUrl,
    normalizeSkillIndexKey
} from './network';
import {
    copySkillFiles,
    listInstalledSkillNames,
    normalizeCliSkillArgument,
    normalizeSkillName,
    pruneInstallState,
    readInstallState,
    removeInstalledSkill,
    updateInstallState
} from './state';
import { ensureDirectoryExists, executeCommand } from './system';
import { extractZip, resolveSkillRoot } from './unzip';
import type {
    DownloadOptions,
    DownloadResult,
    RemoveInstalledSkillResult,
    SkillIndexEntry,
    UpdateAllOptions,
    UpdateAllResult
} from './types';

export interface FetchSkillToCacheResult {
    repoPath: string;
    cachePath: string;
    entry: SkillIndexEntry;
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
    const entry = await findSkillIndexEntry(normalizedSkillName);
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

    const localSkillName = normalizeSkillName(normalizedSkillName);
    const cachePath = path.join(cacheDir, localSkillName);
    const zipPath = path.join(cacheDir, `${localSkillName}.zip`);
    const downloadUrl = getSkillPackageUrl(entry);

    logger.info(`下载技能包: ${downloadUrl}`);
    const receivedBytes = await downloadFile(downloadUrl, zipPath);
    logger.info(`下载完成 (${receivedBytes} bytes)，正在解压...`);

    if (fs.existsSync(cachePath)) {
        fs.rmSync(cachePath, { recursive: true, force: true });
    }
    ensureDirectoryExists(cachePath);

    extractZip(zipPath, cachePath);
    fs.rmSync(zipPath, { force: true });

    const repoPath = resolveSkillRoot(cachePath);
    logger.info(`技能包已解压: ${repoPath}`);
    return { repoPath, cachePath, entry };
}

export async function cloneOrUpdateRepo(
    skillName: string,
    options: DownloadOptions = {}
): Promise<string> {
    const { repoPath } = await fetchSkillToCache(skillName, options);
    return repoPath;
}

/**
 * 安装/更新后的可选 Agent 重载钩子。
 * 仅当 Agent 预设定义了重启命令，或设置了 `GETSKILL_RESTART_CMD` 时才执行。
 */
export async function restartAgentGateway(): Promise<void> {
    const restartCommand = getAgentRestartCommand();

    if (!restartCommand) {
        return;
    }

    logger.info(`尝试执行: ${restartCommand}`);

    try {
        await executeCommand(restartCommand);
        logger.info('Agent 服务重启成功，新技能应已生效。');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
            `自动执行 "${restartCommand}" 失败，请手动重启 Agent 以加载新技能。`
        );
        logger.warn(`失败原因: ${message}`);
    }
}

export async function downloadSkill(
    skillName: string,
    options: DownloadOptions = {}
): Promise<DownloadResult> {
    assertExplicitSkillsDir();
    logger.info(`下载技能: ${skillName}...`);
    const normalizedSkillName = normalizeCliSkillArgument(skillName);
    const requestedVersion = options.version?.trim();

    const entry = await findSkillIndexEntry(normalizedSkillName);
    if (!entry) {
        throw new GetSkillError(
            'SKILL_NOT_FOUND',
            `技能不存在: ${normalizedSkillName}，请先使用 getskill search <关键词> 查询可用技能`
        );
    }
    assertVersionAvailable(entry, requestedVersion);

    // 同版本已安装时跳过重复下载（--force 可强制重装）
    const localSkillName = normalizeSkillName(normalizedSkillName);
    const skillDir = path.join(getSkillsDirectory(), localSkillName);
    const record = readInstallState().skills[localSkillName];
    if (
        options.force !== true &&
        record &&
        record.version &&
        record.version === entry.version &&
        fs.existsSync(skillDir)
    ) {
        logger.info(
            `技能 ${normalizedSkillName} 已安装且为最新版本 (${entry.version})，跳过重复安装。如需强制重装请使用 --force`
        );
        return {
            skillName: normalizedSkillName,
            repoPath:
                record.repoPath ||
                path.join(getSkillsCacheDirectory(), localSkillName),
            files: [skillDir],
            requestedVersion: requestedVersion || null,
            version: entry.version,
            upToDate: true
        };
    }

    const { repoPath } = await fetchSkillToCache(normalizedSkillName, {
        version: requestedVersion
    });
    const copiedFiles = copySkillFiles(repoPath, normalizedSkillName);
    await updateInstallState(
        normalizedSkillName,
        repoPath,
        copiedFiles[0],
        'install',
        requestedVersion,
        entry.version
    );

    logger.info(`技能 ${normalizedSkillName} (v${entry.version}) 安装成功！`);
    return {
        skillName: normalizedSkillName,
        repoPath,
        files: copiedFiles,
        requestedVersion: requestedVersion || null,
        version: entry.version
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

    const localSkillName = normalizeSkillName(normalizedSkillName);
    const skillDir = path.join(getSkillsDirectory(), localSkillName);
    const cachePath = path.join(getSkillsCacheDirectory(), localSkillName);
    const record = readInstallState().skills[localSkillName];

    if (
        record &&
        record.version &&
        record.version === entry.version &&
        fs.existsSync(skillDir)
    ) {
        logger.info(
            `技能 ${normalizedSkillName} 已是最新版本 (${entry.version})，无需更新`
        );
        return {
            skillName: normalizedSkillName,
            repoPath: record.repoPath || cachePath,
            files: [skillDir],
            requestedVersion: requestedVersion || null,
            version: entry.version,
            upToDate: true
        };
    }

    if (record) {
        logger.info(
            `发现新版本: ${record.version || 'unknown'} -> ${entry.version}`
        );
    }

    const { repoPath } = await fetchSkillToCache(normalizedSkillName, {
        version: requestedVersion
    });
    const copiedFiles = copySkillFiles(repoPath, normalizedSkillName);
    await updateInstallState(
        normalizedSkillName,
        repoPath,
        copiedFiles[0],
        'update',
        requestedVersion,
        entry.version
    );

    logger.info(`技能 ${normalizedSkillName} 更新成功！`);
    return {
        skillName: normalizedSkillName,
        repoPath,
        files: copiedFiles,
        requestedVersion: requestedVersion || null,
        version: entry.version
    };
}

export async function updateAllSkills(
    options: UpdateAllOptions = {}
): Promise<UpdateAllResult[]> {
    assertExplicitSkillsDir();
    const installedSkills = listInstalledSkillNames();
    const results: UpdateAllResult[] = [];

    if (installedSkills.length === 0) {
        return results;
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

    for (const skillName of installedSkills) {
        const missingInIndex = Boolean(
            indexKeys && !indexKeys.has(normalizeSkillIndexKey(skillName))
        );

        if (missingInIndex) {
            staleSkillNames.push(skillName);
            results.push({
                skillName,
                ok: false,
                skipped: true,
                error: '技能索引中已不存在该技能（历史安装记录失效）'
            });
            continue;
        }

        try {
            const result = await updateSkill(skillName);
            results.push({ skillName, ok: true, result });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            const skipped =
                getErrorCode(error) === 'SKILL_NOT_FOUND' ||
                message.includes('技能不存在');
            if (skipped) {
                staleSkillNames.push(skillName);
            }
            results.push({ skillName, ok: false, skipped, error: message });
        }
    }

    if (options.prune && staleSkillNames.length > 0) {
        const pruned = pruneInstallState(staleSkillNames);
        if (pruned.length > 0) {
            logger.info(`已清理失效安装记录: ${pruned.join(', ')}`);
        }
    }

    return results;
}

export async function uninstallSkill(
    skillName: string,
    options: { removeCache?: boolean } = {}
): Promise<RemoveInstalledSkillResult> {
    // 与 install/update 相同的安全门禁：避免误删非当前 Agent 目录下的技能
    assertExplicitSkillsDir();
    const result = removeInstalledSkill(skillName, options);
    logger.info(`已卸载技能目录: ${result.skillDir}`);
    if (result.removedCache) {
        logger.info(`已移除缓存仓库: ${result.repoPath}`);
    }

    return result;
}
