import fs from 'fs';
import path from 'path';

import {
    MAX_COPY_FILE_SIZE_BYTES,
    getAgentLabel,
    getAgentName,
    getLegacyStateFilePaths,
    getSkillsCacheDirectory,
    getSkillsDirectory,
    getStateFilePath,
    isSamePath
} from './config';
import logger from './logger';
import { GetSkillError } from './errors';
import { ensureDirectoryExists } from './system';
import type {
    InstalledSkillSnapshot,
    InstallState,
    InstalledSkillInfo,
    RemoveInstalledSkillResult,
    SkillStateRecord
} from './types';
import { resolveSkillRoot } from './unzip';

export function normalizeSkillName(skillName: string): string {
    return skillName.replace(/^skills\//, '').replace(/[\\/]/g, '_');
}

export function getRemoteSkillPath(skillName: string): string {
    return skillName.includes('/') ? skillName : `skills/${skillName}`;
}

export function normalizeCliSkillArgument(rawSkillName: string): string {
    if (!rawSkillName || typeof rawSkillName !== 'string') {
        throw new Error(
            '请提供技能名称，例如: getskill install pdf-extract 或 getskill install skills/xejrax_pdf-extract'
        );
    }

    const value = rawSkillName.trim();
    if (!value) {
        throw new Error('技能名称不能为空');
    }

    if (/^https?:\/\//i.test(value) || value.endsWith('.git')) {
        throw new Error(
            '请传入技能名称而不是 Git URL，例如: getskill install pdf-extract'
        );
    }

    return value.replace(/^\/+|\/+$/g, '');
}

export function collectSkillMarkdownFiles(
    dirPath: string,
    baseDir = dirPath,
    result: string[] = []
): string[] {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    entries.forEach((entry) => {
        if (entry.name === '.git') {
            return;
        }

        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(baseDir, fullPath);

        if (entry.isDirectory()) {
            collectSkillMarkdownFiles(fullPath, baseDir, result);
            return;
        }

        if (!entry.isFile()) {
            return;
        }

        const isMarkdown = entry.name.toLowerCase().endsWith('.md');
        const isReadme = entry.name.toLowerCase().startsWith('readme');
        if (isMarkdown && !isReadme) {
            result.push(relativePath);
        }
    });

    return result;
}

function parseInstallState(content: string): InstallState {
    try {
        const parsed = JSON.parse(content) as Partial<InstallState>;
        if (!parsed || typeof parsed !== 'object') {
            return { skills: {} };
        }

        return {
            skills:
                parsed.skills && typeof parsed.skills === 'object'
                    ? parsed.skills
                    : {}
        };
    } catch {
        return { skills: {} };
    }
}

/**
 * 兼容 1.x/2.0 版本：状态文件曾存放在 `<agent 根目录>/getskill/state.json`。
 * 首次读取时自动迁移到 `~/.getskill/state.json`。
 */
export function migrateLegacyInstallState(): string | null {
    const stateFilePath = getStateFilePath();
    if (fs.existsSync(stateFilePath)) {
        return null;
    }

    for (const legacyPath of getLegacyStateFilePaths()) {
        if (!fs.existsSync(legacyPath)) {
            continue;
        }

        try {
            const content = fs.readFileSync(legacyPath, 'utf8');
            ensureDirectoryExists(path.dirname(stateFilePath));
            fs.writeFileSync(stateFilePath, content, 'utf8');
            // debug 级别（stderr），避免污染 search --json 的 stdout
            logger.debug(
                `已迁移历史安装记录: ${legacyPath} -> ${stateFilePath}`
            );
            return legacyPath;
        } catch (error) {
            logger.debug(
                `迁移历史安装记录失败 (${legacyPath}): ${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        }
    }

    return null;
}

export function readInstallState(): InstallState {
    const stateFilePath = getStateFilePath();
    if (!fs.existsSync(stateFilePath)) {
        migrateLegacyInstallState();
    }

    if (!fs.existsSync(stateFilePath)) {
        return { skills: {} };
    }

    try {
        return parseInstallState(fs.readFileSync(stateFilePath, 'utf8'));
    } catch {
        return { skills: {} };
    }
}

export function writeInstallState(state: InstallState): void {
    const stateFilePath = getStateFilePath();
    ensureDirectoryExists(path.dirname(stateFilePath));
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf8');
}

const STATE_LOCK_STALE_MS = 30_000;

function sleepSync(ms: number): void {
    const view = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(view, 0, 0, ms);
}

/**
 * 状态文件互斥锁（`state.json.lock`），防止多进程并发写丢记录。
 * 锁超过 30 秒视为残留（进程崩溃）自动回收；等待超时报 STATE_LOCKED。
 */
function withStateLock<T>(fn: () => T): T {
    const lockPath = `${getStateFilePath()}.lock`;
    const timeoutMs =
        Number(process.env.GETSKILL_STATE_LOCK_TIMEOUT_MS) || 5_000;
    ensureDirectoryExists(path.dirname(lockPath));
    const start = Date.now();

    for (;;) {
        try {
            fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
            break;
        } catch {
            try {
                const stat = fs.statSync(lockPath);
                if (Date.now() - stat.mtimeMs > STATE_LOCK_STALE_MS) {
                    fs.rmSync(lockPath, { force: true });
                    continue;
                }
            } catch {
                // 锁刚好被释放，立即重试
                continue;
            }
            if (Date.now() - start > timeoutMs) {
                throw new GetSkillError(
                    'STATE_LOCKED',
                    `状态文件被其他进程占用 (${lockPath})，请稍后重试`
                );
            }
            sleepSync(50);
        }
    }

    try {
        return fn();
    } finally {
        fs.rmSync(lockPath, { force: true });
    }
}

export async function updateInstallState(
    skillName: string,
    repoPath: string,
    installDir: string,
    action: 'install' | 'update',
    requestedVersion?: string,
    version?: string
): Promise<void> {
    withStateLock(() => {
        const localSkillName = normalizeSkillName(skillName);
        const remoteSkillPath = getRemoteSkillPath(skillName);
        const now = new Date().toISOString();

        const state = readInstallState();
        const previous = state.skills[localSkillName];

        state.skills[localSkillName] = {
            inputSkillName: skillName,
            localSkillName,
            remoteSkillPath,
            repoPath,
            installDir,
            lastAction: action,
            installedAt: previous?.installedAt || now,
            updatedAt: now,
            gitCommitHash: previous?.gitCommitHash || null,
            requestedVersion:
                requestedVersion ?? previous?.requestedVersion ?? null,
            version: version ?? previous?.version ?? null,
            agent: getAgentName(),
            skillsDir: getSkillsDirectory()
        };

        writeInstallState(state);
    });
}

export function removeInstallState(skillName: string): void {
    withStateLock(() => {
        const state = readInstallState();
        const localSkillName = normalizeSkillName(skillName);

        if (state.skills[localSkillName]) {
            delete state.skills[localSkillName];
            writeInstallState(state);
        }
    });
}

export function copyDirectoryRecursive(
    sourceDir: string,
    targetDir: string
): void {
    ensureDirectoryExists(targetDir);

    const entries = fs.readdirSync(sourceDir, { withFileTypes: true });
    entries.forEach((entry) => {
        if (entry.name === '.git') {
            return;
        }

        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);
        const stat = fs.lstatSync(sourcePath);

        if (stat.isSymbolicLink()) {
            logger.warn(`跳过符号链接: ${sourcePath}`);
            return;
        }

        if (entry.isDirectory()) {
            copyDirectoryRecursive(sourcePath, targetPath);
            return;
        }

        if (entry.isFile()) {
            if (stat.size > MAX_COPY_FILE_SIZE_BYTES) {
                logger.warn(
                    `跳过超大文件 (${MAX_COPY_FILE_SIZE_BYTES} bytes): ${sourcePath}`
                );
                return;
            }
            fs.copyFileSync(sourcePath, targetPath);
        }
    });
}

export function replaceDirectoryAtomically(
    sourceDir: string,
    targetDir: string
): void {
    const parentDir = path.dirname(targetDir);
    const dirName = path.basename(targetDir);
    const tempDir = path.join(
        parentDir,
        `.${dirName}.tmp-${process.pid}-${Date.now()}`
    );
    const backupDir = path.join(
        parentDir,
        `.${dirName}.bak-${process.pid}-${Date.now()}`
    );

    ensureDirectoryExists(parentDir);
    copyDirectoryRecursive(sourceDir, tempDir);

    try {
        if (fs.existsSync(targetDir)) {
            fs.renameSync(targetDir, backupDir);
        }

        fs.renameSync(tempDir, targetDir);

        if (fs.existsSync(backupDir)) {
            fs.rmSync(backupDir, { recursive: true, force: true });
        }
    } catch (error) {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        if (!fs.existsSync(targetDir) && fs.existsSync(backupDir)) {
            fs.renameSync(backupDir, targetDir);
        }

        throw error;
    }
}

export function copySkillFiles(repoPath: string, skillName: string): string[] {
    const skillsDir = getSkillsDirectory();
    ensureDirectoryExists(skillsDir);

    const localSkillName = normalizeSkillName(skillName);
    const sourceSkillFiles = collectSkillMarkdownFiles(repoPath);
    if (sourceSkillFiles.length === 0) {
        throw new Error('在仓库中未找到技能 .md 文件');
    }

    const targetSkillDir = path.join(skillsDir, localSkillName);
    replaceDirectoryAtomically(repoPath, targetSkillDir);

    const installedSkillFiles = collectSkillMarkdownFiles(targetSkillDir);
    if (installedSkillFiles.length === 0) {
        throw new Error('复制后技能目录校验失败：未发现技能 .md 文件');
    }

    logger.info(`已复制技能目录: ${repoPath} -> ${targetSkillDir}`);
    return [targetSkillDir];
}

export function listLocalSkills(): string[] {
    const skillsDir = getSkillsDirectory();
    if (!fs.existsSync(skillsDir)) {
        // debug 级别（stderr），避免污染 list --json 的 stdout
        logger.debug('技能目录不存在');
        return [];
    }

    return fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
}

function recordSkillsDir(record: SkillStateRecord): string | null {
    if (record.skillsDir) {
        return record.skillsDir;
    }

    // 2.0 及更早版本的记录未保存技能目录，用安装目录的父目录推断
    if (record.installDir) {
        return path.dirname(record.installDir);
    }

    return null;
}

function recordMatchesCurrentSkillsDir(record: SkillStateRecord): boolean {
    const recordDir = recordSkillsDir(record);
    if (!recordDir) {
        return true;
    }
    return isSamePath(recordDir, getSkillsDirectory());
}

/**
 * 当前技能目录下真实存在安装目录的技能快照（含版本），
 * 用于搜索结果标注本地安装状态。
 */
export function getInstalledSkillsSnapshot(): InstalledSkillSnapshot[] {
    const state = readInstallState();
    const skillsDir = getSkillsDirectory();

    return Object.values(state.skills)
        .filter(recordMatchesCurrentSkillsDir)
        .map((record) => ({
            skillName: record.inputSkillName || record.localSkillName,
            localSkillName: record.localSkillName,
            version: record.version || null,
            skillDir:
                record.installDir || path.join(skillsDir, record.localSkillName)
        }))
        .filter((item) => fs.existsSync(item.skillDir));
}

export function listInstalledSkillNames(): string[] {
    const state = readInstallState();
    const stateNames = Object.values(state.skills)
        .filter(recordMatchesCurrentSkillsDir)
        .map((item) => item.inputSkillName || item.localSkillName)
        .filter(Boolean);

    if (stateNames.length > 0) {
        return [...new Set(stateNames)];
    }

    return listLocalSkills();
}

/**
 * 清理状态文件中的失效记录。
 * 不传参数时清理不属于当前技能目录（Agent）的记录，
 * 传入技能名时只清理指定记录。返回被清理的技能名列表。
 */
export function pruneInstallState(skillNames: string[] = []): string[] {
    return withStateLock(() => {
        const state = readInstallState();
        const targets = new Set(
            skillNames.map((name) => normalizeSkillName(name)).filter(Boolean)
        );
        const removed: string[] = [];

        Object.keys(state.skills).forEach((localSkillName) => {
            const record = state.skills[localSkillName];
            const shouldRemove =
                targets.size > 0
                    ? targets.has(localSkillName)
                    : !recordMatchesCurrentSkillsDir(record);

            if (shouldRemove) {
                delete state.skills[localSkillName];
                removed.push(record.inputSkillName || localSkillName);
            }
        });

        if (removed.length > 0) {
            writeInstallState(state);
        }

        return removed;
    });
}

/**
 * 解析技能的实际解压目录：
 * 优先使用安装记录中的 repoPath，其次解析缓存目录中的单层包装目录。
 */
function resolveCachePaths(
    localSkillName: string,
    record: SkillStateRecord | null
): { cacheDir: string; repoPath: string } {
    const cacheDir = path.join(getSkillsCacheDirectory(), localSkillName);

    if (record?.repoPath && fs.existsSync(record.repoPath)) {
        return { cacheDir, repoPath: record.repoPath };
    }

    if (fs.existsSync(cacheDir)) {
        return { cacheDir, repoPath: resolveSkillRoot(cacheDir) };
    }

    return { cacheDir, repoPath: cacheDir };
}

export function getInstalledSkillInfo(skillName: string): InstalledSkillInfo {
    const normalizedSkillName = normalizeCliSkillArgument(skillName);
    const localSkillName = normalizeSkillName(normalizedSkillName);
    const state = readInstallState();
    const record = state.skills[localSkillName] || null;
    const skillsDir = getSkillsDirectory();
    const skillDir = path.join(skillsDir, localSkillName);
    const { cacheDir, repoPath } = resolveCachePaths(localSkillName, record);

    return {
        skillName: normalizedSkillName,
        localSkillName,
        installed: fs.existsSync(skillDir),
        cached: fs.existsSync(repoPath),
        skillDir,
        repoPath,
        cacheDir,
        skillsDir,
        agent: getAgentName(),
        agentLabel: getAgentLabel(),
        state: record
    };
}

export function removeInstalledSkill(
    skillName: string,
    options: { removeCache?: boolean } = {}
): RemoveInstalledSkillResult {
    const normalizedSkillName = normalizeCliSkillArgument(skillName);
    const localSkillName = normalizeSkillName(normalizedSkillName);
    const removeCache = options.removeCache !== false;

    const state = readInstallState();
    const record = state.skills[localSkillName] || null;
    const skillDir = path.join(getSkillsDirectory(), localSkillName);
    const { cacheDir, repoPath } = resolveCachePaths(localSkillName, record);

    let removedInstall = false;
    let removedCache = false;

    if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
        removedInstall = true;
    }

    if (removeCache) {
        if (fs.existsSync(cacheDir)) {
            fs.rmSync(cacheDir, { recursive: true, force: true });
            removedCache = true;
        }

        if (
            !isSamePath(repoPath, cacheDir) &&
            !repoPath.startsWith(`${cacheDir}${path.sep}`) &&
            fs.existsSync(repoPath)
        ) {
            fs.rmSync(repoPath, { recursive: true, force: true });
            removedCache = true;
        }
    }

    removeInstallState(normalizedSkillName);

    return {
        skillName: normalizedSkillName,
        localSkillName,
        removedInstall,
        removedCache,
        skillDir,
        repoPath: cacheDir
    };
}
