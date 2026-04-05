#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

import {
    getBaseUrl,
    getSkillsCacheDirectory,
    getSkillsDirectory,
    setBaseUrl
} from './lib/config';
import logger from './lib/logger';
import { repositoryHasSkillFile, searchSkills } from './lib/network';
import {
    copySkillFiles,
    getInstalledSkillInfo,
    listLocalSkills
} from './lib/state';
import { checkGitInstalled, ensureGitInstalled } from './lib/system';
import {
    cloneOrUpdateRepo,
    downloadSkill,
    publishSkill,
    uninstallSkill,
    updateAllSkills,
    updateSkill
} from './lib/skill-manager';

function parseCommandOptions(rawArgs: string[]): {
    positionals: string[];
    options: Record<string, string | boolean>;
} {
    const positionals: string[] = [];
    const options: Record<string, string | boolean> = {};

    for (let index = 0; index < rawArgs.length; index += 1) {
        const token = rawArgs[index];

        if (!token.startsWith('-')) {
            positionals.push(token);
            continue;
        }

        if (token.startsWith('--')) {
            const eqIndex = token.indexOf('=');
            if (eqIndex > -1) {
                const key = token.slice(2, eqIndex);
                const value = token.slice(eqIndex + 1);
                options[key] = value;
                continue;
            }

            const key = token.slice(2);
            const nextToken = rawArgs[index + 1];
            if (nextToken && !nextToken.startsWith('-')) {
                options[key] = nextToken;
                index += 1;
            } else {
                options[key] = true;
            }
            continue;
        }

        if (token === '-V') {
            const nextToken = rawArgs[index + 1];
            if (nextToken && !nextToken.startsWith('-')) {
                options.version = nextToken;
                index += 1;
            } else {
                options.version = true;
            }
        }
    }

    return { positionals, options };
}

export function printHelp(): void {
    console.log('GetSkill - OpenClaw 技能管理工具');
    console.log('');
    console.log('用法:');
    console.log('  getskill --help               - 显示帮助信息');
    console.log('  getskill --version            - 显示版本号');
    console.log('  getskill search <关键词>      - 从 API 搜索技能');
    console.log('  getskill search <关键词> --json - JSON 格式输出搜索结果');
    console.log('  getskill install <技能名称>   - 通过 git clone 安装技能');
    console.log('  getskill install <技能名称> --version <tag> - 安装指定版本');
    console.log('  getskill update <技能名称>    - 通过 git pull 更新技能');
    console.log(
        '  getskill update <技能名称> --version <tag> - 切换到指定版本'
    );
    console.log('  getskill update --all         - 批量更新所有已安装技能');
    console.log('  getskill publish <目录> --repo <git-url>   - 发布技能目录');
    console.log('  getskill uninstall <技能名称> - 卸载本地技能');
    console.log('  getskill inspect <技能名称>   - 查看本地安装与缓存状态');
    console.log('  getskill list                 - 列出本地技能');
    console.log('  getskill path                 - 显示目录路径');
    console.log('  getskill config set <URL>     - 设置自定义 API 地址');
    console.log('  getskill config get           - 查看当前 API 地址');
    console.log('  getskill clean                - 清理 git 缓存');
    console.log('');
    console.log('示例:');
    console.log('  getskill install pdf-extract');
    console.log('  getskill install skills/xejrax_pdf-extract');
    console.log('  getskill install pdf-extract --version v1.0.0');
    console.log('  getskill search pdf --json');
    console.log('  getskill update pdf-extract');
    console.log('  getskill update --all');
    console.log(
        '  getskill publish ./my-skill --repo https://example.com/my-skill.git'
    );
    console.log('  getskill inspect pdf-extract');
    console.log('');
    console.log(`当前 API: ${getBaseUrl()}`);
    console.log(`技能目录: ${getSkillsDirectory()}`);
    console.log(`缓存目录: ${getSkillsCacheDirectory()}`);
}

export function getCliVersion(): string {
    const candidatePaths = [
        path.join(__dirname, 'package.json'),
        path.resolve(__dirname, '..', 'package.json')
    ];

    try {
        for (const packageJsonPath of candidatePaths) {
            if (!fs.existsSync(packageJsonPath)) {
                continue;
            }

            const packageJson = JSON.parse(
                fs.readFileSync(packageJsonPath, 'utf8')
            ) as {
                version?: string;
            };
            return packageJson.version || 'unknown';
        }

        return 'unknown';
    } catch {
        return 'unknown';
    }
}

export async function cli(): Promise<void> {
    const args = process.argv.slice(2);
    const command = args[0];

    try {
        switch (command) {
            case '--help':
            case '-h':
            case 'help':
                printHelp();
                break;

            case '--version':
            case '-v':
            case 'version':
                console.log(getCliVersion());
                break;

            case 'search': {
                const { positionals, options } = parseCommandOptions(
                    args.slice(1)
                );
                const keyword = positionals[0];
                if (!keyword) {
                    console.error('请提供搜索关键词');
                    console.log('用法: getskill search <关键词>');
                    process.exit(1);
                }

                const results = await searchSkills(keyword);

                if (options.json) {
                    console.log(
                        JSON.stringify(
                            {
                                keyword,
                                count: results.length,
                                results
                            },
                            null,
                            2
                        )
                    );
                    break;
                }

                if (results.length === 0) {
                    console.log('未找到相关技能');
                    console.log(
                        `提示: 尝试使用不同的关键词，或访问 ${getBaseUrl()} 查看所有可用技能`
                    );
                    break;
                }

                console.log(`找到 ${results.length} 个技能:\n`);
                results.forEach((skill, index) => {
                    console.log(`${index + 1}. ${skill.full_name}`);
                    if (skill.description) {
                        console.log(`   描述: ${skill.description}`);
                    }
                    if (skill.git_url) {
                        console.log(`   Git: ${skill.git_url}`);
                    }
                    console.log('');
                });
                break;
            }

            case 'install':
            case 'get':
            case 'download': {
                const { positionals, options } = parseCommandOptions(
                    args.slice(1)
                );
                const skillName = positionals[0];
                const requestedVersion =
                    typeof options.version === 'string'
                        ? options.version
                        : undefined;

                if (!skillName) {
                    console.error('请提供技能ID或名称');
                    console.log('用法: getskill install <技能名称>');
                    console.log('示例: getskill install pdf-extract');
                    process.exit(1);
                }

                const result = await downloadSkill(skillName, {
                    version: requestedVersion
                });
                console.log('\n技能已安装到 skills 目录:');
                result.files.forEach((file) => console.log(`  - ${file}`));
                console.log(`\nGit 仓库缓存: ${result.repoPath}`);
                if (result.requestedVersion) {
                    console.log(`已安装版本: ${result.requestedVersion}`);
                }
                break;
            }

            case 'update': {
                const { positionals, options } = parseCommandOptions(
                    args.slice(1)
                );

                if (options.all) {
                    const results = await updateAllSkills();
                    if (results.length === 0) {
                        console.log('当前没有记录到可批量更新的技能。');
                        break;
                    }

                    const successCount = results.filter(
                        (item) => item.ok
                    ).length;
                    const failed = results.filter((item) => !item.ok);

                    console.log(
                        `批量更新完成：${successCount}/${results.length} 个技能成功。`
                    );
                    if (failed.length > 0) {
                        console.log('以下技能更新失败：');
                        failed.forEach((item) => {
                            console.log(`  - ${item.skillName}: ${item.error}`);
                        });
                    }
                    break;
                }

                const skillName = positionals[0];
                const requestedVersion =
                    typeof options.version === 'string'
                        ? options.version
                        : undefined;

                if (!skillName) {
                    console.error('请提供技能名称');
                    console.log('用法: getskill update <技能名称>');
                    console.log('示例: getskill update pdf-extract');
                    process.exit(1);
                }

                const result = await updateSkill(skillName, {
                    version: requestedVersion
                });
                console.log('\n技能已更新到 skills 目录:');
                result.files.forEach((file) => console.log(`  - ${file}`));
                if (result.requestedVersion) {
                    console.log(`已切换到版本: ${result.requestedVersion}`);
                }
                break;
            }

            case 'publish': {
                const { positionals, options } = parseCommandOptions(
                    args.slice(1)
                );
                const skillPath = positionals[0];
                const repoUrl =
                    typeof options.repo === 'string' ? options.repo : undefined;
                const branch =
                    typeof options.branch === 'string'
                        ? options.branch
                        : undefined;
                const message =
                    typeof options.message === 'string'
                        ? options.message
                        : undefined;

                if (!skillPath) {
                    console.error('请提供技能目录路径');
                    console.log(
                        '用法: getskill publish <目录> --repo <git-url> [--branch main] [--message "..."]'
                    );
                    process.exit(1);
                }

                const result = await publishSkill(skillPath, {
                    repoUrl,
                    branch,
                    message
                });

                console.log('\n发布完成:');
                console.log(`  目录: ${result.skillPath}`);
                console.log(`  远程: ${result.remoteUrl}`);
                console.log(`  分支: ${result.branch}`);
                console.log(
                    `  本次是否提交新变更: ${result.committed ? '是' : '否'}`
                );
                break;
            }

            case 'uninstall': {
                if (!args[1]) {
                    console.error('请提供技能名称');
                    console.log(
                        '用法: getskill uninstall <技能名称> [--keep-cache]'
                    );
                    process.exit(1);
                }

                const result = await uninstallSkill(args[1], {
                    removeCache: !args.includes('--keep-cache')
                });

                console.log('\n卸载结果:');
                console.log(
                    `  技能目录: ${result.removedInstall ? '已删除' : '不存在'}`
                );
                console.log(
                    `  缓存仓库: ${result.removedCache ? '已删除' : '保留或不存在'}`
                );
                break;
            }

            case 'inspect': {
                if (!args[1]) {
                    console.error('请提供技能名称');
                    console.log('用法: getskill inspect <技能名称>');
                    process.exit(1);
                }

                const info = getInstalledSkillInfo(args[1]);
                console.log(`技能名称: ${info.skillName}`);
                console.log(`本地目录: ${info.localSkillName}`);
                console.log(`已安装: ${info.installed ? '是' : '否'}`);
                console.log(`已缓存: ${info.cached ? '是' : '否'}`);
                console.log(`技能路径: ${info.skillDir}`);
                console.log(`缓存路径: ${info.repoPath}`);

                if (info.state) {
                    console.log(
                        `最后动作: ${info.state.lastAction || 'unknown'}`
                    );
                    console.log(
                        `安装时间: ${info.state.installedAt || 'unknown'}`
                    );
                    console.log(
                        `更新时间: ${info.state.updatedAt || 'unknown'}`
                    );
                    console.log(
                        `Commit: ${info.state.gitCommitHash || 'unknown'}`
                    );
                } else {
                    console.log('状态文件中暂无该技能记录。');
                }
                break;
            }

            case 'list': {
                const skills = listLocalSkills();
                console.log(`本地已安装的技能 (${skills.length}):`);
                skills.forEach((skill, index) => {
                    console.log(`${index + 1}. ${skill}`);
                });
                break;
            }

            case 'path':
                console.log(`技能目录: ${getSkillsDirectory()}`);
                console.log(`缓存目录: ${getSkillsCacheDirectory()}`);
                break;

            case 'config':
                if (args[1] === 'set' && args[2]) {
                    const newBaseUrl = setBaseUrl(args[2]);
                    console.log(`BASE_URL 已设置为: ${newBaseUrl}`);
                } else if (args[1] === 'get') {
                    console.log(`当前 BASE_URL: ${getBaseUrl()}`);
                } else {
                    console.log('用法:');
                    console.log(
                        '  getskill config set <URL>  - 设置自定义 API 地址'
                    );
                    console.log(
                        '  getskill config get        - 查看当前 API 地址'
                    );
                }
                break;

            case 'clean': {
                const cacheDir = getSkillsCacheDirectory();
                if (fs.existsSync(cacheDir)) {
                    fs.rmSync(cacheDir, { recursive: true, force: true });
                    console.log(`已清理缓存目录: ${cacheDir}`);
                } else {
                    console.log('缓存目录不存在');
                }
                break;
            }

            default:
                printHelp();
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error('执行命令时出错:', message);
        process.exit(1);
    }
}

export {
    searchSkills,
    downloadSkill,
    updateSkill,
    updateAllSkills,
    publishSkill,
    uninstallSkill,
    listLocalSkills,
    getInstalledSkillInfo,
    getSkillsDirectory,
    getSkillsCacheDirectory,
    cloneOrUpdateRepo,
    copySkillFiles,
    repositoryHasSkillFile,
    checkGitInstalled,
    ensureGitInstalled,
    setBaseUrl,
    getBaseUrl
};

if (require.main === module) {
    void cli();
}
