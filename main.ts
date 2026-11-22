#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

import {
    AGENT_PRESETS,
    applyRuntimeOverrides,
    getAgentLabel,
    getAgentName,
    getAgentRestartCommand,
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
    setRequestTimeoutOverride,
    setSkillsDir,
    unsetConfigValue
} from './lib/config';
import logger from './lib/logger';
import { GetSkillError, getErrorCode } from './lib/errors';
import { parseCommandOptions, positiveIntOption } from './lib/cli-args';
import {
    fetchSkillMarkdown,
    fetchSkillsIndex,
    findSkillIndexEntry,
    getSkillsIndexCacheFilePath,
    getSkillsIndexMeta,
    peekSkillsIndexCache,
    repositoryHasSkillFile,
    searchSkills,
    searchSkillsPage
} from './lib/network';
import {
    copySkillFiles,
    getInstalledSkillInfo,
    listLocalSkills,
    listLocalSkillsDetailed,
    listInstalledSkillNames,
    pruneInstallState,
    readInstallState,
    recordMatchesCurrentSkillsDir
} from './lib/state';
import {
    cloneOrUpdateRepo,
    downloadSkill,
    restartAgentGateway,
    uninstallSkill,
    updateAllSkills,
    updateSkill
} from './lib/skill-manager';
import type { RestartAgentResult } from './lib/skill-manager';
import { compareVersions } from './lib/version';
import type { DownloadResult } from './lib/types';

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
    console.log(
        '  getskill update --all --dry-run - 预演批量更新（只读，不写入）'
    );
    console.log('  getskill uninstall <技能名称> - 卸载本地技能');
    console.log(
        '  getskill install/update/uninstall <名称1> <名称2> ... - 批量操作（逐项结果+计数）'
    );
    console.log(
        '  getskill install <技能名称> --dry-run - 预演安装（返回计划，不下载不写入）'
    );
    console.log('  getskill inspect <技能名称>   - 查看本地安装与缓存状态');
    console.log('  getskill list                 - 列出本地技能');
    console.log(
        '  getskill status               - 一次性查看配置/索引缓存/已安装技能/失效记录/锁状态'
    );
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
    console.log(
        '  getskill clean --keep-index   - 清理缓存但保留索引缓存 skills-index.json'
    );
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
        '      所有命令均支持 --json（过程日志走 stderr，stdout 为纯 JSON）；--help --json 输出机器可读命令表。'
    );
    console.log(
        '      出错时 --json 输出 { command, skill?, error: { code, message } } 并以非零码退出'
    );
    console.log(
        '      （NETWORK_ERROR / SKILL_NOT_FOUND / VERSION_NOT_AVAILABLE / TARGET_NOT_CONFIGURED / STATE_LOCKED / INVALID_ARGS / AMBIGUOUS_SKILL）。'
    );
    console.log(
        '      未知命令/未知选项/非法数值一律报 INVALID_ARGS；批量操作部分失败时也以非零码退出。'
    );
    console.log(
        '      版本比较采用 semver：本地版本不低于站点版本时 install/update 跳过，不会静默降级。'
    );
    console.log(
        '      install/update 信封含 next_step/skill_md_path/reload_command/reloaded/local_modified/index 字段。'
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
    console.log('  --timeout <ms>      网络请求超时（默认 60000 毫秒）');
    console.log(
        '  -V <tag>            install/update 的技能版本（-v/--version 为 CLI 版本）'
    );
    console.log('  --                  终止选项解析，其后全部视为位置参数');
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

/** --help --json 的机器可读命令表。 */
function buildHelpPayload(): Record<string, unknown> {
    return {
        command: 'help',
        version: getCliVersion(),
        commands: [
            {
                name: 'search',
                usage: 'getskill search <关键词> [--json] [--brief] [--limit N] [--page N]',
                description:
                    '搜索技能（空格分词 AND 匹配），附带本地安装状态与分页元数据'
            },
            {
                name: 'index',
                usage: 'getskill index [--categories | --category <分类>] [--json] [--limit N] [--page N]',
                description: '浏览完整技能索引（分类统计或紧凑技能列表）'
            },
            {
                name: 'show',
                usage: 'getskill show <技能名称> [--json]',
                description: '预览 SKILL.md（远端优先，回退本地副本）'
            },
            {
                name: 'install',
                usage: 'getskill install <技能名称...> [--json] [--version <tag>] [--force] [--dry-run]',
                description: '安装技能（支持多个名称批量；别名 get/download）'
            },
            {
                name: 'update',
                usage: 'getskill update <技能名称...> | --all [--prune] [--json] [--dry-run]',
                description: '更新技能；--all 批量更新，失败时非零退出'
            },
            {
                name: 'uninstall',
                usage: 'getskill uninstall <技能名称...> [--keep-cache] [--json] [--dry-run]',
                description:
                    '卸载技能（支持批量；未安装时 status=not_installed）'
            },
            {
                name: 'list',
                usage: 'getskill list [--json]',
                description: '列出本地技能（含版本与 managed 标注）'
            },
            {
                name: 'inspect',
                usage: 'getskill inspect <技能名称> [--json]',
                description: '查看单个技能的安装/缓存/本地修改状态'
            },
            {
                name: 'status',
                usage: 'getskill status [--json]',
                description:
                    '一次性返回配置/目录/索引缓存/已安装技能/失效记录/锁状态'
            },
            {
                name: 'path',
                usage: 'getskill path [--json]',
                description: '显示 Agent 与目录/配置文件路径'
            },
            {
                name: 'agents',
                usage: 'getskill agents [--json]',
                description: '列出支持的 Agent 预设及当前生效项'
            },
            {
                name: 'config',
                usage: 'getskill config get|set|unset [key] [value] [--json]',
                description: '查看/持久化/删除配置项'
            },
            {
                name: 'clean',
                usage: 'getskill clean [--keep-index] [--json]',
                description: '清理下载缓存（默认含索引缓存，--keep-index 保留）'
            },
            {
                name: 'version',
                usage: 'getskill --version [--json]',
                description: '显示 CLI 版本号'
            }
        ],
        global_flags: [
            '--json',
            '--agent <name>',
            '--skills-dir <path>',
            '--cache-dir <path>',
            '--base-url <url>',
            '--timeout <ms>',
            '--dry-run',
            '--',
            '-V <tag> (技能版本)',
            '-v/--version (CLI 版本)'
        ],
        error_codes: [
            'NETWORK_ERROR',
            'SKILL_NOT_FOUND',
            'VERSION_NOT_AVAILABLE',
            'TARGET_NOT_CONFIGURED',
            'STATE_LOCKED',
            'INVALID_ARGS',
            'AMBIGUOUS_SKILL',
            'UNKNOWN_ERROR'
        ],
        env_vars: [
            'GETSKILL_AGENT',
            'GETSKILL_SKILLS_DIR',
            'GETSKILL_CACHE_DIR',
            'GETSKILL_BASE_URL',
            'GETSKILL_HOME',
            'GETSKILL_STATE_FILE',
            'GETSKILL_RESTART_CMD',
            'GETSKILL_LOG_LEVEL'
        ],
        json_contract:
            '所有命令支持 --json；stdout 为纯 JSON，过程日志走 stderr；出错时输出 { command, skill?, error: { code, message } } 并以非零码退出'
    };
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

/** 命令别名归一：错误信封中的 command 始终输出规范命令名。 */
const COMMAND_ALIASES: Record<string, string> = {
    get: 'install',
    download: 'install'
};

const KNOWN_COMMANDS = [
    'search',
    'index',
    'show',
    'install',
    'update',
    'uninstall',
    'list',
    'inspect',
    'status',
    'path',
    'agents',
    'config',
    'clean',
    'help',
    'version'
];

function editDistance(a: string, b: string): number {
    const dp: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        let previous = dp[0];
        dp[0] = i;
        for (let j = 1; j <= b.length; j += 1) {
            const temp = dp[j];
            dp[j] = Math.min(
                dp[j] + 1,
                dp[j - 1] + 1,
                previous + (a[i - 1] === b[j - 1] ? 0 : 1)
            );
            previous = temp;
        }
    }
    return dp[b.length];
}

function suggestCommand(input: string): string | null {
    const lower = input.toLowerCase();
    let best: string | null = null;
    let bestScore = Number.POSITIVE_INFINITY;
    KNOWN_COMMANDS.forEach((candidate) => {
        const score = editDistance(lower, candidate);
        if (score < bestScore) {
            bestScore = score;
            best = candidate;
        }
    });
    return bestScore <= 2 ? best : null;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** --json 时把过程日志重定向到 stderr，否则原样执行。 */
async function runCaptured<T>(json: boolean, fn: () => Promise<T>): Promise<T> {
    return json ? captureStdout(fn) : fn();
}

/** install/update 成功后的「下一步」信号：SKILL.md 路径 + 生效方式。 */
function activationFields(
    result: DownloadResult,
    reload: RestartAgentResult | null
): Record<string, unknown> {
    const installDir = result.files[0] ?? null;
    const skillMdPath = installDir ? path.join(installDir, 'SKILL.md') : null;
    return {
        skill_md_path: skillMdPath,
        next_step: result.upToDate
            ? `技能已是最新版本，无需操作；使用时阅读 ${skillMdPath ?? 'SKILL.md'} 并按其说明执行`
            : `阅读 ${skillMdPath ?? 'SKILL.md'} 并按其说明使用技能；若宿主 Agent 未自动加载新技能，请重启会话或执行重载命令`,
        reload_command: reload?.command ?? getAgentRestartCommand(),
        reloaded: reload ? (reload.attempted ? reload.ok : null) : null
    };
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

/** --dry-run 的安装/更新预演计划（只读，不下载 ZIP、不写任何文件）。 */
async function planSkillAction(
    skillName: string,
    requestedVersion?: string
): Promise<Record<string, unknown>> {
    const entry = await findSkillIndexEntry(skillName, { forceRefresh: true });
    if (!entry) {
        throw new GetSkillError(
            'SKILL_NOT_FOUND',
            `技能不存在: ${skillName}，请先使用 getskill search <关键词> 查询可用技能`
        );
    }
    if (requestedVersion && requestedVersion !== entry.version) {
        throw new GetSkillError(
            'VERSION_NOT_AVAILABLE',
            `技能 ${entry.id} 不提供版本 ${requestedVersion}，站点当前仅提供最新版本 ${entry.version}`
        );
    }

    const info = getInstalledSkillInfo(entry.id);
    const localVersion = info.state?.version ?? null;
    const targetVersion = requestedVersion || entry.version;
    let action: string;
    if (!info.installed) {
        action = 'install';
    } else if (!localVersion) {
        action = 'update';
    } else {
        const cmp = compareVersions(localVersion, targetVersion);
        action =
            cmp === 0
                ? 'skip'
                : cmp > 0
                  ? requestedVersion
                      ? 'downgrade'
                      : 'skip'
                  : 'update';
    }

    return {
        skill: entry.id,
        ok: true,
        action,
        current_version: localVersion,
        target_version: targetVersion,
        install_dir: info.skillDir,
        exists: info.installed,
        local_modified: Boolean(info.localModified),
        size: typeof entry.size === 'number' ? entry.size : null
    };
}

function printPlans(command: string, plans: Record<string, unknown>[]): void {
    console.log(`[dry-run] ${command} 预演（未执行任何写入）:`);
    plans.forEach((plan) => {
        if (plan.ok === false) {
            console.log(
                `  - ${plan.skill}: 失败 (${JSON.stringify(plan.error)})`
            );
            return;
        }
        console.log(
            `  - ${plan.skill}: ${plan.action} (${plan.current_version ?? '未安装'} -> ${plan.target_version ?? '-'})${plan.local_modified ? ' [本地已修改，将被覆盖]' : ''}`
        );
    });
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

export function handleConfigCommand(args: string[], json = false): void {
    const [action, ...rest] = args;
    const usageError = (): GetSkillError =>
        new GetSkillError(
            'INVALID_ARGS',
            '用法: getskill config get [key] | set <key> <value> | unset <key> | path | agents（可用配置项: base-url, agent, skills-dir, cache-dir）'
        );

    switch ((action || 'get').toLowerCase()) {
        case 'get':
        case 'list':
        case 'show':
            if (json) {
                const rows = getConfigRows();
                const key = rest[0];
                if (key) {
                    const normalizedKey = normalizeConfigKey(key);
                    const targetKey = normalizedKey
                        .replace(/([A-Z])/g, '-$1')
                        .toLowerCase();
                    const row = rows.find((item) => item.key === targetKey);
                    if (!row) {
                        throw new GetSkillError(
                            'INVALID_ARGS',
                            `未知配置项: ${key}`
                        );
                    }
                    printJson({
                        command: 'config',
                        action: 'get',
                        config: [row],
                        config_file: getConfigFilePath()
                    });
                    break;
                }
                printJson({
                    command: 'config',
                    action: 'get',
                    config: rows,
                    config_file: getConfigFilePath(),
                    state_file: getStateFilePath()
                });
                break;
            }
            printConfigValues(rest[0]);
            break;

        case 'set': {
            if (rest.length === 0) {
                throw usageError();
            }

            let key: string;
            let value: string;
            if (rest.length === 1) {
                const rawUrl = rest[0];
                if (!/^https?:\/\//i.test(rawUrl.trim())) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        `config set <URL> 只接受 http(s) 地址（收到: ${rawUrl}）。设置 Agent 请用: getskill config set agent <name>`
                    );
                }
                key = 'base-url';
                value = rawUrl;
            } else {
                const [rawKey, ...valueParts] = rest;
                key = rawKey;
                value = valueParts.join(' ');
            }

            setConfigValue(key, value);
            if (json) {
                printJson({
                    command: 'config',
                    action: 'set',
                    key: normalizeConfigKey(key),
                    config: getConfigRows(),
                    config_file: getConfigFilePath()
                });
                break;
            }
            printConfigValues(key);
            break;
        }

        case 'unset':
        case 'delete':
        case 'remove':
        case 'reset': {
            if (!rest[0]) {
                throw usageError();
            }

            unsetConfigValue(rest[0]);
            if (json) {
                printJson({
                    command: 'config',
                    action: 'unset',
                    key: normalizeConfigKey(rest[0]),
                    config: getConfigRows(),
                    config_file: getConfigFilePath()
                });
                break;
            }
            console.log(`已删除配置项: ${rest[0]}`);
            printConfigValues(rest[0]);
            break;
        }

        case 'path':
            if (json) {
                printJson({
                    command: 'config',
                    action: 'path',
                    config_file: getConfigFilePath(),
                    state_file: getStateFilePath()
                });
                break;
            }
            console.log(getConfigFilePath());
            break;

        case 'agents':
            if (json) {
                printAgentsJson();
                break;
            }
            printAgents();
            break;

        default:
            throw usageError();
    }
}

function printAgentsJson(): void {
    const config = getConfigSummary();
    printJson({
        command: 'agents',
        current: {
            agent: config.agent,
            agent_label: config.agentLabel,
            skills_dir: config.skillsDir,
            skills_dir_source: config.sources.skillsDir
        },
        agents: listAgents()
    });
}

export async function cli(): Promise<void> {
    const args = process.argv.slice(2);

    let options: Record<string, string | boolean> = {};
    let positionals: string[] = [];
    let command: string | undefined;
    let restArgs: string[] = [];
    let searchKeyword: string | null = null;
    let errorSkill: string | null = null;

    try {
        // 全局参数只影响本次执行，不会写入配置文件；
        // 同时过滤掉参数本身，使 `getskill --agent cursor path` 这类写法生效。
        ({ positionals, options } = parseCommandOptions(args));
        applyRuntimeOverrides({
            agent: asStringValue(options.agent),
            skillsDir: asStringValue(options['skills-dir']),
            cacheDir: asStringValue(options['cache-dir']),
            baseUrl: asStringValue(options['base-url'])
        });
        const timeoutMs = positiveIntOption(options, 'timeout');
        if (timeoutMs !== undefined) {
            setRequestTimeoutOverride(timeoutMs);
        }

        restArgs = positionals.slice(1);
        command = positionals[0]
            ? (COMMAND_ALIASES[positionals[0]] ?? positionals[0])
            : undefined;

        if (options.help === true) {
            command = 'help';
        } else if (!command && options.version === true) {
            command = 'version';
        }

        const json = options.json === true;

        if (!command) {
            if (json) {
                throw new GetSkillError(
                    'INVALID_ARGS',
                    '请提供命令。用法: getskill <命令> ...；使用 getskill --help --json 查看机器可读命令表'
                );
            }
            printHelp();
            return;
        }

        switch (command) {
            case 'help':
                if (json) {
                    printJson(buildHelpPayload());
                } else {
                    printHelp();
                }
                break;

            case 'version':
                if (json) {
                    printJson({
                        command: 'version',
                        version: getCliVersion()
                    });
                } else {
                    console.log(getCliVersion());
                }
                break;

            case 'search': {
                const keyword = restArgs[0];
                if (!keyword) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '请提供搜索关键词。用法: getskill search <关键词> [--json] [--limit N] [--page N] [--brief]'
                    );
                }
                if (restArgs.length > 1) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        `search 只接受一个关键词参数（多词请用引号包裹，如 getskill search "pdf merge"）。多余参数: ${restArgs.slice(1).join(' ')}`
                    );
                }
                searchKeyword = keyword;

                const pageResult = await searchSkillsPage(keyword, {
                    limit: positiveIntOption(options, 'limit'),
                    page: positiveIntOption(options, 'page')
                });
                const brief = options.brief === true;
                const results = pageResult.results;
                // --brief：截断简介并剔除冗余 URL 字段，节省 Agent 上下文
                const jsonResults = brief
                    ? results.map((skill) => {
                          const compact: Record<string, unknown> = {
                              ...skill,
                              description: truncateText(skill.description, 120)
                          };
                          delete compact.git_url;
                          delete compact.clone_url;
                          delete compact.html_url;
                          delete compact.download_url;
                          return compact;
                      })
                    : results;

                if (json) {
                    const payload: Record<string, unknown> = {
                        command: 'search',
                        keyword,
                        total: pageResult.total,
                        page: pageResult.page,
                        limit: pageResult.limit,
                        count: jsonResults.length,
                        has_more: pageResult.has_more,
                        results: jsonResults,
                        index: getSkillsIndexMeta()
                    };
                    if (jsonResults.length === 0) {
                        payload.message = `未找到与 "${keyword}" 匹配的技能`;
                        payload.hint =
                            'Agent 可用 getskill index --categories 查看分类，再用 getskill index --category <分类> --json 浏览紧凑技能列表，按名称/简介挑选后执行 getskill install <技能名称>；也可更换关键词重新搜索（多词为 AND 匹配，可尝试减少词数）';
                        const indexFile = getSkillsIndexCacheFilePath();
                        if (fs.existsSync(indexFile)) {
                            payload.index_file = indexFile;
                        }
                        payload.index_url = `${getBaseUrl()}/data/skills.json`;
                    }
                    printJson(payload);
                    break;
                }

                if (results.length === 0) {
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

                console.log(
                    `找到 ${pageResult.total} 个匹配技能（第 ${pageResult.page} 页，显示 ${results.length} 个）:\n`
                );
                results.forEach((skill, index) => {
                    console.log(
                        `${(pageResult.page - 1) * pageResult.limit + index + 1}. ${skill.full_name} (v${skill.version})`
                    );
                    if (skill.description) {
                        console.log(
                            `   描述: ${brief ? truncateText(skill.description, 120) : skill.description}`
                        );
                    }
                    if (skill.category) {
                        console.log(`   分类: ${skill.category}`);
                    }
                    if (!brief && skill.download_url) {
                        console.log(`   下载: ${skill.download_url}`);
                    }
                    if (!skill.installed) {
                        console.log(
                            `   本地: 未安装（如需要: getskill install ${skill.full_name}）`
                        );
                    } else if (skill.suggested_action === 'skip') {
                        console.log(
                            `   本地: 已安装 v${skill.installed_version || 'unknown'}（版本不低于站点，无需重复安装）`
                        );
                    } else {
                        console.log(
                            `   本地: 已安装 v${skill.installed_version || 'unknown'}（如需要: getskill update ${skill.full_name}）`
                        );
                    }
                    console.log('');
                });
                if (pageResult.has_more) {
                    console.log(
                        `更多结果: getskill search "${keyword}" --page ${pageResult.page + 1}`
                    );
                }
                console.log(
                    '提示: search 只返回候选技能与简介，不会自动安装任何技能。'
                );
                console.log(
                    '      请由 Agent 根据简介判断需要哪个技能，再自行执行 getskill install / update <技能名称>。'
                );
                break;
            }

            case 'install': {
                if (restArgs.length === 0) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '请提供技能ID或名称。用法: getskill install <技能名称> [更多技能名称...]，示例: getskill install pdf-toolkit'
                    );
                }
                if (options.version === true) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '--version 需要版本号（如 --version 1.0.0 或 -V 1.0.0）；查看 CLI 版本请用 getskill --version'
                    );
                }
                const requestedVersion =
                    typeof options.version === 'string'
                        ? options.version
                        : undefined;
                if (restArgs.length > 1 && requestedVersion) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '批量安装不支持 --version（各技能版本不同），请逐个安装'
                    );
                }
                errorSkill = restArgs[0];

                const downloadOptions = {
                    version: requestedVersion,
                    force: options.force === true
                };

                if (options['dry-run'] === true) {
                    const plans: Record<string, unknown>[] = [];
                    for (const name of restArgs) {
                        try {
                            plans.push(
                                await planSkillAction(name, requestedVersion)
                            );
                        } catch (error) {
                            plans.push({
                                skill: name,
                                ok: false,
                                error: {
                                    code: getErrorCode(error),
                                    message: errorMessage(error)
                                }
                            });
                        }
                    }
                    if (json) {
                        printJson({
                            command: 'install',
                            dry_run: true,
                            total: plans.length,
                            skills_dir: getSkillsDirectory(),
                            skills_dir_source:
                                getConfigSummary().sources.skillsDir,
                            results: plans
                        });
                    } else {
                        printPlans('install', plans);
                    }
                    if (plans.some((plan) => plan.ok === false)) {
                        process.exitCode = 1;
                    }
                    break;
                }
                if (restArgs.length > 1) {
                    const results: Record<string, unknown>[] = [];
                    for (const name of restArgs) {
                        errorSkill = name;
                        try {
                            const item = await runCaptured(json, () =>
                                downloadSkill(name, downloadOptions)
                            );
                            const itemReload = item.upToDate
                                ? null
                                : await runCaptured(json, () =>
                                      restartAgentGateway()
                                  );
                            results.push({
                                skill: item.skillName,
                                ok: true,
                                status: item.upToDate ? 'skipped' : 'installed',
                                version: item.version ?? null,
                                install_dir: item.files[0] ?? null,
                                local_modified: Boolean(item.localModified),
                                ...activationFields(item, itemReload)
                            });
                        } catch (error) {
                            results.push({
                                skill: name,
                                ok: false,
                                error: {
                                    code: getErrorCode(error),
                                    message: errorMessage(error)
                                }
                            });
                        }
                    }
                    const failed = results.filter(
                        (item) => item.ok === false
                    ).length;
                    if (json) {
                        printJson({
                            command: 'install',
                            total: results.length,
                            succeeded: results.length - failed,
                            failed,
                            agent: getAgentName(),
                            results
                        });
                    } else {
                        console.log(
                            `\n批量安装完成: ${results.length - failed}/${results.length} 成功。`
                        );
                        results.forEach((item) => {
                            console.log(
                                item.ok
                                    ? `  - ${item.skill}: ${item.status} (v${item.version ?? 'unknown'})`
                                    : `  - ${item.skill}: 失败 (${JSON.stringify(item.error)})`
                            );
                        });
                    }
                    if (failed > 0) {
                        process.exitCode = 1;
                    }
                    break;
                }

                const result = await runCaptured(json, () =>
                    downloadSkill(restArgs[0], downloadOptions)
                );
                const reload = result.upToDate
                    ? null
                    : await runCaptured(json, () => restartAgentGateway());

                if (json) {
                    printJson({
                        command: 'install',
                        status: result.upToDate ? 'skipped' : 'installed',
                        skill: result.skillName,
                        version: result.version ?? null,
                        up_to_date: Boolean(result.upToDate),
                        install_dir: result.files[0] ?? null,
                        files: result.files,
                        cache_dir: result.repoPath,
                        agent: getAgentName(),
                        local_modified: Boolean(result.localModified),
                        index: getSkillsIndexMeta(),
                        ...activationFields(result, reload)
                    });
                    break;
                }

                if (result.upToDate) {
                    console.log(
                        `\n技能已安装且版本不低于站点版本 (v${result.version || 'unknown'})，已跳过重复安装。`
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
                if (result.localModified) {
                    console.log(
                        '注意: 覆盖前的本地内容与安装记录不一致，本地改动已被覆盖。'
                    );
                }
                console.log(
                    `\n下一步: 阅读 ${path.join(result.files[0], 'SKILL.md')} 并按其说明使用技能；若宿主 Agent 未自动加载新技能，请重启会话。`
                );
                break;
            }

            case 'update': {
                if (options.version === true) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '--version 需要版本号（如 --version 1.0.0 或 -V 1.0.0）；查看 CLI 版本请用 getskill --version'
                    );
                }
                if (options.all) {
                    if (restArgs.length > 0) {
                        throw new GetSkillError(
                            'INVALID_ARGS',
                            `update --all 不接受技能名称参数（收到: ${restArgs.join(' ')}）；更新指定技能请用 getskill update <技能名称>`
                        );
                    }

                    if (options['dry-run'] === true) {
                        const plans: Record<string, unknown>[] = [];
                        for (const name of listInstalledSkillNames()) {
                            const info = getInstalledSkillInfo(name);
                            if (info.state && !info.installed) {
                                // 目录已删：仍在索引中 → missing（可 install 恢复）；
                                // 索引中也已下架 → stale（--prune 将清理记录）
                                let delisted = false;
                                try {
                                    delisted =
                                        (await findSkillIndexEntry(name)) ===
                                        null;
                                } catch {
                                    // 索引不可用时保守按 missing 处理
                                }
                                plans.push(
                                    delisted
                                        ? {
                                              skill: name,
                                              ok: true,
                                              action: 'stale',
                                              note: '安装目录已不存在且索引中已下架；update --all --prune 将清理该记录'
                                          }
                                        : {
                                              skill: name,
                                              ok: true,
                                              action: 'missing',
                                              note: '安装目录已不存在（可能被手动删除），--all 将跳过；如需恢复请执行 install'
                                          }
                                );
                                continue;
                            }
                            try {
                                plans.push(await planSkillAction(name));
                            } catch (error) {
                                plans.push({
                                    skill: name,
                                    ok: true,
                                    action: 'stale',
                                    note: errorMessage(error)
                                });
                            }
                        }
                        if (json) {
                            printJson({
                                command: 'update',
                                all: true,
                                dry_run: true,
                                total: plans.length,
                                results: plans
                            });
                        } else {
                            printPlans('update --all', plans);
                        }
                        break;
                    }

                    const { results, pruned } = await runCaptured(json, () =>
                        updateAllSkills({ prune: options.prune === true })
                    );
                    const succeeded = results.filter((item) => item.ok).length;
                    const skipped = results.filter((item) => item.skipped);
                    const failed = results.filter(
                        (item) => !item.ok && !item.skipped
                    );

                    if (json) {
                        printJson({
                            command: 'update',
                            all: true,
                            total: results.length,
                            succeeded,
                            skipped: skipped.length,
                            failed: failed.length,
                            pruned,
                            index: getSkillsIndexMeta(),
                            results
                        });
                        if (failed.length > 0) {
                            process.exitCode = 1;
                        }
                        break;
                    }

                    if (results.length === 0) {
                        console.log('当前没有记录到可批量更新的技能。');
                        console.log(
                            `技能目录: ${getSkillsDirectory()}（可用 getskill path 查看，或用 --agent/--skills-dir 切换）`
                        );
                        break;
                    }

                    console.log(
                        `批量更新完成：${succeeded}/${results.length} 个技能成功，${skipped.length} 个跳过，${failed.length} 个失败。`
                    );

                    if (skipped.length > 0) {
                        console.log('以下技能已跳过（非失败）：');
                        skipped.forEach((item) => {
                            console.log(
                                `  - ${item.skillName} [${item.status}]: ${item.error}`
                            );
                        });
                        if (
                            options.prune !== true &&
                            skipped.some((item) => item.status === 'stale')
                        ) {
                            console.log(
                                '提示: 执行 getskill update --all --prune 可清理索引中已下架技能的失效记录。'
                            );
                        }
                    }

                    if (failed.length > 0) {
                        console.log('以下技能更新失败：');
                        failed.forEach((item) => {
                            console.log(
                                `  - ${item.skillName} [${item.code}]: ${item.error}`
                            );
                        });
                        process.exitCode = 1;
                    }
                    break;
                }

                if (restArgs.length === 0) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '请提供技能名称。用法: getskill update <技能名称> [更多技能名称...] 或 getskill update --all'
                    );
                }
                const requestedVersion =
                    typeof options.version === 'string'
                        ? options.version
                        : undefined;
                if (restArgs.length > 1 && requestedVersion) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '批量更新不支持 --version（各技能版本不同），请逐个更新'
                    );
                }
                errorSkill = restArgs[0];
                const updateOptions = { version: requestedVersion };

                if (options['dry-run'] === true) {
                    const plans: Record<string, unknown>[] = [];
                    for (const name of restArgs) {
                        try {
                            plans.push(
                                await planSkillAction(name, requestedVersion)
                            );
                        } catch (error) {
                            plans.push({
                                skill: name,
                                ok: false,
                                error: {
                                    code: getErrorCode(error),
                                    message: errorMessage(error)
                                }
                            });
                        }
                    }
                    if (json) {
                        printJson({
                            command: 'update',
                            dry_run: true,
                            total: plans.length,
                            results: plans
                        });
                    } else {
                        printPlans('update', plans);
                    }
                    if (plans.some((plan) => plan.ok === false)) {
                        process.exitCode = 1;
                    }
                    break;
                }

                if (restArgs.length > 1) {
                    const results: Record<string, unknown>[] = [];
                    for (const name of restArgs) {
                        errorSkill = name;
                        try {
                            const item = await runCaptured(json, () =>
                                updateSkill(name, updateOptions)
                            );
                            const itemReload = item.upToDate
                                ? null
                                : await runCaptured(json, () =>
                                      restartAgentGateway()
                                  );
                            results.push({
                                skill: item.skillName,
                                ok: true,
                                status: item.upToDate
                                    ? 'up_to_date'
                                    : 'updated',
                                version: item.version ?? null,
                                install_dir: item.files[0] ?? null,
                                local_modified: Boolean(item.localModified),
                                ...activationFields(item, itemReload)
                            });
                        } catch (error) {
                            results.push({
                                skill: name,
                                ok: false,
                                error: {
                                    code: getErrorCode(error),
                                    message: errorMessage(error)
                                }
                            });
                        }
                    }
                    const failed = results.filter(
                        (item) => item.ok === false
                    ).length;
                    if (json) {
                        printJson({
                            command: 'update',
                            total: results.length,
                            succeeded: results.length - failed,
                            failed,
                            agent: getAgentName(),
                            results
                        });
                    } else {
                        console.log(
                            `\n批量更新完成: ${results.length - failed}/${results.length} 成功。`
                        );
                        results.forEach((item) => {
                            console.log(
                                item.ok
                                    ? `  - ${item.skill}: ${item.status} (v${item.version ?? 'unknown'})`
                                    : `  - ${item.skill}: 失败 (${JSON.stringify(item.error)})`
                            );
                        });
                    }
                    if (failed > 0) {
                        process.exitCode = 1;
                    }
                    break;
                }

                const result = await runCaptured(json, () =>
                    updateSkill(restArgs[0], updateOptions)
                );
                const reload = result.upToDate
                    ? null
                    : await runCaptured(json, () => restartAgentGateway());

                if (json) {
                    printJson({
                        command: 'update',
                        status: result.upToDate ? 'up_to_date' : 'updated',
                        skill: result.skillName,
                        version: result.version ?? null,
                        up_to_date: Boolean(result.upToDate),
                        install_dir: result.files[0] ?? null,
                        files: result.files,
                        cache_dir: result.repoPath,
                        agent: getAgentName(),
                        local_modified: Boolean(result.localModified),
                        index: getSkillsIndexMeta(),
                        ...activationFields(result, reload)
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
                if (result.localModified) {
                    console.log(
                        '注意: 覆盖前的本地内容与安装记录不一致，本地改动已被覆盖。'
                    );
                }
                break;
            }

            case 'uninstall': {
                if (restArgs.length === 0) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '请提供技能名称。用法: getskill uninstall <技能名称> [更多技能名称...] [--keep-cache]'
                    );
                }
                errorSkill = restArgs[0];
                const uninstallOptions = {
                    removeCache: options['keep-cache'] !== true
                };

                if (options['dry-run'] === true) {
                    const plans = restArgs.map((name) => {
                        const info = getInstalledSkillInfo(name);
                        return {
                            skill: info.localSkillName,
                            ok: true,
                            action:
                                info.installed || info.cached
                                    ? 'remove'
                                    : 'none',
                            removed_install: info.installed,
                            removed_cache:
                                info.cached && uninstallOptions.removeCache,
                            skill_dir: info.skillDir,
                            cache_dir: info.cacheDir
                        };
                    });
                    if (json) {
                        printJson({
                            command: 'uninstall',
                            dry_run: true,
                            total: plans.length,
                            results: plans
                        });
                    } else {
                        printPlans('uninstall', plans);
                    }
                    break;
                }

                if (restArgs.length > 1) {
                    const results: Record<string, unknown>[] = [];
                    for (const name of restArgs) {
                        errorSkill = name;
                        try {
                            const item = await runCaptured(json, () =>
                                uninstallSkill(name, uninstallOptions)
                            );
                            results.push({
                                skill: item.localSkillName,
                                ok: true,
                                status:
                                    item.removedInstall || item.removedCache
                                        ? 'removed'
                                        : 'not_installed',
                                removed_install: item.removedInstall,
                                removed_cache: item.removedCache
                            });
                        } catch (error) {
                            results.push({
                                skill: name,
                                ok: false,
                                error: {
                                    code: getErrorCode(error),
                                    message: errorMessage(error)
                                }
                            });
                        }
                    }
                    const failed = results.filter(
                        (item) => item.ok === false
                    ).length;
                    if (json) {
                        printJson({
                            command: 'uninstall',
                            total: results.length,
                            succeeded: results.length - failed,
                            failed,
                            results
                        });
                    } else {
                        console.log(
                            `\n批量卸载完成: ${results.length - failed}/${results.length} 成功。`
                        );
                        results.forEach((item) => {
                            console.log(
                                item.ok
                                    ? `  - ${item.skill}: ${item.status}`
                                    : `  - ${item.skill}: 失败 (${JSON.stringify(item.error)})`
                            );
                        });
                    }
                    if (failed > 0) {
                        process.exitCode = 1;
                    }
                    break;
                }

                const result = await runCaptured(json, () =>
                    uninstallSkill(restArgs[0], uninstallOptions)
                );
                const removed = result.removedInstall || result.removedCache;

                if (json) {
                    printJson({
                        command: 'uninstall',
                        status: removed ? 'removed' : 'not_installed',
                        skill: result.localSkillName,
                        removed_install: result.removedInstall,
                        removed_cache: result.removedCache,
                        skill_dir: result.skillDir,
                        cache_dir: result.repoPath,
                        agent: getAgentName()
                    });
                    break;
                }

                if (!removed) {
                    console.log(
                        `\n技能 ${result.localSkillName} 未安装（技能目录与缓存均不存在），无需卸载。`
                    );
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
                if (restArgs.length > 1) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        `inspect 只接受一个技能名称（收到多余参数: ${restArgs.slice(1).join(' ')}）；批量查看请用 getskill list --json`
                    );
                }
                errorSkill = restArgs[0];

                const info = getInstalledSkillInfo(restArgs[0]);
                if (json) {
                    printJson({
                        command: 'inspect',
                        ...info,
                        local_modified: Boolean(info.localModified)
                    });
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
                const skills = listLocalSkillsDetailed();
                if (json) {
                    printJson({
                        command: 'list',
                        agent: getAgentName(),
                        agent_label: getAgentLabel(),
                        skills_dir: getSkillsDirectory(),
                        count: skills.length,
                        skills,
                        names: skills.map((skill) => skill.name)
                    });
                    break;
                }
                console.log(
                    `本地已安装的技能 (${skills.length}) · Agent: ${getAgentName()} · 目录: ${getSkillsDirectory()}`
                );
                skills.forEach((skill, index) => {
                    console.log(
                        `${index + 1}. ${skill.name}${skill.version ? ` (v${skill.version})` : ''}${skill.managed ? '' : ' [未管理]'}`
                    );
                });
                break;
            }

            case 'status': {
                const config = getConfigSummary();
                const cacheInfo = peekSkillsIndexCache();
                const skills = listLocalSkillsDetailed();
                const state = readInstallState();
                const staleRecords = Object.values(state.skills)
                    .filter(recordMatchesCurrentSkillsDir)
                    .filter(
                        (record) =>
                            record.installDir &&
                            !fs.existsSync(record.installDir)
                    )
                    .map(
                        (record) =>
                            record.inputSkillName || record.localSkillName
                    );
                const stateLocked = fs.existsSync(`${getStateFilePath()}.lock`);
                const indexStatus = cacheInfo
                    ? { exists: true, ...cacheInfo }
                    : {
                          exists: false,
                          fetched_at: null,
                          skill_count: 0,
                          stale: true
                      };

                if (json) {
                    printJson({
                        command: 'status',
                        agent: config.agent,
                        agent_label: config.agentLabel,
                        skills_dir: config.skillsDir,
                        skills_dir_source: config.sources.skillsDir,
                        explicit_target: config.sources.skillsDir !== 'detect',
                        base_url: config.baseUrl,
                        config_file: config.configFile,
                        state_file: config.stateFile,
                        restart_command: config.restartCommand,
                        index: indexStatus,
                        installed: { count: skills.length, skills },
                        stale_records: staleRecords,
                        state_locked: stateLocked
                    });
                    break;
                }

                console.log(`Agent: ${config.agent} (${config.agentLabel})`);
                console.log(
                    `技能目录: ${config.skillsDir} (${CONFIG_SOURCE_LABELS[config.sources.skillsDir] || config.sources.skillsDir})`
                );
                console.log(
                    `安装门禁: ${config.sources.skillsDir !== 'detect' ? '已显式指定，可安装/卸载' : '仅自动识别，安装/卸载会被拒绝（先 config set agent 或 skills-dir）'}`
                );
                console.log(
                    `索引缓存: ${cacheInfo ? `${cacheInfo.skill_count} 个技能，抓取于 ${cacheInfo.fetched_at}${cacheInfo.stale ? '（已过期）' : ''}` : '不存在（首次 search/index 时下载）'}`
                );
                console.log(`已安装技能: ${skills.length} 个`);
                skills.forEach((skill) => {
                    console.log(
                        `  - ${skill.name}${skill.version ? ` (v${skill.version})` : ''}${skill.managed ? '' : ' [未管理]'}`
                    );
                });
                if (staleRecords.length > 0) {
                    console.log(
                        `失效记录（目录已被手动删除）: ${staleRecords.join(', ')}`
                    );
                }
                console.log(`状态锁: ${stateLocked ? '被占用' : '空闲'}`);
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

                    if (json) {
                        printJson({
                            command: 'index',
                            mode: 'categories',
                            total: entries.length,
                            count: categories.length,
                            category_count: categories.length,
                            categories,
                            index: getSkillsIndexMeta()
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
                const limit = positiveIntOption(options, 'limit') ?? 100;
                const page = positiveIntOption(options, 'page') ?? 1;
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

                if (json) {
                    const payload: Record<string, unknown> = {
                        command: 'index',
                        mode: 'list',
                        category: categoryFilter ?? null,
                        total: filtered.length,
                        page,
                        limit,
                        count: pageItems.length,
                        skills: pageItems,
                        index: getSkillsIndexMeta()
                    };
                    if (pageItems.length === 0 && categoryFilter) {
                        payload.message = `分类 "${categoryFilter}" 下没有技能`;
                        const similar = [
                            ...new Set(
                                entries.map(
                                    (entry) => entry.category || '未分类'
                                )
                            )
                        ].filter((category) =>
                            category
                                .toLowerCase()
                                .includes(categoryFilter.toLowerCase())
                        );
                        payload.hint = similar.length
                            ? `相近分类: ${similar.slice(0, 5).join(', ')}；用 getskill index --categories 查看全部分类名称`
                            : '用 getskill index --categories 查看全部分类名称';
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
                if (json) {
                    printAgentsJson();
                } else {
                    printAgents();
                }
                break;

            case 'show': {
                const skillName = restArgs[0];
                if (!skillName) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        '请提供技能名称。用法: getskill show <技能名称> [--json]'
                    );
                }
                if (restArgs.length > 1) {
                    throw new GetSkillError(
                        'INVALID_ARGS',
                        `show 只接受一个技能名称（收到多余参数: ${restArgs.slice(1).join(' ')}）`
                    );
                }
                errorSkill = skillName;

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

                if (json) {
                    const payload: Record<string, unknown> = {
                        command: 'show',
                        skill: entry.id,
                        version: entry.version || 'unknown',
                        description: entry.description || '',
                        source,
                        skill_md: markdown,
                        index: getSkillsIndexMeta()
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

            case 'path': {
                if (json) {
                    const config = getConfigSummary();
                    printJson({
                        command: 'path',
                        agent: config.agent,
                        agent_label: config.agentLabel,
                        skills_dir: config.skillsDir,
                        skills_dir_source: config.sources.skillsDir,
                        cache_dir: config.cacheDir,
                        config_file: config.configFile,
                        state_file: config.stateFile,
                        base_url: config.baseUrl,
                        restart_command: config.restartCommand
                    });
                    break;
                }
                printPaths();
                break;
            }

            case 'config':
                handleConfigCommand(restArgs, json);
                break;

            case 'clean': {
                const cacheDir = getSkillsCacheDirectory();
                const keepIndex = options['keep-index'] === true;
                const removed: string[] = [];

                if (fs.existsSync(cacheDir)) {
                    if (keepIndex) {
                        // 保留索引缓存，只清理技能包缓存
                        fs.readdirSync(cacheDir).forEach((entryName) => {
                            if (entryName === 'skills-index.json') {
                                return;
                            }
                            fs.rmSync(path.join(cacheDir, entryName), {
                                recursive: true,
                                force: true
                            });
                        });
                        removed.push(`${cacheDir} (保留 skills-index.json)`);
                    } else {
                        fs.rmSync(cacheDir, { recursive: true, force: true });
                        removed.push(cacheDir);
                    }
                }

                getLegacyCacheDirectories().forEach((legacyDir) => {
                    if (fs.existsSync(legacyDir)) {
                        fs.rmSync(legacyDir, { recursive: true, force: true });
                        removed.push(legacyDir);
                    }
                });

                if (json) {
                    printJson({
                        command: 'clean',
                        removed,
                        kept_index: keepIndex,
                        cache_dir: cacheDir
                    });
                    break;
                }

                if (removed.length === 0) {
                    console.log('缓存目录不存在');
                } else {
                    removed.forEach((dir) => console.log(`已清理: ${dir}`));
                    if (keepIndex) {
                        console.log('已保留索引缓存 skills-index.json');
                    } else {
                        console.log(
                            '提示: 索引缓存一并清理，下次 search/index 会重新下载；如需保留请加 --keep-index'
                        );
                    }
                }
                break;
            }

            default: {
                const suggestion = suggestCommand(command);
                throw new GetSkillError(
                    'INVALID_ARGS',
                    `未知命令: ${command}${suggestion ? `（是否想执行 getskill ${suggestion}？）` : ''}。使用 getskill --help 查看全部命令`
                );
            }
        }
    } catch (error) {
        const message = errorMessage(error);
        logger.error('执行命令时出错:', message);
        // 解析阶段抛错时 options 尚未赋值，需回退扫描原始参数识别 --json
        const jsonRequested =
            options.json === true ||
            args.some(
                (arg) =>
                    arg === '--json' || /^--json=(true|1|yes|on)$/i.test(arg)
            );
        if (jsonRequested) {
            const payload: Record<string, unknown> = {
                command: command ?? null,
                error: { code: getErrorCode(error), message }
            };
            if (errorSkill) {
                payload.skill = errorSkill;
            }
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
