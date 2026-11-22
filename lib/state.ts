import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

import {
    MAX_COPY_FILE_SIZE_BYTES,
    getAgentLabel,
    getAgentName,
    getGetSkillHome,
    getLegacyStateFilePaths,
    getSkillsCacheDirectory,
    getSkillsDirectory,
    getStateFilePath,
    isSamePath
} from './config';
import logger from './logger';
import { GetSkillError } from './errors';
import {
    assertContainedChildPath,
    assertSafeSkillName,
    isPathWithin
} from './safe-name';
import { ensureDirectoryExists } from './system';
import type {
    InstalledSkillSnapshot,
    InstallState,
    InstalledSkillInfo,
    LocalSkillDetail,
    RemoveInstalledSkillResult,
    SkillStateRecord
} from './types';
import { resolveSkillRoot } from './unzip';

export function normalizeSkillName(skillName: string): string {
    const normalized = skillName
        .replace(/^skills\//, '')
        .replace(/[\\/]/g, '_');
    // S1：拒绝 `.`/`..`/盘符/保留设备名等，防止路径穿越删除技能根目录
    assertSafeSkillName(normalized);
    return normalized;
}

/** 索引查找键：忽略大小写，`_`/空白/路径分隔统一为 `-`。 */
export function normalizeSkillIndexKey(skillName: string): string {
    return skillName
        .trim()
        .replace(/^skills\//, '')
        .replace(/[\\/_\s]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

/**
 * 把用户输入解析为本地实际使用的技能名（state 键或目录名）。
 * 顺序：精确 state 键 → 忽略大小写 state 键 → 精确目录 → 忽略大小写目录 → 规范化输入。
 * 修复「install PDF-Toolkit 后 uninstall pdf-toolkit 删不掉」的归一化不对称。
 */
export function resolveLocalSkillName(skillName: string): string {
    const normalized = normalizeSkillName(skillName);
    const lookupKey = normalizeSkillIndexKey(skillName);
    const state = readInstallState();

    if (state.skills[normalized]) {
        return normalized;
    }

    const stateMatch = Object.keys(state.skills).find(
        (key) => normalizeSkillIndexKey(key) === lookupKey
    );
    if (stateMatch) {
        return stateMatch;
    }

    const skillsDir = getSkillsDirectory();
    if (fs.existsSync(skillsDir)) {
        try {
            // 用 readdir 取真实目录名：Windows NTFS 的 existsSync 不区分大小写，
            // 直接拼路径会丢失磁盘上的实际大小写。
            const dirEntries = fs
                .readdirSync(skillsDir, { withFileTypes: true })
                .filter((entry) => entry.isDirectory());
            const exact = dirEntries.find((entry) => entry.name === normalized);
            if (exact) {
                return exact.name;
            }
            const dirMatch = dirEntries.find(
                (entry) => normalizeSkillIndexKey(entry.name) === lookupKey
            );
            if (dirMatch) {
                return dirMatch.name;
            }
        } catch {
            // 目录不可读时回退为规范化输入
        }
    }

    return normalized;
}

export function getRemoteSkillPath(skillName: string): string {
    return skillName.includes('/') ? skillName : `skills/${skillName}`;
}

export function normalizeCliSkillArgument(rawSkillName: string): string {
    if (!rawSkillName || typeof rawSkillName !== 'string') {
        throw new GetSkillError(
            'INVALID_ARGS',
            '请提供技能名称，例如: getskill install pdf-extract 或 getskill install skills/xejrax_pdf-extract'
        );
    }

    const value = rawSkillName.trim();
    if (!value) {
        throw new GetSkillError('INVALID_ARGS', '技能名称不能为空');
    }

    if (/^https?:\/\//i.test(value) || value.endsWith('.git')) {
        throw new GetSkillError(
            'INVALID_ARGS',
            '请传入技能名称而不是 Git URL，例如: getskill install pdf-extract'
        );
    }

    const trimmed = value.replace(/^\/+|\/+$/g, '');
    // S1：入口即拒绝不安全的本地目录名（.. / 盘符 / 保留设备名等），
    // 不等到索引查找或文件系统操作才失败
    assertSafeSkillName(
        trimmed.replace(/^skills\//, '').replace(/[\\/]/g, '_')
    );
    return trimmed;
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
    const parsed = JSON.parse(content) as Partial<InstallState>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('状态文件结构无效（缺少对象根节点）');
    }

    return {
        skills:
            parsed.skills && typeof parsed.skills === 'object'
                ? parsed.skills
                : {}
    };
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

/** 每进程只告警/备份一次，避免高频读取时刷屏。 */
let stateCorruptionHandled = false;

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
    } catch (error) {
        if (!stateCorruptionHandled) {
            stateCorruptionHandled = true;
            const message =
                error instanceof Error ? error.message : String(error);
            logger.warn(
                `状态文件损坏，本次按空状态继续（历史安装记录可能丢失）: ${stateFilePath}: ${message}`
            );
            try {
                const backupPath = `${stateFilePath}.corrupt-${Date.now()}`;
                fs.copyFileSync(stateFilePath, backupPath);
                logger.warn(`损坏的状态文件已备份: ${backupPath}`);
            } catch {
                // 备份失败不阻塞主流程
            }
        }
        return { skills: {} };
    }
}

export function writeInstallState(state: InstallState): void {
    const stateFilePath = getStateFilePath();
    ensureDirectoryExists(path.dirname(stateFilePath));
    // 原子写：先写临时文件再 rename，避免进程中断留下半截 JSON
    const tempFile = `${stateFilePath}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8');
    try {
        fs.renameSync(tempFile, stateFilePath);
    } catch (error) {
        fs.rmSync(tempFile, { force: true });
        throw error;
    }
}

export const STATE_LOCK_STALE_MS = 30_000;

function sleepSync(ms: number): void {
    const view = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(view, 0, 0, ms);
}

/**
 * 状态文件互斥锁（`state.json.lock`），防止多进程并发写丢记录。
 * 锁超过 30 秒视为残留（进程崩溃）自动回收；等待超时报 STATE_LOCKED。
 * 进程内可重入：安装流程整体持锁时，内部 updateInstallState 不再重复抢锁。
 */
let stateLockDepth = 0;

function acquireStateLock(): void {
    if (stateLockDepth > 0) {
        stateLockDepth += 1;
        return;
    }

    const lockPath = `${getStateFilePath()}.lock`;
    const timeoutMs =
        Number(process.env.GETSKILL_STATE_LOCK_TIMEOUT_MS) || 5_000;
    ensureDirectoryExists(path.dirname(lockPath));
    const start = Date.now();

    for (;;) {
        try {
            fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
            stateLockDepth = 1;
            return;
        } catch {
            try {
                const stat = fs.statSync(lockPath);
                if (Date.now() - stat.mtimeMs > STATE_LOCK_STALE_MS) {
                    // rename 认领：只有抢到的进程负责删除残留锁，
                    // 避免并发回收时互删对方刚创建的新锁
                    const claimPath = `${lockPath}.stale-${process.pid}-${Date.now()}`;
                    try {
                        fs.renameSync(lockPath, claimPath);
                        fs.rmSync(claimPath, { force: true });
                    } catch {
                        // 其他进程已回收或锁已释放，直接重试
                    }
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
}

function releaseStateLock(): void {
    stateLockDepth -= 1;
    if (stateLockDepth <= 0) {
        stateLockDepth = 0;
        fs.rmSync(`${getStateFilePath()}.lock`, { force: true });
    }
}

function withStateLock<T>(fn: () => T): T {
    acquireStateLock();
    try {
        return fn();
    } finally {
        releaseStateLock();
    }
}

/** 在 state 锁内执行异步临界区（如「复制技能文件 + 写 state」整体）。 */
export async function withStateLockAsync<T>(fn: () => Promise<T>): Promise<T> {
    acquireStateLock();
    try {
        return await fn();
    } finally {
        releaseStateLock();
    }
}

export async function updateInstallState(
    skillName: string,
    repoPath: string,
    installDir: string,
    action: 'install' | 'update',
    requestedVersion?: string,
    version?: string,
    contentHash?: string | null
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
            skillsDir: getSkillsDirectory(),
            contentHash: contentHash ?? previous?.contentHash ?? null
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
    targetDir: string,
    warnings?: string[]
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
            const message = `跳过符号链接: ${sourcePath}`;
            logger.warn(message);
            warnings?.push(message);
            return;
        }

        if (entry.isDirectory()) {
            copyDirectoryRecursive(sourcePath, targetPath, warnings);
            return;
        }

        if (entry.isFile()) {
            if (stat.size > MAX_COPY_FILE_SIZE_BYTES) {
                const message = `跳过超大文件 (${MAX_COPY_FILE_SIZE_BYTES} bytes): ${sourcePath}`;
                logger.warn(message);
                warnings?.push(message);
                return;
            }
            fs.copyFileSync(sourcePath, targetPath);
        }
    });
}

export function replaceDirectoryAtomically(
    sourceDir: string,
    targetDir: string,
    warnings?: string[]
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
    copyDirectoryRecursive(sourceDir, tempDir, warnings);

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

export function copySkillFiles(
    repoPath: string,
    skillName: string,
    warnings?: string[]
): string[] {
    const skillsDir = getSkillsDirectory();
    ensureDirectoryExists(skillsDir);

    const localSkillName = normalizeSkillName(skillName);
    const sourceSkillFiles = collectSkillMarkdownFiles(repoPath);
    if (sourceSkillFiles.length === 0) {
        throw new GetSkillError(
            'PACKAGE_INVALID',
            '技能包无效: 在仓库中未找到技能 .md 文件'
        );
    }

    // 纵深防御：安装目标必须严格位于技能目录下一层
    const targetSkillDir = assertContainedChildPath(skillsDir, localSkillName);
    replaceDirectoryAtomically(repoPath, targetSkillDir, warnings);

    const installedSkillFiles = collectSkillMarkdownFiles(targetSkillDir);
    if (installedSkillFiles.length === 0) {
        throw new GetSkillError(
            'PACKAGE_INVALID',
            '技能包无效: 复制后技能目录校验失败，未发现技能 .md 文件'
        );
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
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
        .map((entry) => entry.name);
}

/**
 * 计算技能目录内容哈希（相对路径 + 文件原始字节，排序后 SHA-256）。
 * 与 copyDirectoryRecursive 的口径一致：跳过 .git、符号链接、超大文件。
 * 按字节而非 utf8 字符串哈希，二进制文件不会再被误判为本地修改。
 * 目录不存在或不可读时返回 null。
 */
export function computeSkillDirHash(dirPath: string): string | null {
    if (!fs.existsSync(dirPath)) {
        return null;
    }

    const chunks: Buffer[] = [];

    const walk = (currentDir: string): void => {
        const entries = fs
            .readdirSync(currentDir, { withFileTypes: true })
            .sort((a, b) => a.name.localeCompare(b.name));

        entries.forEach((entry) => {
            if (entry.name === '.git') {
                return;
            }
            const fullPath = path.join(currentDir, entry.name);
            if (entry.isSymbolicLink()) {
                return;
            }
            if (entry.isDirectory()) {
                walk(fullPath);
                return;
            }
            if (!entry.isFile()) {
                return;
            }
            const stat = fs.lstatSync(fullPath);
            if (stat.size > MAX_COPY_FILE_SIZE_BYTES) {
                return;
            }
            const relativePath = path
                .relative(dirPath, fullPath)
                .replace(/\\/g, '/');
            chunks.push(
                Buffer.from(`${relativePath}\u0000`, 'utf8'),
                fs.readFileSync(fullPath),
                Buffer.from('\u0001', 'utf8')
            );
        });
    };

    try {
        walk(dirPath);
    } catch {
        return null;
    }

    return crypto
        .createHash('sha256')
        .update(Buffer.concat(chunks))
        .digest('hex');
}

/**
 * list 命令明细：目录扫描 + state 记录合并。
 * managed=false 表示目录存在但不由 getskill 管理（手动放入）。
 */
export function listLocalSkillsDetailed(): LocalSkillDetail[] {
    const skillsDir = getSkillsDirectory();
    const state = readInstallState();
    const records = Object.values(state.skills).filter(
        recordMatchesCurrentSkillsDir
    );
    const recordByName = new Map<string, SkillStateRecord>();
    records.forEach((record) => {
        recordByName.set(record.localSkillName, record);
        recordByName.set(normalizeSkillIndexKey(record.localSkillName), record);
    });

    return listLocalSkills()
        .sort((a, b) => a.localeCompare(b))
        .map((name) => {
            const record =
                recordByName.get(name) ||
                recordByName.get(normalizeSkillIndexKey(name)) ||
                null;
            return {
                name,
                version: record?.version || null,
                managed: Boolean(record),
                skill_dir: path.join(skillsDir, name),
                updated_at: record?.updatedAt || null
            };
        });
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

export function recordMatchesCurrentSkillsDir(
    record: SkillStateRecord
): boolean {
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
    const localSkillName = resolveLocalSkillName(normalizedSkillName);
    const state = readInstallState();
    const record = state.skills[localSkillName] || null;
    const skillsDir = getSkillsDirectory();
    const skillDir = path.join(skillsDir, localSkillName);
    const { cacheDir, repoPath } = resolveCachePaths(localSkillName, record);
    const installed = fs.existsSync(skillDir);
    const currentHash =
        installed && record?.contentHash ? computeSkillDirHash(skillDir) : null;
    // 哈希不可计算（目录不可读等）时不误报本地修改
    const localModified =
        Boolean(record?.contentHash) &&
        currentHash !== null &&
        currentHash !== record?.contentHash;

    return {
        skillName: normalizedSkillName,
        localSkillName,
        installed,
        cached: fs.existsSync(repoPath),
        skillDir,
        repoPath,
        cacheDir,
        skillsDir,
        agent: getAgentName(),
        agentLabel: getAgentLabel(),
        state: record,
        localModified
    };
}

export function removeInstalledSkill(
    skillName: string,
    options: { removeCache?: boolean; force?: boolean } = {}
): RemoveInstalledSkillResult {
    const normalizedSkillName = normalizeCliSkillArgument(skillName);
    const localSkillName = resolveLocalSkillName(normalizedSkillName);
    const removeCache = options.removeCache !== false;

    const state = readInstallState();
    const record = state.skills[localSkillName] || null;
    // S1 纵深防御：卸载目标必须严格位于技能目录下一层
    const skillDir = assertContainedChildPath(
        getSkillsDirectory(),
        localSkillName
    );
    const { cacheDir, repoPath } = resolveCachePaths(localSkillName, record);
    const managed = Boolean(record && recordMatchesCurrentSkillsDir(record));

    // S2：无安装记录的手工技能目录默认拒删，需 --force 显式确认
    if (fs.existsSync(skillDir) && !managed && options.force !== true) {
        throw new GetSkillError(
            'UNMANAGED_SKILL',
            `技能目录 ${skillDir} 不由 getskill 管理（无安装记录），为避免误删手工放置的技能已拒绝卸载。确认删除请使用 --force，或手动删除该目录`
        );
    }

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
            // S3：state 中的 repoPath 可能被篡改/迁移，只允许删除
            // 缓存根目录或 getskill 家目录之内的路径
            const insideManagedRoots =
                isPathWithin(getSkillsCacheDirectory(), repoPath) ||
                isPathWithin(getGetSkillHome(), repoPath);
            if (insideManagedRoots) {
                fs.rmSync(repoPath, { recursive: true, force: true });
                removedCache = true;
            } else {
                logger.warn(
                    `跳过删除受管目录之外的解压路径（可能指向手工目录）: ${repoPath}`
                );
            }
        }
    }

    removeInstallState(localSkillName);

    return {
        skillName: normalizedSkillName,
        localSkillName,
        removedInstall,
        removedCache,
        skillDir,
        repoPath: cacheDir,
        managed
    };
}
