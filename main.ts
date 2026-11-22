#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

import {
    AGENT_PRESETS,
    applyRuntimeOverrides,
    getAgentLabel,
    getAgentName,
    getBaseUrl,
    getConfigFilePath,
    getConfigSummary,
    getLegacyCacheDirectories,
    getSkillsCacheDirectory,
    getSkillsDirectory,
    getStateFilePath,
    listAgents,
    normalizeConfigKey,
    readConfigFile,
    setAgent,
    setBaseUrl,
    setCacheDir,
    setConfigValue,
    setSkillsDir,
    unsetConfigValue
} from './lib/config';
import logger from './lib/logger';
import { GetSkillError, getErrorCode } from './lib/errors';
import { parseCommandOptions } from './lib/cli-args';
import {
    fetchSkillMarkdown,
    fetchSkillsIndex,
    findSkillIndexEntry,
    getSkillsIndexCacheFilePath,
    repositoryHasSkillFile,
    searchSkills
} from './lib/network';
import {
    copySkillFiles,
    getInstalledSkillInfo,
    listLocalSkills,
    pruneInstallState
} from './lib/state';
import {
    cloneOrUpdateRepo,
    downloadSkill,
    restartAgentGateway,
    uninstallSkill,
    updateAllSkills,
    updateSkill
} from './lib/skill-manager';

export function printHelp(): void {
    console.log(
        'GetSkill - AI Agent 技能管理工具 (getskill.work · Cloudflare 静态托管)'
    );
    console.log('');
    console.log('用法:');
    console.log('  getskill --help               - 显示帮助信息');
    console.log('  getskill --version            - 显示版本号');
    console.log('  getskill search <关键词>      - 从技能索引搜索技能');
    console.log('  getskill search <关键词> --json - JSON 格式输出搜索结果');
    console.log(
        '  getskill search <关键词> --limit N --page N - 分页（默认每页 20 条）'
    );
    console.log(
        '  getskill search <关键词> --brief - 简介截断到约 120 字符（节省上下文）'
    );
    console.log(
        '  getskill index --categories   - 列出技能分类及数量（浏览完整索引）'
    );
    console.log(
        '  getskill index --category <分类> --json - 紧凑技能列表（默认每页 100，--limit/--page 可调）'
    );
    console.log(
        '  getskill show <技能名称>      - 预览技能 SKILL.md（远端优先，回退本地副本）'
    );
    console.log(
        '  getskill install <技能名称>   - 通过 HTTPS 下载 zip 包安装技能'
    );
    console.log(
        '  getskill install <技能名称> --version <tag> - 安装指定版本（需与站点当前版本一致）'
    );
    console.log(
        '  getskill install <技能名称> --force - 强制重装（同版本已安装时默认跳过下载）'
    );
    console.log('  getskill update <技能名称>    - 检查在线版本并更新技能');
    console.log(
        '  getskill update <技能名称> --version <tag> - 更新到指定版本'
    );
    console.log('  getskill update --all         - 批量更新所有已安装技能');
    console.log(
        '  getskill update --all --prune - 批量更新并清理索引中已下架技能的本地记录'
    );
    console.log('  getskill uninstall <技能名称> - 卸载本地技能');
    console.log('  getskill inspect <技能名称>   - 查看本地安装与缓存状态');
    console.log('  getskill list                 - 列出本地技能');
    console.log(
        '  getskill path                 - 显示 Agent 与目录/配置文件路径'
    );
    console.log(
        '  getskill agents               - 列出支持的 Agent 及当前生效项'
    );
    console.log(
        '  getskill config get [key]     - 查看配置 (base-url / agent / skills-dir / cache-dir)'
    );
    console.log('  getskill config set <key> <value> - 持久化保存配置项');
    console.log(
        '  getskill config unset <key>   - 删除配置项，恢复自动识别/默认值'
    );
    console.log('  getskill clean                - 清理下载缓存');
    console.log('');
    console.log(
        '注意: install/update 需要显式指定 agent 或 skills-dir（配置/参数/环境变量）；'
    );
    console.log(
        '      技能目录仅来自自动识别时会报错，以避免安装到非当前 Agent 的目录。'
    );
    console.log(
        '说明: 技能索引缓存在 <cache-dir>/skills-index.json，1 天内搜索直接使用本地缓存；'
    );
    console.log(
        '      搜索结果附带本地安装状态 (installed/installed_version/suggested_action)。'
    );
    console.log(
        '      search 只返回候选技能与简介，不会自动安装；由 Agent 判断后自行执行 install/update。'
    );
    console.log(
        '      install/update/uninstall/list/inspect 均支持 --json（过程日志走 stderr，stdout 为纯 JSON）。'
    );
    console.log(
        '      出错时 --json 输出 { error: { code, message } } 并以非零码退出（如 NETWORK_ERROR / SKILL_NOT_FOUND）。'
    );
    console.log('');
    console.log('全局参数（仅对本次执行生效，不写入配置文件）:');
    console.log(
        `  --agent <name>      指定目标 Agent: auto, ${AGENT_PRESETS.map(
            (preset) => preset.name
        ).join(', ')}`
    );
    console.log('  --skills-dir <path> 指定任意 Agent 的技能目录');
    console.log('  --cache-dir <path>  指定下载/解压缓存目录');
    console.log('  --base-url <url>    指定技能索引站点地址');
    console.log('');
    console.log('环境变量:');
    console.log('  GETSKILL_AGENT, GETSKILL_SKILLS_DIR, GETSKILL_CACHE_DIR');
    console.log(
        '  GETSKILL_BASE_URL, GETSKILL_HOME, GETSKILL_RESTART_CMD, GETSKILL_LOG_LEVEL'
    );
    console.log('');
    console.log('示例:');
    console.log('  getskill search pdf --json');
    console.log('  getskill install pdf-toolkit');
    console.log('  getskill update --all');
    console.log('  getskill inspect pdf-toolkit');
    console.log('  getskill config set agent claude');
    console.log('  getskill config set skills-dir ~/.my-agent/skills');
    console.log('  getskill --agent cursor install pdf-toolkit');
    console.log('');
    console.log(`当前站点: ${getBaseUrl()}`);
    console.log(`技能索引: ${getBaseUrl()}/data/skills.json`);
    console.log(`当前 Agent: ${getAgentName()} (${getAgentLabel()})`);
    console.log(`技能目录: ${getSkillsDirectory()}`);
    console.log(`缓存目录: ${getSkillsCacheDirectory()}`);
    console.log(`配置文件: ${getConfigFilePath()}`);
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

function asStringValue(
    value: string | boolean | undefined
): string | undefined {
    return typeof value === 'string' && value.trim() !== ''
        ? value.trim()
        : undefined;
}

function asNumberValue(
    value: string | boolean | undefined
): number | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * --json 模式下执行命令：把过程日志（console.log / logger.info）
 * 重定向到 stderr，保证 stdout 只输出最终的 JSON 结果。
 */
async function captureStdout<T>(fn: () => Promise<T> | T): Promise<T> {
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
        console.error(...args);
    };
    try {
        return await fn();
    } finally {
        console.log = originalLog;
    }
}

function printJson(payload: Record<string, unknown>): void {
    console.log(JSON.stringify(payload, null, 2));
}

/** --brief / index 紧凑输出用的简介截断。 */
function truncateText(text: string, maxLength: number): string {
    const normalized = (text || '').replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength
        ? `${normalized.slice(0, maxLength)}…`
        : normalized;
}

const CONFIG_SOURCE_LABELS: Record<string, string> = {
    cli: '命令行参数',
    env: '环境变量',
    file: '配置文件',
    detect: '自动识别',
    default: '默认值'
};

interface ConfigRow {
    key: string;
    value: string;
    source: string;
    savedHint: string;
}

function getConfigRows(): ConfigRow[] {
    const config = getConfigSummary();
    const persisted = readConfigFile();

    return [
        {
            key: 'base-url',
            value: config.baseUrl,
            source: config.sources.baseUrl,
            savedHint: persisted.baseUrl
                ? `已保存: ${persisted.baseUrl}`
                : '未保存，使用默认站点'
        },
        {
            key: 'agent',
            value: `${config.agent} (${config.agentLabel})`,
            source: config.sources.agent,
            savedHint: persisted.agent
                ? `已保存: ${persisted.agent}`
                : '未保存，自动识别本机 Agent'
        },
        {
            key: 'skills-dir',
            value: config.skillsDir,
            source: config.sources.skillsDir,
            savedHint: persisted.skillsDir
                ? `已保存: ${persisted.skillsDir}`
                : '未单独保存，由 agent 推导'
        },
        {
            key: 'cache-dir',
            value: config.cacheDir,
            source: config.sources.cacheDir,
            savedHint: persisted.cacheDir
                ? `已保存: ${persisted.cacheDir}`
                : '未保存，使用默认缓存目录'
        }
    ];
}

function printConfigRow(row: ConfigRow): void {
    const source = CONFIG_SOURCE_LABELS[row.source] || row.source;
    console.log(`${row.key}: ${row.value}`);
    console.log(`  来源: ${source}，${row.savedHint}`);
}

export function printConfigUsage(): void {
    console.log('用法:');
    console.log('  getskill config get [key]         - 查看全部或指定配置项');
    console.log('  getskill config set <key> <value> - 保存配置项到配置文件');
    console.log('  getskill config unset <key>       - 删除已保存的配置项');
    console.log('  getskill config path              - 显示配置文件路径');
    console.log('  getskill config agents            - 列出支持的 Agent');
    console.log('');
    console.log('可用配置项: base-url, agent, skills-dir, cache-dir');
    console.log('示例:');
    console.log(
        '  getskill config set base-url https://custom-index.example.com'
    );
    console.log('  getskill config set agent claude');
    console.log('  getskill config set skills-dir ~/.my-agent/skills');
    console.log('  getskill config unset agent');
}

export function printConfigValues(key?: string): void {
    const rows = getConfigRows();

    if (key) {
        const normalizedKey = normalizeConfigKey(key);
        const targetKey = normalizedKey
            .replace(/([A-Z])/g, '-$1')
            .toLowerCase();
        const row = rows.find((item) => item.key === targetKey);

        if (!row) {
            throw new Error(`未知配置项: ${key}`);
        }

        printConfigRow(row);
        console.log(`配置文件: ${getConfigFilePath()}`);
        return;
    }

    rows.forEach(printConfigRow);
    console.log(`配置文件: ${getConfigFilePath()}`);
    console.log(`状态文件: ${getStateFilePath()}`);
}

export function printAgents(): void {
    const config = getConfigSummary();
    console.log(`当前 Agent: ${config.agent} (${config.agentLabel})`);
    console.log(`技能目录: ${config.skillsDir}`);
    console.log(
        `目录来源: ${
            CONFIG_SOURCE_LABELS[config.sources.skillsDir] ||
            config.sources.skillsDir
        }`
    );
    console.log('');
    console.log('内置 Agent 预设 (* 表示当前生效):');

    listAgents().forEach((agent) => {
        const mark = agent.active ? '*' : ' ';
        const exists = agent.exists ? '目录已存在' : '目录未创建';
        console.log(
            ` ${mark} ${agent.name.padEnd(10)} ${agent.label.padEnd(20)} ${
                agent.skillsDir
            } (${exists})`
        );
    });

    console.log('');
    console.log('其他 Agent / 自定义目录（任选一种方式）:');
    console.log('  getskill config set skills-dir <path>');
    console.log('  getskill --skills-dir <path> install <技能名称>');
    console.log('  GETSKILL_SKILLS_DIR=<path> getskill install <技能名称>');
}

export function printPaths(): void {
    const config = getConfigSummary();
    console.log(`Agent: ${config.agent} (${config.agentLabel})`);
    console.log(`技能目录: ${config.skillsDir}`);
    console.log(`缓存目录: ${config.cacheDir}`);
    console.log(`配置文件: ${config.configFile}`);
    console.log(`状态文件: ${config.stateFile}`);
    console.log(`站点地址: ${config.baseUrl}`);
    console.log(
        `重载命令: ${
            config.restartCommand ||
            '(未配置，可通过 GETSKILL_RESTART_CMD 指定)'
        }`
    );
}

export function handleConfigCommand(args: string[]): void {
    const [action, ...rest] = args;

    switch ((action || 'get').toLowerCase()) {
        case 'get':
        case 'list':
        case 'show':
            printConfigValues(rest[0]);
            break;

        case 'set': {
            if (rest.length === 0) {
                printConfigUsage();
                process.exit(1);
            }

            if (rest.length === 1) {
                const rawUrl = rest[0];
                if (!/^https?:\/\//i.test(rawUrl.trim())) {
                    throw new Error(
                        `config set <URL> 只接受 http(s) 地址（收到: ${rawUrl}）。设置 Agent 请用: getskill config set agent <name>`
                    );
                }

                setConfigValue('base-url', rawUrl);
                printConfigValues('base-url');
                break;
            }

            const [key, ...valueParts] = rest;
            setConfigValue(key, valueParts.join(' '));
            printConfigValues(key);
            break;
        }

        case 'unset':
        case 'delete':
        case 'remove':
        case 'reset': {
            if (!rest[0]) {
                printConfigUsage();
                process.exit(1);
            }

            unsetConfigValue(rest[0]);
            console.log(`已删除配置项: ${rest[0]}`);
            printConfigValues(rest[0]);
            break;
        }

        case 'path':
            console.log(getConfigFilePath());
            break;

        case 'agents':
            printAgents();
            break;

        default:
            printConfigUsage();
            process.exit(1);
    }
}

export async function cli(): Promise<void> {
    const args = process.argv.slice(2);

    // 全局参数只影响本次执行，不会写入配置文件；
    // 同时过滤掉参数本身，使 `getskill --agent cursor path` 这类写法生效。
    const { positionals, options } = parseCommandOptions(args);
    applyRuntimeOverrides({
        agent: asStringValue(options.agent),
        skillsDir: asStringValue(options['skills-dir']),
        cacheDir: asStringValue(options['cache-dir']),
        baseUrl: asStringValue(options['base-url'])
    });

    const restArgs = positionals.slice(1);
    let command = positionals[0];
    let searchKeyword: string | null = null;

    if (args.includes('--help') || args.includes('-h')) {
        command = '--help';
    } else if (
        !command &&
        (args.includes('--version') || args.includes('-v'))
    ) {
        command = '--version';
    }

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
                const keyword = restArgs[0];
                if (!keyword) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '请提供搜索关键词。用法: getskill search <关键词> [--json] [--limit N] [--page N] [--brief]'
                    );
                }
                searchKeyword = keyword;

                const results = await searchSkills(keyword, {
                    limit: asNumberValue(options.limit),
                    page: asNumberValue(options.page)
                });
                const brief = options.brief === true;
                const displayResults = brief
                    ? results.map((skill) => ({
                          ...skill,
                          description: truncateText(skill.description, 120)
                      }))
                    : results;

                if (options.json) {
                    const payload: Record<string, unknown> = {
                        keyword,
                        count: displayResults.length,
                        results: displayResults
                    };
                    if (displayResults.length === 0) {
                        payload.message = `未找到与 "${keyword}" 匹配的技能`;
                        payload.hint =
                            'Agent 可用 getskill index --categories 查看分类，再用 getskill index --category <分类> --json 浏览紧凑技能列表，按名称/简介挑选后执行 getskill install <技能名称>；也可更换关键词重新搜索';
                        const indexFile = getSkillsIndexCacheFilePath();
                        if (fs.existsSync(indexFile)) {
                            payload.index_file = indexFile;
                        }
                        payload.index_url = `${getBaseUrl()}/data/skills.json`;
                    }
                    printJson(payload);
                    break;
                }

                if (displayResults.length === 0) {
                    console.log(`未找到与 "${keyword}" 匹配的技能。`);
                    console.log('');
                    console.log(
                        '提示: Agent 可自行浏览完整技能索引，按名称/简介挑选合适的技能，'
                    );
                    console.log(
                        '      再执行 getskill install <技能名称> 安装使用；也可更换关键词重新搜索。'
                    );
                    console.log('      浏览索引（紧凑输出，适合 Agent）:');
                    console.log('        getskill index --categories');
                    console.log(
                        '        getskill index --category <分类> --json'
                    );
                    const indexFile = getSkillsIndexCacheFilePath();
                    if (fs.existsSync(indexFile)) {
                        console.log(`      本地索引文件: ${indexFile}`);
                        console.log(
                            '        （JSON 格式，skills 数组含 id/name/description/version 等字段）'
                        );
                    }
                    console.log(
                        `      在线索引: ${getBaseUrl()}/data/skills.json`
                    );
                    break;
                }

                console.log(`找到 ${displayResults.length} 个技能:\n`);
                displayResults.forEach((skill, index) => {
                    console.log(
                        `${index + 1}. ${skill.full_name} (v${skill.version})`
                    );
                    if (skill.description) {
                        console.log(`   描述: ${skill.description}`);
                    }
                    if (skill.category) {
                        console.log(`   分类: ${skill.category}`);
                    }
                    if (skill.download_url) {
                        console.log(`   下载: ${skill.download_url}`);
                    }
                    if (!skill.installed) {
                        console.log(
                            `   本地: 未安装（如需要: getskill install ${skill.full_name}）`
                        );
                    } else if (skill.suggested_action === 'skip') {
                        console.log(
                            `   本地: 已安装 v${skill.installed_version || 'unknown'}（同版本，无需重复安装）`
                        );
                    } else {
                        console.log(
                            `   本地: 已安装 v${skill.installed_version || 'unknown'}（如需要: getskill update ${skill.full_name}）`
                        );
                    }
                    console.log('');
                });
                console.log(
                    '提示: search 只返回候选技能与简介，不会自动安装任何技能。'
                );
                console.log(
                    '      请由 Agent 根据简介判断需要哪个技能，再自行执行 getskill install / update <技能名称>。'
                );
                break;
            }

            case 'install':
            case 'get':
            case 'download': {
                const skillName = restArgs[0];
                const requestedVersion =
                    typeof options.version === 'string'
                        ? options.version
                        : undefined;

                if (!skillName) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '请提供技能ID或名称。用法: getskill install <技能名称>，示例: getskill install pdf-toolkit'
                    );
                }

                const downloadOptions = {
                    version: requestedVersion,
                    force: options.force === true
                };
                const result = options.json
                    ? await captureStdout(() =>
                          downloadSkill(skillName, downloadOptions)
                      )
                    : await downloadSkill(skillName, downloadOptions);

                if (options.json) {
                    printJson({
                        command: 'install',
                        status: result.upToDate ? 'skipped' : 'installed',
                        skill: result.skillName,
                        version: result.version ?? null,
                        up_to_date: Boolean(result.upToDate),
                        install_dir: result.files[0] ?? null,
                        files: result.files,
                        cache_dir: result.repoPath,
                        agent: getAgentName()
                    });
                    break;
                }

                if (result.upToDate) {
                    console.log(
                        `\n技能已安装且为最新版本 (v${result.version || 'unknown'})，已跳过重复安装。`
                    );
                    console.log(
                        '如需强制重装: getskill install <技能名称> --force'
                    );
                    break;
                }
                console.log(
                    `\n目标 Agent: ${getAgentName()} (${getAgentLabel()})`
                );
                console.log('技能已安装到 skills 目录:');
                result.files.forEach((file) => console.log(`  - ${file}`));
                console.log(`\n本地缓存: ${result.repoPath}`);
                if (result.version) {
                    console.log(`已安装版本: ${result.version}`);
                }
                break;
            }

            case 'update': {
                if (options.all) {
                    const updateAllOptions = {
                        prune: options.prune === true
                    };
                    const results = options.json
                        ? await captureStdout(() =>
                              updateAllSkills(updateAllOptions)
                          )
                        : await updateAllSkills(updateAllOptions);

                    if (options.json) {
                        printJson({
                            command: 'update',
                            all: true,
                            total: results.length,
                            succeeded: results.filter((item) => item.ok).length,
                            results
                        });
                        break;
                    }

                    if (results.length === 0) {
                        console.log('当前没有记录到可批量更新的技能。');
                        console.log(
                            `技能目录: ${getSkillsDirectory()}（可用 getskill path 查看，或用 --agent/--skills-dir 切换）`
                        );
                        break;
                    }

                    const successCount = results.filter(
                        (item) => item.ok
                    ).length;
                    const skipped = results.filter((item) => item.skipped);
                    const failed = results.filter(
                        (item) => !item.ok && !item.skipped
                    );

                    console.log(
                        `批量更新完成：${successCount}/${results.length} 个技能成功。`
                    );

                    if (skipped.length > 0) {
                        console.log(
                            '以下技能在索引中已不存在，已跳过（非失败）：'
                        );
                        skipped.forEach((item) => {
                            console.log(`  - ${item.skillName}: ${item.error}`);
                        });
                        if (options.prune !== true) {
                            console.log(
                                '提示: 执行 getskill update --all --prune 可清理这些失效的本地记录。'
                            );
                        }
                    }

                    if (failed.length > 0) {
                        console.log('以下技能更新失败：');
                        failed.forEach((item) => {
                            console.log(`  - ${item.skillName}: ${item.error}`);
                        });
                    }
                    break;
                }

                const skillName = restArgs[0];
                const requestedVersion =
                    typeof options.version === 'string'
                        ? options.version
                        : undefined;

                if (!skillName) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '请提供技能名称。用法: getskill update <技能名称>，示例: getskill update pdf-toolkit'
                    );
                }

                const updateOptions = { version: requestedVersion };
                const result = options.json
                    ? await captureStdout(() =>
                          updateSkill(skillName, updateOptions)
                      )
                    : await updateSkill(skillName, updateOptions);

                if (options.json) {
                    printJson({
                        command: 'update',
                        status: result.upToDate ? 'up_to_date' : 'updated',
                        skill: result.skillName,
                        version: result.version ?? null,
                        up_to_date: Boolean(result.upToDate),
                        install_dir: result.files[0] ?? null,
                        files: result.files,
                        cache_dir: result.repoPath,
                        agent: getAgentName()
                    });
                    break;
                }

                if (result.upToDate) {
                    console.log(
                        `\n技能已是最新版本 (v${result.version || 'unknown'})，无需更新。`
                    );
                    break;
                }

                console.log(
                    `\n目标 Agent: ${getAgentName()} (${getAgentLabel()})`
                );
                console.log('技能已更新到 skills 目录:');
                result.files.forEach((file) => console.log(`  - ${file}`));
                if (result.version) {
                    console.log(`当前版本: ${result.version}`);
                }
                break;
            }

            case 'uninstall': {
                if (!restArgs[0]) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '请提供技能名称。用法: getskill uninstall <技能名称> [--keep-cache]'
                    );
                }

                const uninstallOptions = {
                    removeCache: options['keep-cache'] !== true
                };
                const result = options.json
                    ? await captureStdout(() =>
                          uninstallSkill(restArgs[0], uninstallOptions)
                      )
                    : await uninstallSkill(restArgs[0], uninstallOptions);

                if (options.json) {
                    printJson({
                        command: 'uninstall',
                        status: 'removed',
                        skill: result.skillName,
                        removed_install: result.removedInstall,
                        removed_cache: result.removedCache,
                        skill_dir: result.skillDir,
                        cache_dir: result.repoPath,
                        agent: getAgentName()
                    });
                    break;
                }

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
                if (!restArgs[0]) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '请提供技能名称。用法: getskill inspect <技能名称>'
                    );
                }

                const info = getInstalledSkillInfo(restArgs[0]);
                if (options.json) {
                    printJson({ command: 'inspect', ...info });
                    break;
                }
                console.log(`技能名称: ${info.skillName}`);
                console.log(`本地目录: ${info.localSkillName}`);
                console.log(`目标 Agent: ${info.agent} (${info.agentLabel})`);
                console.log(`已安装: ${info.installed ? '是' : '否'}`);
                console.log(`已缓存: ${info.cached ? '是' : '否'}`);
                console.log(`技能路径: ${info.skillDir}`);
                console.log(`技能目录: ${info.skillsDir}`);
                console.log(`缓存目录: ${info.cacheDir}`);
                console.log(`解压路径: ${info.repoPath}`);

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
                        `版本: ${info.state.version || info.state.gitCommitHash || 'unknown'}`
                    );
                } else {
                    console.log('状态文件中暂无该技能记录。');
                }
                break;
            }

            case 'list': {
                const skills = options.json
                    ? await captureStdout(() => listLocalSkills())
                    : listLocalSkills();
                if (options.json) {
                    printJson({
                        command: 'list',
                        agent: getAgentName(),
                        agent_label: getAgentLabel(),
                        skills_dir: getSkillsDirectory(),
                        count: skills.length,
                        skills
                    });
                    break;
                }
                console.log(
                    `本地已安装的技能 (${skills.length}) · Agent: ${getAgentName()} · 目录: ${getSkillsDirectory()}`
                );
                skills.forEach((skill, index) => {
                    console.log(`${index + 1}. ${skill}`);
                });
                break;
            }

            case 'index': {
                const entries = await fetchSkillsIndex();

                if (options.categories) {
                    const counts = new Map<string, number>();
                    entries.forEach((entry) => {
                        const category = entry.category || '未分类';
                        counts.set(category, (counts.get(category) || 0) + 1);
                    });
                    const categories = Array.from(counts.entries())
                        .map(([category, count]) => ({ category, count }))
                        .sort((a, b) => b.count - a.count);

                    if (options.json) {
                        printJson({
                            command: 'index',
                            total: entries.length,
                            count: categories.length,
                            categories
                        });
                        break;
                    }

                    console.log(
                        `技能索引共 ${entries.length} 个技能，${categories.length} 个分类:\n`
                    );
                    categories.forEach((item) => {
                        console.log(`  ${item.category} (${item.count})`);
                    });
                    console.log('');
                    console.log(
                        '浏览分类: getskill index --category <分类> --json'
                    );
                    break;
                }

                const categoryFilter = asStringValue(options.category);
                const filtered = categoryFilter
                    ? entries.filter(
                          (entry) =>
                              (entry.category || '未分类').toLowerCase() ===
                              categoryFilter.toLowerCase()
                      )
                    : entries;
                const limit = asNumberValue(options.limit) ?? 100;
                const page = asNumberValue(options.page) ?? 1;
                const start = (page - 1) * limit;
                const pageItems = filtered
                    .slice(start, start + limit)
                    .map((entry) => ({
                        name: entry.id,
                        description: truncateText(entry.description || '', 120),
                        version: entry.version || 'unknown',
                        category: entry.category || '未分类'
                    }));
                const hasMore = start + pageItems.length < filtered.length;

                if (options.json) {
                    const payload: Record<string, unknown> = {
                        command: 'index',
                        category: categoryFilter ?? null,
                        total: filtered.length,
                        page,
                        limit,
                        count: pageItems.length,
                        skills: pageItems
                    };
                    if (pageItems.length === 0 && categoryFilter) {
                        payload.message = `分类 "${categoryFilter}" 下没有技能`;
                        payload.hint =
                            '用 getskill index --categories 查看全部分类名称';
                    } else if (hasMore) {
                        payload.hint = `还有更多结果: 使用 --page ${
                            page + 1
                        } 翻页，或 --category <分类> 缩小范围`;
                    }
                    printJson(payload);
                    break;
                }

                if (pageItems.length === 0) {
                    console.log(
                        categoryFilter
                            ? `分类 "${categoryFilter}" 下没有技能。`
                            : '技能索引为空。'
                    );
                    if (categoryFilter) {
                        console.log(
                            '提示: getskill index --categories 查看全部分类名称'
                        );
                    }
                    break;
                }

                console.log(
                    `技能索引 (${
                        categoryFilter ? `分类: ${categoryFilter}，` : ''
                    }共 ${filtered.length} 个，第 ${page} 页显示 ${
                        pageItems.length
                    } 个):\n`
                );
                pageItems.forEach((item, index) => {
                    console.log(
                        `${start + index + 1}. ${item.name} (v${item.version})`
                    );
                    if (item.description) {
                        console.log(`   ${item.description}`);
                    }
                });
                if (hasMore) {
                    console.log('');
                    console.log(
                        `更多结果: getskill index --page ${page + 1}${
                            categoryFilter
                                ? ` --category ${categoryFilter}`
                                : ''
                        }`
                    );
                }
                break;
            }

            case 'agents':
                printAgents();
                break;

            case 'show': {
                const skillName = restArgs[0];
                if (!skillName) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '请提供技能名称。用法: getskill show <技能名称> [--json]'
                    );
                }

                const entry = await findSkillIndexEntry(skillName);
                if (!entry) {
                    throw new GetSkillError(
                        'SKILL_NOT_FOUND',
                        `技能不存在: ${skillName}，请先使用 getskill search <关键词> 查询可用技能`
                    );
                }

                let markdown = await fetchSkillMarkdown(skillName);
                let source: 'remote' | 'local' | null = markdown
                    ? 'remote'
                    : null;
                if (!markdown) {
                    // 站点未提供预览时回退到本地已安装/已缓存的 SKILL.md
                    const info = getInstalledSkillInfo(skillName);
                    for (const dir of [info.skillDir, info.repoPath]) {
                        const file = path.join(dir, 'SKILL.md');
                        if (fs.existsSync(file)) {
                            markdown = fs.readFileSync(file, 'utf8');
                            source = 'local';
                            break;
                        }
                    }
                }

                if (options.json) {
                    const payload: Record<string, unknown> = {
                        command: 'show',
                        skill: entry.id,
                        version: entry.version || 'unknown',
                        description: entry.description || '',
                        source,
                        skill_md: markdown
                    };
                    if (!markdown) {
                        payload.hint =
                            '站点未提供 SKILL.md 预览且本地无副本；可执行 getskill install <技能名称> 后在技能目录查看 SKILL.md';
                    }
                    printJson(payload);
                    break;
                }

                console.log(
                    `技能: ${entry.id} (v${entry.version || 'unknown'})`
                );
                if (entry.description) {
                    console.log(`描述: ${entry.description}`);
                }
                console.log('');
                if (markdown) {
                    console.log(markdown);
                } else {
                    console.log(
                        '站点未提供 SKILL.md 预览且本地无副本；可执行 getskill install <技能名称> 后在技能目录查看 SKILL.md。'
                    );
                }
                break;
            }

            case 'path':
                printPaths();
                break;

            case 'config':
                handleConfigCommand(restArgs);
                break;

            case 'clean': {
                const cacheDir = getSkillsCacheDirectory();
                let cleaned = false;

                if (fs.existsSync(cacheDir)) {
                    fs.rmSync(cacheDir, { recursive: true, force: true });
                    console.log(`已清理缓存目录: ${cacheDir}`);
                    cleaned = true;
                }

                getLegacyCacheDirectories().forEach((legacyDir) => {
                    if (fs.existsSync(legacyDir)) {
                        fs.rmSync(legacyDir, { recursive: true, force: true });
                        console.log(`已清理历史缓存目录: ${legacyDir}`);
                        cleaned = true;
                    }
                });

                if (!cleaned) {
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
        if (options.json) {
            const payload: Record<string, unknown> = {
                command: command ?? null,
                error: { code: getErrorCode(error), message }
            };
            if (searchKeyword) {
                payload.keyword = searchKeyword;
            }
            printJson(payload);
        }
        process.exit(1);
    }
}

export {
    searchSkills,
    downloadSkill,
    updateSkill,
    updateAllSkills,
    uninstallSkill,
    listLocalSkills,
    getInstalledSkillInfo,
    pruneInstallState,
    restartAgentGateway,
    getSkillsDirectory,
    getSkillsCacheDirectory,
    getConfigSummary,
    getConfigFilePath,
    getStateFilePath,
    listAgents,
    getAgentName,
    getAgentLabel,
    setConfigValue,
    unsetConfigValue,
    setBaseUrl,
    setAgent,
    setSkillsDir,
    setCacheDir,
    getBaseUrl,
    cloneOrUpdateRepo,
    copySkillFiles,
    repositoryHasSkillFile,
    fetchSkillMarkdown,
    fetchSkillsIndex
};

if (require.main === module) {
    void cli();
}
