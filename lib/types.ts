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

export interface SearchSkill {
    name: string;
    full_name: string;
    description: string;
    html_url: string;
    git_url: string;
    clone_url: string;
}

export interface RepositoryCandidate {
    name?: string;
    full_name?: string;
    description?: string;
    html_url?: string;
    clone_url?: string;
    private?: boolean;
    empty?: boolean;
    archived?: boolean;
    template?: boolean;
    fork?: boolean;
}

export interface SearchApiItem {
    repository?: RepositoryCandidate;
    [key: string]: unknown;
}

export interface SearchApiPayload {
    ok?: boolean;
    message?: string;
    data?: Array<RepositoryCandidate | SearchApiItem>;
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
}

export interface InstallState {
    skills: Record<string, SkillStateRecord>;
}

export interface DownloadResult {
    skillName: string;
    repoPath: string;
    files: string[];
    requestedVersion?: string | null;
}

export interface DownloadOptions {
    version?: string;
}

export interface UpdateAllResult {
    skillName: string;
    ok: boolean;
    result?: DownloadResult;
    error?: string;
}

export interface InstalledSkillInfo {
    skillName: string;
    localSkillName: string;
    installed: boolean;
    cached: boolean;
    skillDir: string;
    repoPath: string;
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

export interface PublishOptions {
    repoUrl?: string;
    branch?: string;
    message?: string;
}

export interface PublishResult {
    skillPath: string;
    remoteUrl: string;
    branch: string;
    committed: boolean;
}
