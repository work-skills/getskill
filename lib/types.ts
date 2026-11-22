export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'debug';

export interface CommandOutput {
    stdout: string;
    stderr: string;
}

export interface RequestOptions {
    method?: string;
    headers?: Record<string, string>;
    timeout?: number;
    body?: string;
    followRedirects?: boolean;
    allowNonSuccessStatus?: boolean;
}

export interface RequestResponse {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
}

export interface SearchOptions {
    sort?: string;
    order?: string;
    page?: number;
    limit?: number;
}

export interface SkillIndexEntry {
    id: string;
    name: string;
    description: string;
    category?: string;
    tags?: string[];
    version: string;
    author?: string;
    updated?: string;
    file: string;
    size?: number;
    source?: string;
}

export interface SkillsIndexPayload {
    skills?: SkillIndexEntry[];
}

export interface SearchSkill {
    name: string;
    full_name: string;
    description: string;
    html_url: string;
    git_url: string;
    clone_url: string;
    download_url: string;
    version: string;
    category: string;
    author: string;
    size: number;
    /** 是否已安装到当前 Agent 的技能目录。 */
    installed: boolean;
    /** 本地已安装版本（未安装或无版本记录时为 null）。 */
    installed_version: string | null;
    /** 建议动作: skip=本地版本不低于站点版本, update=站点有更新版本, install=未安装。 */
    suggested_action: 'install' | 'update' | 'skip';
}

/** search 的分页元数据（与 index 命令对称）。 */
export interface SearchPage {
    results: SearchSkill[];
    /** 匹配总数（分页前）。 */
    total: number;
    page: number;
    limit: number;
    has_more: boolean;
}

/** 索引来源与新鲜度（随 JSON 信封输出，供 Agent 判断是否需要刷新）。 */
export interface SkillsIndexMeta {
    fetched_at: string | null;
    source: 'remote' | 'cache' | 'stale-cache' | 'none';
    stale: boolean;
}

/** list 命令的本地技能明细（目录扫描 + state 合并）。 */
export interface LocalSkillDetail {
    name: string;
    version: string | null;
    /** 是否由 getskill 管理（state 中有记录）。 */
    managed: boolean;
    skill_dir: string;
    updated_at: string | null;
}

export interface InstalledSkillSnapshot {
    skillName: string;
    localSkillName: string;
    version: string | null;
    skillDir: string;
}

export interface FetchIndexOptions {
    /** 忽略缓存 TTL 强制刷新（每进程最多触发一次下载）。 */
    forceRefresh?: boolean;
    /** 只读模式：下载后不落盘索引缓存（--dry-run 预演使用）。 */
    noCacheWrite?: boolean;
}

export interface SkillStateRecord {
    inputSkillName: string;
    localSkillName: string;
    remoteSkillPath: string;
    repoPath: string;
    installDir: string;
    lastAction: 'install' | 'update';
    installedAt: string;
    updatedAt: string;
    gitCommitHash: string | null;
    requestedVersion?: string | null;
    version?: string | null;
    agent?: string | null;
    skillsDir?: string | null;
    /** 安装时技能目录内容的哈希，用于检测本地修改。 */
    contentHash?: string | null;
}

export interface InstallState {
    skills: Record<string, SkillStateRecord>;
}

export interface DownloadResult {
    skillName: string;
    repoPath: string;
    files: string[];
    requestedVersion?: string | null;
    version?: string | null;
    upToDate?: boolean;
    /** 覆盖前检测到本地内容与安装时记录不一致（本地改动将被覆盖）。 */
    localModified?: boolean;
    /** 安装过程中的非致命警告（跳过符号链接/超大文件、体积不一致等）。 */
    warnings?: string[];
}

export interface DownloadOptions {
    version?: string;
    /** 同版本已安装时仍强制重新下载安装。 */
    force?: boolean;
    /** 强制刷新技能索引缓存后再解析技能（install --refresh）。 */
    refresh?: boolean;
}

export interface UpdateAllOptions {
    /** 同时清理索引中已不存在的历史安装记录。 */
    prune?: boolean;
}

export interface UpdateAllResult {
    skillName: string;
    ok: boolean;
    /** 索引中已不存在 / 安装目录缺失等跳过情形，非失败。 */
    skipped?: boolean;
    /** updated / up_to_date / stale / missing / failed */
    status?: 'updated' | 'up_to_date' | 'stale' | 'missing' | 'failed';
    version?: string | null;
    result?: DownloadResult;
    error?: string;
    /** 失败时的结构化错误码。 */
    code?: string;
}

export interface InstalledSkillInfo {
    skillName: string;
    localSkillName: string;
    installed: boolean;
    cached: boolean;
    skillDir: string;
    /** 解压缓存目录（ZIP 解压根目录）。 */
    repoPath: string;
    /** 缓存根目录下的技能目录，可能不存在。 */
    cacheDir: string;
    skillsDir: string;
    agent: string;
    agentLabel: string;
    state: SkillStateRecord | null;
    /** 已安装目录内容与安装时记录的哈希不一致。 */
    localModified?: boolean;
}

export interface RemoveInstalledSkillResult {
    skillName: string;
    localSkillName: string;
    removedInstall: boolean;
    removedCache: boolean;
    skillDir: string;
    repoPath: string;
    /** 目录是否由 getskill 管理（存在当前技能目录的安装记录）。 */
    managed: boolean;
}
