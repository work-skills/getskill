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
    /** 建议动作: skip=同版本已装, update=已装但版本不同, install=未安装。 */
    suggested_action: 'install' | 'update' | 'skip';
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
}

export interface DownloadOptions {
    version?: string;
    /** 同版本已安装时仍强制重新下载安装。 */
    force?: boolean;
}

export interface UpdateAllOptions {
    /** 同时清理索引中已不存在的历史安装记录。 */
    prune?: boolean;
}

export interface UpdateAllResult {
    skillName: string;
    ok: boolean;
    /** 索引中已不存在该技能（历史记录失效），非失败。 */
    skipped?: boolean;
    result?: DownloadResult;
    error?: string;
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
}

export interface RemoveInstalledSkillResult {
    skillName: string;
    localSkillName: string;
    removedInstall: boolean;
    removedCache: boolean;
    skillDir: string;
    repoPath: string;
}
