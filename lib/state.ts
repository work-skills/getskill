import fs from 'fs';
import path from 'path';

import {
    MAX_COPY_FILE_SIZE_BYTES,
    getSkillsDirectory,
    getSkillsCacheDirectory,
    getStateFilePath
} from './config';
import logger from './logger';
import { ensureDirectoryExists, getGitCommitHash } from './system';
import type {
    InstallState,
    InstalledSkillInfo,
    RemoveInstalledSkillResult
} from './types';

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

export function readInstallState(): InstallState {
    const stateFilePath = getStateFilePath();
    if (!fs.existsSync(stateFilePath)) {
        return { skills: {} };
    }

    try {
        const content = fs.readFileSync(stateFilePath, 'utf8');
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

export function writeInstallState(state: InstallState): void {
    const stateFilePath = getStateFilePath();
    ensureDirectoryExists(path.dirname(stateFilePath));
    fs.writeFileSync(stateFilePath, JSON.stringify(state, null, 2), 'utf8');
}

export async function updateInstallState(
    skillName: string,
    repoPath: string,
    installDir: string,
    action: 'install' | 'update',
    requestedVersion?: string
): Promise<void> {
    const localSkillName = normalizeSkillName(skillName);
    const remoteSkillPath = getRemoteSkillPath(skillName);
    const now = new Date().toISOString();
    const commitHash = await getGitCommitHash(repoPath);

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
        gitCommitHash: commitHash || previous?.gitCommitHash || null,
        requestedVersion: requestedVersion ?? previous?.requestedVersion ?? null
    };

    writeInstallState(state);
}

export function removeInstallState(skillName: string): void {
    const state = readInstallState();
    const localSkillName = normalizeSkillName(skillName);

    if (state.skills[localSkillName]) {
        delete state.skills[localSkillName];
        writeInstallState(state);
    }
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
        logger.info('技能目录不存在');
        return [];
    }

    return fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
}

export function listInstalledSkillNames(): string[] {
    const state = readInstallState();
    const stateNames = Object.values(state.skills)
        .map((item) => item.inputSkillName || item.localSkillName)
        .filter(Boolean);

    if (stateNames.length > 0) {
        return [...new Set(stateNames)];
    }

    return listLocalSkills();
}

export function getInstalledSkillInfo(skillName: string): InstalledSkillInfo {
    const normalizedSkillName = normalizeCliSkillArgument(skillName);
    const localSkillName = normalizeSkillName(normalizedSkillName);
    const state = readInstallState();
    const record = state.skills[localSkillName] || null;
    const skillDir = path.join(getSkillsDirectory(), localSkillName);
    const repoPath = path.join(getSkillsCacheDirectory(), localSkillName);

    return {
        skillName: normalizedSkillName,
        localSkillName,
        installed: fs.existsSync(skillDir),
        cached: fs.existsSync(repoPath),
        skillDir,
        repoPath,
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

    const skillDir = path.join(getSkillsDirectory(), localSkillName);
    const repoPath = path.join(getSkillsCacheDirectory(), localSkillName);

    let removedInstall = false;
    let removedCache = false;

    if (fs.existsSync(skillDir)) {
        fs.rmSync(skillDir, { recursive: true, force: true });
        removedInstall = true;
    }

    if (removeCache && fs.existsSync(repoPath)) {
        fs.rmSync(repoPath, { recursive: true, force: true });
        removedCache = true;
    }

    removeInstallState(normalizedSkillName);

    return {
        skillName: normalizedSkillName,
        localSkillName,
        removedInstall,
        removedCache,
        skillDir,
        repoPath
    };
}
