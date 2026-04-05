import fs from 'fs';
import path from 'path';

import { getBaseUrl, getSkillsCacheDirectory } from './config';
import logger from './logger';
import {
    copySkillFiles,
    getRemoteSkillPath,
    listInstalledSkillNames,
    normalizeCliSkillArgument,
    normalizeSkillName,
    removeInstalledSkill,
    updateInstallState
} from './state';
import { ensureGitInstalled, executeCommand } from './system';
import type {
    DownloadOptions,
    DownloadResult,
    PublishOptions,
    PublishResult,
    RemoveInstalledSkillResult,
    UpdateAllResult
} from './types';

export async function cloneOrUpdateRepo(
    skillName: string,
    options: DownloadOptions = {}
): Promise<string> {
    await ensureGitInstalled();

    const cacheDir = getSkillsCacheDirectory();
    const localSkillName = normalizeSkillName(skillName);
    const remoteSkillPath = getRemoteSkillPath(skillName);
    const repoPath = path.join(cacheDir, localSkillName);
    const requestedVersion = options.version?.trim();

    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }

    if (fs.existsSync(repoPath)) {
        logger.info(`更新仓库: ${skillName}...`);
        if (requestedVersion) {
            await executeCommand('git fetch --all --tags --prune', repoPath);
            await executeCommand(
                `git checkout "${requestedVersion}"`,
                repoPath
            );
        } else {
            await executeCommand('git pull', repoPath);
        }
        logger.info(`仓库更新成功: ${repoPath}`);
        return repoPath;
    }

    const gitUrl = `${getBaseUrl()}/${remoteSkillPath}.git`;
    logger.info(`克隆仓库: ${gitUrl}...`);
    if (requestedVersion) {
        await executeCommand(
            `git clone "${gitUrl}" "${localSkillName}"`,
            cacheDir
        );
        await executeCommand(`git checkout "${requestedVersion}"`, repoPath);
    } else {
        await executeCommand(
            `git clone --depth 1 "${gitUrl}" "${localSkillName}"`,
            cacheDir
        );
    }
    logger.info(`仓库克隆成功: ${repoPath}`);
    return repoPath;
}

export async function restartOpenClawGateway(): Promise<void> {
    const restartCommand = 'openclaw gateway restart';
    logger.info(`尝试执行: ${restartCommand}`);

    try {
        await executeCommand(restartCommand);
        logger.info('OpenClaw Gateway 重启成功，新技能应已生效。');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
            '自动重启 OpenClaw Gateway 失败，请手动执行: openclaw gateway restart'
        );
        logger.warn(`失败原因: ${message}`);
    }
}

export async function downloadSkill(
    skillName: string,
    options: DownloadOptions = {}
): Promise<DownloadResult> {
    logger.info(`下载技能: ${skillName}...`);
    const normalizedSkillName = normalizeCliSkillArgument(skillName);
    const requestedVersion = options.version?.trim();
    const repoPath = await cloneOrUpdateRepo(normalizedSkillName, {
        version: requestedVersion
    });
    const copiedFiles = copySkillFiles(repoPath, normalizedSkillName);
    await updateInstallState(
        normalizedSkillName,
        repoPath,
        copiedFiles[0],
        'install',
        requestedVersion
    );

    return {
        skillName: normalizedSkillName,
        repoPath,
        files: copiedFiles,
        requestedVersion: requestedVersion || null
    };
}

export async function updateSkill(
    skillName: string,
    options: DownloadOptions = {}
): Promise<DownloadResult> {
    const normalizedSkillName = normalizeCliSkillArgument(skillName);
    const requestedVersion = options.version?.trim();
    logger.info(`正在更新技能: ${normalizedSkillName}...`);

    const cacheDir = getSkillsCacheDirectory();
    const localSkillName = normalizeSkillName(normalizedSkillName);
    const repoPath = path.join(cacheDir, localSkillName);

    if (!fs.existsSync(repoPath)) {
        logger.info('技能仓库不存在，将重新下载...');
        return downloadSkill(normalizedSkillName, {
            version: requestedVersion
        });
    }

    if (requestedVersion) {
        await executeCommand('git fetch --all --tags --prune', repoPath);
        await executeCommand(`git checkout "${requestedVersion}"`, repoPath);
    } else {
        await executeCommand('git pull', repoPath);
    }
    logger.info('Git 仓库已更新');

    const copiedFiles = copySkillFiles(repoPath, normalizedSkillName);
    await updateInstallState(
        normalizedSkillName,
        repoPath,
        copiedFiles[0],
        'update',
        requestedVersion
    );

    logger.info(`技能 ${normalizedSkillName} 更新成功！`);
    return {
        skillName: normalizedSkillName,
        repoPath,
        files: copiedFiles,
        requestedVersion: requestedVersion || null
    };
}

export async function updateAllSkills(): Promise<UpdateAllResult[]> {
    const installedSkills = listInstalledSkillNames();
    const results: UpdateAllResult[] = [];

    for (const skillName of installedSkills) {
        try {
            const result = await updateSkill(skillName);
            results.push({ skillName, ok: true, result });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            results.push({ skillName, ok: false, error: message });
        }
    }

    return results;
}

export async function uninstallSkill(
    skillName: string,
    options: { removeCache?: boolean } = {}
): Promise<RemoveInstalledSkillResult> {
    const result = removeInstalledSkill(skillName, options);
    logger.info(`已卸载技能目录: ${result.skillDir}`);
    if (result.removedCache) {
        logger.info(`已移除缓存仓库: ${result.repoPath}`);
    }

    return result;
}

function quoteShellArg(value: string): string {
    return value.replace(/"/g, '\\"');
}

export async function publishSkill(
    skillPath: string,
    options: PublishOptions = {}
): Promise<PublishResult> {
    await ensureGitInstalled();

    const resolvedSkillPath = path.resolve(skillPath);
    if (!fs.existsSync(resolvedSkillPath)) {
        throw new Error(`技能目录不存在: ${resolvedSkillPath}`);
    }

    const skillFilePath = path.join(resolvedSkillPath, 'SKILL.md');
    if (!fs.existsSync(skillFilePath)) {
        throw new Error('publish 目录中缺少 SKILL.md');
    }

    const gitDirPath = path.join(resolvedSkillPath, '.git');
    if (!fs.existsSync(gitDirPath)) {
        logger.info('未检测到 Git 仓库，正在初始化...');
        await executeCommand('git init', resolvedSkillPath);
    }

    const branch = options.branch?.trim() || 'main';
    const commitMessage =
        options.message?.trim() || 'chore: publish skill via getskill';

    let currentRemoteUrl = '';
    try {
        const { stdout } = await executeCommand(
            'git remote get-url origin',
            resolvedSkillPath
        );
        currentRemoteUrl = stdout.trim();
    } catch {
        currentRemoteUrl = '';
    }

    if (options.repoUrl?.trim()) {
        const requestedRemoteUrl = options.repoUrl.trim();
        if (currentRemoteUrl) {
            await executeCommand(
                `git remote set-url origin "${quoteShellArg(requestedRemoteUrl)}"`,
                resolvedSkillPath
            );
        } else {
            await executeCommand(
                `git remote add origin "${quoteShellArg(requestedRemoteUrl)}"`,
                resolvedSkillPath
            );
        }
        currentRemoteUrl = requestedRemoteUrl;
    }

    if (!currentRemoteUrl) {
        throw new Error('请提供 --repo，或先在仓库中配置 origin 远程地址');
    }

    await executeCommand(
        `git checkout -B "${quoteShellArg(branch)}"`,
        resolvedSkillPath
    );
    await executeCommand('git add .', resolvedSkillPath);

    let committed = false;
    try {
        await executeCommand(
            `git commit -m "${quoteShellArg(commitMessage)}"`,
            resolvedSkillPath
        );
        committed = true;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const normalizedMessage = message.toLowerCase();
        if (
            normalizedMessage.includes('nothing to commit') ||
            normalizedMessage.includes('nothing added to commit')
        ) {
            committed = false;
        } else {
            throw error;
        }
    }

    await executeCommand(
        `git push -u origin "${quoteShellArg(branch)}"`,
        resolvedSkillPath
    );

    logger.info(`已发布技能目录: ${resolvedSkillPath}`);
    return {
        skillPath: resolvedSkillPath,
        remoteUrl: currentRemoteUrl,
        branch,
        committed
    };
}
