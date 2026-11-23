import fs from 'fs';
import os from 'os';
import path from 'path';

import { GetSkillError } from './errors';
import { ensureDirectoryExists } from './system';

export const DEFAULT_BASE_URL = 'https://getskill.work';
export const REQUEST_TIMEOUT_MS = 60_000;
export const SKILLS_INDEX_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** manifest.json 探测超时上限：文件极小，离线时不应让用户等待完整网络超时。 */
export const INDEX_MANIFEST_TIMEOUT_MS = 5_000;
export const MAX_COPY_FILE_SIZE_BYTES = 2 * 1024 * 1024;
/** zip 单文件解压上限（防解压炸弹）。 */
export const MAX_ZIP_ENTRY_BYTES = 20 * 1024 * 1024;
/** zip 总解压体积上限（防解压炸弹）。 */
export const MAX_ZIP_TOTAL_BYTES = 200 * 1024 * 1024;
/** 技能包下载体积上限。 */
export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;
/** 索引等文本响应体积上限。 */
export const MAX_INDEX_RESPONSE_BYTES = 10 * 1024 * 1024;

let requestTimeoutOverrideMs: number | null = null;

/** CLI `--timeout <ms>` 的进程级覆盖。 */
export function setRequestTimeoutOverride(ms: number | null): void {
    requestTimeoutOverrideMs = ms;
}

export function getRequestTimeoutMs(): number {
    return requestTimeoutOverrideMs ?? REQUEST_TIMEOUT_MS;
}

export const AUTO_AGENT_NAME = 'auto';
export const CUSTOM_AGENT_NAME = 'custom';
export const DEFAULT_AGENT_NAME = 'claude';

export interface AgentPreset {
    name: string;
    label: string;
    skillsPathSegments: string[];
    restartCommand?: string;
}

/**
 * 支持的 Agent 目录约定。任何 Agent 都可以通过 agent 预设、
 * skillsDir 自定义目录或 GETSKILL_SKILLS_DIR 环境变量接入。
 */
export const AGENT_PRESETS: AgentPreset[] = [
    {
        name: 'claude',
        label: 'Claude Code',
        skillsPathSegments: ['.claude', 'skills']
    },
    {
        name: 'openclaw',
        label: 'OpenClaw',
        skillsPathSegments: ['.openclaw', 'skills'],
        restartCommand: 'openclaw gateway restart'
    },
    {
        name: 'codex',
        label: 'OpenAI Codex CLI',
        skillsPathSegments: ['.codex', 'skills']
    },
    {
        name: 'cursor',
        label: 'Cursor',
        skillsPathSegments: ['.cursor', 'skills']
    },
    {
        name: 'gemini',
        label: 'Gemini CLI',
        skillsPathSegments: ['.gemini', 'skills']
    },
    {
        name: 'qwen',
        label: 'Qwen Code',
        skillsPathSegments: ['.qwen', 'skills']
    },
    {
        name: 'copilot',
        label: 'GitHub Copilot CLI',
        skillsPathSegments: ['.copilot', 'skills']
    },
    {
        name: 'amp',
        label: 'Amp',
        skillsPathSegments: ['.config', 'amp', 'skills']
    },
    {
        name: 'opencode',
        label: 'OpenCode',
        skillsPathSegments: ['.config', 'opencode', 'skills']
    },
    {
        name: 'agent',
        label: '通用 Agent 目录',
        skillsPathSegments: ['.agent', 'skills']
    }
];

export type ConfigKey = 'baseUrl' | 'agent' | 'skillsDir' | 'cacheDir';

export type ConfigSource = 'cli' | 'env' | 'file' | 'detect' | 'default';

export interface PersistedConfig {
    baseUrl?: string;
    agent?: string;
    skillsDir?: string;
    cacheDir?: string;
}

export interface ResolvedConfig {
    baseUrl: string;
    agent: string;
    agentLabel: string;
    skillsDir: string;
    cacheDir: string;
    homeDir: string;
    configFile: string;
    stateFile: string;
    restartCommand: string | null;
    sources: Record<ConfigKey, ConfigSource>;
}

export interface AgentSummary {
    name: string;
    label: string;
    skillsDir: string;
    exists: boolean;
    active: boolean;
    restartCommand: string | null;
}

const CONFIG_KEY_ALIASES: Record<string, ConfigKey> = {
    'base-url': 'baseUrl',
    baseurl: 'baseUrl',
    base_url: 'baseUrl',
    url: 'baseUrl',
    index: 'baseUrl',
    'index-url': 'baseUrl',
    agent: 'agent',
    target: 'agent',
    'skills-dir': 'skillsDir',
    skillsdir: 'skillsDir',
    skills_dir: 'skillsDir',
    dir: 'skillsDir',
    'cache-dir': 'cacheDir',
    cachedir: 'cacheDir',
    cache_dir: 'cacheDir',
    cache: 'cacheDir'
};

let cliOverrides: PersistedConfig = {};
let resolvedCache: ResolvedConfig | null = null;

function isBlank(value: unknown): boolean {
    return typeof value !== 'string' || value.trim() === '';
}

function expandHome(value: string): string {
    const trimmed = value.trim();
    if (trimmed === '~') {
        return os.homedir();
    }
    if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
        return path.join(os.homedir(), trimmed.slice(2));
    }
    return trimmed;
}

export function normalizePath(value: string): string {
    return path.resolve(expandHome(value));
}

export function isSamePath(left: string, right: string): boolean {
    const a = path.resolve(left);
    const b = path.resolve(right);
    return process.platform === 'win32'
        ? a.toLowerCase() === b.toLowerCase()
        : a === b;
}

export function normalizeBaseUrl(url: string): string {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\/.+/i.test(trimmed)) {
        throw new GetSkillError(
            'INVALID_ARGS',
            `索引地址必须是 http(s) URL，例如 ${DEFAULT_BASE_URL}（收到: ${url}）`
        );
    }
    return trimmed;
}

export function normalizeConfigKey(key: string): ConfigKey {
    const normalized = key.trim().toLowerCase();
    const mapped = CONFIG_KEY_ALIASES[normalized];
    if (!mapped) {
        throw new GetSkillError(
            'INVALID_ARGS',
            `未知配置项: ${key}（可用: base-url, agent, skills-dir, cache-dir）`
        );
    }
    return mapped;
}

export function getHomeDirectory(): string {
    return os.homedir();
}

export function getGetSkillHome(): string {
    const fromEnv = process.env.GETSKILL_HOME;
    if (!isBlank(fromEnv)) {
        return normalizePath(fromEnv as string);
    }
    return path.join(os.homedir(), '.getskill');
}

export function getConfigFilePath(): string {
    return path.join(getGetSkillHome(), 'config.json');
}

export function getStateFilePath(): string {
    const fromEnv = process.env.GETSKILL_STATE_FILE;
    if (!isBlank(fromEnv)) {
        return normalizePath(fromEnv as string);
    }
    return path.join(getGetSkillHome(), 'state.json');
}

export function getLegacyStateFilePaths(): string[] {
    const candidates = [
        path.join(os.homedir(), '.openclaw', 'getskill', 'state.json'),
        path.join(
            path.dirname(
                getPresetSkillsDir(getAgentPreset('openclaw') as AgentPreset)
            ),
            'getskill',
            'state.json'
        )
    ];

    return [...new Set(candidates)].filter(
        (candidate) => !isSamePath(candidate, getStateFilePath())
    );
}

export function readConfigFile(): PersistedConfig {
    const configFile = getConfigFilePath();
    if (!fs.existsSync(configFile)) {
        return {};
    }

    try {
        const parsed = JSON.parse(
            fs.readFileSync(configFile, 'utf8')
        ) as Partial<PersistedConfig>;

        if (!parsed || typeof parsed !== 'object') {
            return {};
        }

        const result: PersistedConfig = {};
        (Object.keys(parsed) as ConfigKey[]).forEach((key) => {
            const value = parsed[key];
            if (typeof value === 'string' && value.trim() !== '') {
                result[key] = value.trim();
            }
        });
        return result;
    } catch {
        return {};
    }
}

export function writeConfigFile(config: PersistedConfig): void {
    const configFile = getConfigFilePath();
    ensureDirectoryExists(path.dirname(configFile));
    fs.writeFileSync(
        configFile,
        `${JSON.stringify(config, null, 2)}\n`,
        'utf8'
    );
}

export function getAgentPreset(name?: string | null): AgentPreset | null {
    if (isBlank(name)) {
        return null;
    }
    const normalized = (name as string).trim().toLowerCase();
    return AGENT_PRESETS.find((preset) => preset.name === normalized) || null;
}

export function getPresetSkillsDir(preset: AgentPreset): string {
    return path.join(os.homedir(), ...preset.skillsPathSegments);
}

function directoryHasEntries(dir: string): boolean {
    if (!fs.existsSync(dir)) {
        return false;
    }
    try {
        return fs.readdirSync(dir).length > 0;
    } catch {
        return false;
    }
}

function readStateSkillsDirHint(): string | null {
    const candidates = [
        getStateFilePath(),
        ...getLegacyStateFilePaths().map((item) => item)
    ];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) {
            continue;
        }

        try {
            const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as {
                skills?: Record<string, { installDir?: string }>;
            };
            const records = Object.values(parsed?.skills || {});
            for (const record of records) {
                if (record && typeof record.installDir === 'string') {
                    return path.dirname(record.installDir);
                }
            }
        } catch {
            continue;
        }
    }

    return null;
}

/**
 * 自动识别当前机器上正在使用的 Agent 技能目录。
 * 优先级：历史安装记录 > 已存在且非空的技能目录 > 已存在的 Agent 根目录 > 默认值。
 */
export function detectAgentName(): string {
    const hint = readStateSkillsDirHint();
    if (hint) {
        const fromState = AGENT_PRESETS.find((preset) =>
            isSamePath(getPresetSkillsDir(preset), hint)
        );
        if (fromState) {
            return fromState.name;
        }
    }

    const nonEmpty = AGENT_PRESETS.find((preset) =>
        directoryHasEntries(getPresetSkillsDir(preset))
    );
    if (nonEmpty) {
        return nonEmpty.name;
    }

    const rootExists = AGENT_PRESETS.find((preset) =>
        fs.existsSync(path.dirname(getPresetSkillsDir(preset)))
    );
    if (rootExists) {
        return rootExists.name;
    }

    return DEFAULT_AGENT_NAME;
}

function pickValue(
    candidates: Array<{ value?: string; source: ConfigSource }>,
    fallback: { value: string; source: ConfigSource }
): { value: string; source: ConfigSource } {
    for (const candidate of candidates) {
        if (!isBlank(candidate.value)) {
            return {
                value: (candidate.value as string).trim(),
                source: candidate.source
            };
        }
    }
    return fallback;
}

export function refreshConfig(): void {
    resolvedCache = null;
}

/** 仅作用于当前进程的临时覆盖（例如 CLI 的 --agent / --skills-dir 参数）。 */
export function applyRuntimeOverrides(overrides: PersistedConfig): void {
    let changed = false;

    (Object.keys(overrides) as ConfigKey[]).forEach((key) => {
        const value = overrides[key];
        if (typeof value === 'string' && value.trim() !== '') {
            cliOverrides[key] = value.trim();
            changed = true;
        }
    });

    if (changed) {
        refreshConfig();
    }
}

export function clearRuntimeOverrides(): void {
    cliOverrides = {};
    refreshConfig();
}

export function resolveConfig(): ResolvedConfig {
    if (resolvedCache) {
        return resolvedCache;
    }

    const file = readConfigFile();

    const baseUrlPick = pickValue(
        [
            { value: cliOverrides.baseUrl, source: 'cli' },
            { value: process.env.GETSKILL_BASE_URL, source: 'env' },
            { value: file.baseUrl, source: 'file' }
        ],
        { value: DEFAULT_BASE_URL, source: 'default' }
    );

    const agentPick = pickValue(
        [
            { value: cliOverrides.agent, source: 'cli' },
            { value: process.env.GETSKILL_AGENT, source: 'env' },
            { value: file.agent, source: 'file' }
        ],
        { value: AUTO_AGENT_NAME, source: 'detect' }
    );

    const skillsDirPick = pickValue(
        [
            { value: cliOverrides.skillsDir, source: 'cli' },
            { value: process.env.GETSKILL_SKILLS_DIR, source: 'env' },
            { value: file.skillsDir, source: 'file' }
        ],
        { value: '', source: 'default' }
    );

    const cacheDirPick = pickValue(
        [
            { value: cliOverrides.cacheDir, source: 'cli' },
            { value: process.env.GETSKILL_CACHE_DIR, source: 'env' },
            { value: file.cacheDir, source: 'file' }
        ],
        { value: '', source: 'default' }
    );

    const requestedAgent = agentPick.value.toLowerCase();
    const preset = getAgentPreset(requestedAgent);
    const isAuto = requestedAgent === AUTO_AGENT_NAME;

    if (!preset && !isAuto && !skillsDirPick.value) {
        throw new GetSkillError(
            'INVALID_ARGS',
            `未知 agent: ${agentPick.value}（可用: auto, ${AGENT_PRESETS.map(
                (item) => item.name
            ).join(', ')}，或通过 skills-dir 指定任意目录）`
        );
    }

    const resolvedPreset = preset || getAgentPreset(detectAgentName());
    const agentName = skillsDirPick.value
        ? preset
            ? preset.name
            : CUSTOM_AGENT_NAME
        : (resolvedPreset as AgentPreset).name;
    const agentLabel = skillsDirPick.value
        ? preset
            ? preset.label
            : '自定义目录'
        : (resolvedPreset as AgentPreset).label;

    const skillsDir = skillsDirPick.value
        ? normalizePath(skillsDirPick.value)
        : getPresetSkillsDir(resolvedPreset as AgentPreset);
    const skillsDirSource: ConfigSource = skillsDirPick.value
        ? skillsDirPick.source
        : isAuto || !preset
          ? 'detect'
          : agentPick.source;

    const cacheDir = cacheDirPick.value
        ? normalizePath(cacheDirPick.value)
        : path.join(getGetSkillHome(), 'cache');

    const envRestartCommand = process.env.GETSKILL_RESTART_CMD;
    const restartCommand = !isBlank(envRestartCommand)
        ? (envRestartCommand as string).trim()
        : (resolvedPreset as AgentPreset | null)?.restartCommand || null;

    const resolved: ResolvedConfig = {
        baseUrl: normalizeBaseUrl(baseUrlPick.value),
        agent: agentName,
        agentLabel,
        skillsDir,
        cacheDir,
        homeDir: getGetSkillHome(),
        configFile: getConfigFilePath(),
        stateFile: getStateFilePath(),
        restartCommand,
        sources: {
            baseUrl: baseUrlPick.source,
            agent: isAuto
                ? skillsDirPick.value
                    ? skillsDirPick.source
                    : 'detect'
                : agentPick.source,
            skillsDir: skillsDirSource,
            cacheDir: cacheDirPick.value ? cacheDirPick.source : 'default'
        }
    };

    resolvedCache = resolved;
    return resolved;
}

export function getConfigSummary(): ResolvedConfig {
    return resolveConfig();
}

export function getBaseUrl(): string {
    return resolveConfig().baseUrl;
}

export function getSkillsDirectory(): string {
    return resolveConfig().skillsDir;
}

/**
 * 安装/更新的安全门禁：技能目录必须显式指定
 * （agent 或 skills-dir 来自 CLI 参数 / 环境变量 / 配置文件均可）。
 * 若目录仅来自自动探测（detect），则拒绝写入，
 * 避免把技能装到非当前 Agent 的技能目录。
 */
export function assertExplicitSkillsDir(): ResolvedConfig {
    const config = resolveConfig();
    if (config.sources.skillsDir !== 'detect') {
        return config;
    }

    throw new GetSkillError(
        'TARGET_NOT_CONFIGURED',
        [
            `未能确认当前 Agent 的技能目录（自动探测结果: ${config.skillsDir}），已暂停安装/更新/卸载技能。`,
            '为避免装错 Agent 目录，请先通过以下任一方式显式指定后重试:',
            '  getskill config set skills-dir <技能目录>            # 持久化任意目录',
            '  getskill config set agent <name>                     # 持久化内置 Agent',
            '  getskill --skills-dir <目录> install <技能名称>      # 仅本次生效',
            '  或设置环境变量 GETSKILL_SKILLS_DIR / GETSKILL_AGENT'
        ].join('\n')
    );
}

export function getSkillsCacheDirectory(): string {
    return resolveConfig().cacheDir;
}

export function getAgentName(): string {
    return resolveConfig().agent;
}

export function getAgentLabel(): string {
    return resolveConfig().agentLabel;
}

export function getAgentRestartCommand(): string | null {
    return resolveConfig().restartCommand;
}

export function listAgents(): AgentSummary[] {
    const active = resolveConfig();

    return AGENT_PRESETS.map((preset) => {
        const skillsDir = getPresetSkillsDir(preset);
        return {
            name: preset.name,
            label: preset.label,
            skillsDir,
            exists: fs.existsSync(skillsDir),
            active: isSamePath(skillsDir, active.skillsDir),
            restartCommand: preset.restartCommand || null
        };
    });
}

/** 历史版本（2.0 及更早）遗留的缓存目录，`clean` 命令会一并清理。 */
export function getLegacyCacheDirectories(): string[] {
    const current = getSkillsCacheDirectory();
    const candidates = [path.join(os.homedir(), '.openclaw', 'skills-cache')];

    return [...new Set(candidates)].filter(
        (candidate) => !isSamePath(candidate, current)
    );
}

function persistConfig(patch: PersistedConfig): ResolvedConfig {
    const next: PersistedConfig = { ...readConfigFile() };

    (Object.keys(patch) as ConfigKey[]).forEach((key) => {
        const value = patch[key];
        if (typeof value === 'string' && value.trim() !== '') {
            next[key] = value.trim();
            return;
        }
        delete next[key];
    });

    writeConfigFile(next);
    refreshConfig();
    return resolveConfig();
}

function normalizeConfigValue(configKey: ConfigKey, rawValue: string): string {
    if (isBlank(rawValue)) {
        throw new GetSkillError(
            'INVALID_ARGS',
            `配置项 ${configKey} 的值不能为空`
        );
    }

    const value = rawValue.trim();

    if (configKey === 'baseUrl') {
        return normalizeBaseUrl(value);
    }

    if (configKey === 'skillsDir' || configKey === 'cacheDir') {
        return normalizePath(value);
    }

    const normalized = value.toLowerCase();
    if (normalized !== AUTO_AGENT_NAME && !getAgentPreset(normalized)) {
        throw new GetSkillError(
            'INVALID_ARGS',
            `未知 agent: ${value}（可用: auto, ${AGENT_PRESETS.map(
                (item) => item.name
            ).join(', ')}）`
        );
    }
    return normalized;
}

/** 写入并持久化配置项，返回写入后的完整生效配置。 */
export function setConfigValue(
    key: ConfigKey | string,
    rawValue: string
): ResolvedConfig {
    const configKey = normalizeConfigKey(String(key));
    return persistConfig({
        [configKey]: normalizeConfigValue(configKey, rawValue)
    } as PersistedConfig);
}

/** 删除已持久化的配置项，恢复为环境变量 / 自动识别 / 默认值。 */
export function unsetConfigValue(key: ConfigKey | string): ResolvedConfig {
    const configKey = normalizeConfigKey(String(key));
    return persistConfig({ [configKey]: '' } as PersistedConfig);
}

export function setBaseUrl(url: string): string {
    return setConfigValue('baseUrl', url).baseUrl;
}

export function setAgent(name: string): string {
    return setConfigValue('agent', name).agent;
}

export function setSkillsDir(dir: string): string {
    return setConfigValue('skillsDir', dir).skillsDir;
}

export function setCacheDir(dir: string): string {
    return setConfigValue('cacheDir', dir).cacheDir;
}
