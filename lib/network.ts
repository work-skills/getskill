import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';

import {
    getBaseUrl,
    getSkillsCacheDirectory,
    REQUEST_TIMEOUT_MS,
    SKILLS_INDEX_CACHE_TTL_MS
} from './config';
import logger from './logger';
import { GetSkillError } from './errors';
import { getInstalledSkillsSnapshot } from './state';
import { ensureDirectoryExists } from './system';
import type {
    FetchIndexOptions,
    InstalledSkillSnapshot,
    RequestOptions,
    RequestResponse,
    SearchOptions,
    SearchSkill,
    SkillIndexEntry,
    SkillsIndexPayload
} from './types';

export function request(
    url: string,
    options: RequestOptions = {},
    redirectCount = 0
): Promise<RequestResponse> {
    const MAX_REDIRECTS = 5;

    return new Promise((resolve, reject) => {
        if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error(`Too many redirects (${MAX_REDIRECTS})`));
            return;
        }

        let urlObj: URL;
        try {
            urlObj = new URL(url);
        } catch {
            reject(new Error(`Invalid URL: ${url}`));
            return;
        }

        const protocol = urlObj.protocol === 'https:' ? https : http;
        const reqOptions: http.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: options.method || 'GET',
            headers: options.headers || {},
            timeout: options.timeout || REQUEST_TIMEOUT_MS
        };

        const req = protocol.request(reqOptions, (res) => {
            const statusCode = res.statusCode ?? 0;
            if (
                options.followRedirects !== false &&
                [301, 302, 303, 307, 308].includes(statusCode)
            ) {
                const locationHeader = res.headers.location;
                const redirectUrl = Array.isArray(locationHeader)
                    ? locationHeader[0]
                    : locationHeader;

                if (!redirectUrl) {
                    reject(
                        new Error(
                            `Redirect location header missing (${statusCode})`
                        )
                    );
                    return;
                }

                let newUrl: string;
                try {
                    newUrl = new URL(redirectUrl, url).toString();
                } catch {
                    reject(new Error(`Invalid redirect URL: ${redirectUrl}`));
                    return;
                }

                request(newUrl, options, redirectCount + 1)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            let data = '';

            res.on('data', (chunk: Buffer | string) => {
                data += chunk.toString();
            });

            res.on('end', () => {
                if (
                    (statusCode >= 200 && statusCode < 300) ||
                    options.allowNonSuccessStatus
                ) {
                    resolve({
                        statusCode,
                        headers: res.headers,
                        body: data
                    });
                    return;
                }

                reject(
                    new Error(
                        `Request failed with status code ${statusCode}: ${data.substring(0, 200)}`
                    )
                );
            });

            res.on('error', (error) => {
                reject(new Error(`Response error: ${error.message}`));
            });
        });

        req.on('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'ECONNREFUSED') {
                reject(new Error(`Connection refused: ${urlObj.hostname}`));
            } else if (error.code === 'ENOTFOUND') {
                reject(new Error(`Host not found: ${urlObj.hostname}`));
            } else if (
                error.code === 'ETIMEDOUT' ||
                error.code === 'ESOCKETTIMEDOUT'
            ) {
                reject(new Error(`Request timeout: ${url}`));
            } else {
                reject(new Error(`Network error: ${error.message}`));
            }
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Request timeout after ${reqOptions.timeout}ms`));
        });

        if (options.body) {
            req.write(options.body);
        }

        req.end();
    });
}

export function downloadFile(
    url: string,
    destPath: string,
    redirectCount = 0
): Promise<number> {
    const MAX_REDIRECTS = 5;

    return new Promise((resolve, reject) => {
        if (redirectCount >= MAX_REDIRECTS) {
            reject(new Error(`Too many redirects (${MAX_REDIRECTS})`));
            return;
        }

        let urlObj: URL;
        try {
            urlObj = new URL(url);
        } catch {
            reject(new Error(`Invalid URL: ${url}`));
            return;
        }

        const protocol = urlObj.protocol === 'https:' ? https : http;
        const reqOptions: http.RequestOptions = {
            hostname: urlObj.hostname,
            port: urlObj.port,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            timeout: REQUEST_TIMEOUT_MS
        };

        const req = protocol.request(reqOptions, (res) => {
            const statusCode = res.statusCode ?? 0;

            if ([301, 302, 303, 307, 308].includes(statusCode)) {
                const locationHeader = res.headers.location;
                const redirectUrl = Array.isArray(locationHeader)
                    ? locationHeader[0]
                    : locationHeader;

                res.resume();

                if (!redirectUrl) {
                    reject(
                        new Error(
                            `Redirect location header missing (${statusCode})`
                        )
                    );
                    return;
                }

                let newUrl: string;
                try {
                    newUrl = new URL(redirectUrl, url).toString();
                } catch {
                    reject(new Error(`Invalid redirect URL: ${redirectUrl}`));
                    return;
                }

                downloadFile(newUrl, destPath, redirectCount + 1)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            if (statusCode < 200 || statusCode >= 300) {
                res.resume();
                reject(
                    new Error(
                        `Request failed with status code ${statusCode}: ${url}`
                    )
                );
                return;
            }

            let receivedBytes = 0;
            const fileStream = fs.createWriteStream(destPath);

            res.on('data', (chunk: Buffer | string) => {
                receivedBytes += chunk.length;
            });

            res.on('error', (error) => {
                fileStream.destroy();
                fs.rmSync(destPath, { force: true });
                reject(new Error(`Response error: ${error.message}`));
            });

            fileStream.on('error', (error) => {
                res.destroy();
                fs.rmSync(destPath, { force: true });
                reject(new Error(`Write file error: ${error.message}`));
            });

            fileStream.on('finish', () => {
                fileStream.close(() => resolve(receivedBytes));
            });

            res.pipe(fileStream);
        });

        req.on('error', (error: NodeJS.ErrnoException) => {
            fs.rmSync(destPath, { force: true });
            if (error.code === 'ECONNREFUSED') {
                reject(new Error(`Connection refused: ${urlObj.hostname}`));
            } else if (error.code === 'ENOTFOUND') {
                reject(new Error(`Host not found: ${urlObj.hostname}`));
            } else if (
                error.code === 'ETIMEDOUT' ||
                error.code === 'ESOCKETTIMEDOUT'
            ) {
                reject(new Error(`Request timeout: ${url}`));
            } else {
                reject(new Error(`Network error: ${error.message}`));
            }
        });

        req.on('timeout', () => {
            req.destroy();
            fs.rmSync(destPath, { force: true });
            reject(
                new Error(
                    `Request timeout after ${REQUEST_TIMEOUT_MS}ms: ${url}`
                )
            );
        });

        req.end();
    });
}

export function getSkillsIndexUrl(): string {
    return `${getBaseUrl()}/data/skills.json`;
}

export function getSkillPackageUrl(entry: SkillIndexEntry): string {
    const file = (entry.file || '').trim();
    if (!file) {
        return `${getBaseUrl()}/skills/${encodeURIComponent(entry.id)}.zip`;
    }

    if (/^https?:\/\//i.test(file)) {
        return file;
    }

    return `${getBaseUrl()}/${file.replace(/^\/+/, '')}`;
}

interface CachedSkillsIndex {
    baseUrl: string;
    fetchedAt: string;
    skills: SkillIndexEntry[];
}

/** 本进程内是否已下载过索引，避免 update --all 逐个技能重复强制刷新。 */
let indexDownloadedInProcess = false;

export function getSkillsIndexCacheFilePath(): string {
    return path.join(getSkillsCacheDirectory(), 'skills-index.json');
}

function readSkillsIndexCache(): CachedSkillsIndex | null {
    const cacheFile = getSkillsIndexCacheFilePath();
    if (!fs.existsSync(cacheFile)) {
        return null;
    }

    try {
        const parsed = JSON.parse(
            fs.readFileSync(cacheFile, 'utf8')
        ) as Partial<CachedSkillsIndex>;

        if (
            !parsed ||
            parsed.baseUrl !== getBaseUrl() ||
            typeof parsed.fetchedAt !== 'string' ||
            !Number.isFinite(Date.parse(parsed.fetchedAt)) ||
            !Array.isArray(parsed.skills)
        ) {
            return null;
        }

        return parsed as CachedSkillsIndex;
    } catch {
        return null;
    }
}

function writeSkillsIndexCache(skills: SkillIndexEntry[]): void {
    try {
        const cacheFile = getSkillsIndexCacheFilePath();
        ensureDirectoryExists(path.dirname(cacheFile));
        const payload: CachedSkillsIndex = {
            baseUrl: getBaseUrl(),
            fetchedAt: new Date().toISOString(),
            skills
        };
        fs.writeFileSync(cacheFile, JSON.stringify(payload, null, 2), 'utf8');
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`技能索引缓存写入失败（不影响本次结果）: ${message}`);
    }
}

/** 删除本地索引缓存并重置进程内刷新标记（clean / 测试使用）。 */
export function clearSkillsIndexCache(): void {
    indexDownloadedInProcess = false;
    const cacheFile = getSkillsIndexCacheFilePath();
    if (fs.existsSync(cacheFile)) {
        fs.rmSync(cacheFile, { force: true });
    }
}

async function downloadSkillsIndex(): Promise<SkillIndexEntry[]> {
    const url = getSkillsIndexUrl();
    const response = await request(url, { timeout: REQUEST_TIMEOUT_MS });

    if (!response.body || response.body.trim() === '') {
        throw new Error('技能索引为空: 服务器返回空响应');
    }

    let parsed: SkillsIndexPayload;
    try {
        parsed = JSON.parse(response.body) as SkillsIndexPayload;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`技能索引 JSON 解析失败: ${message}`);
    }

    if (!parsed || !Array.isArray(parsed.skills)) {
        throw new Error('技能索引格式无效: 缺少 skills 数组');
    }

    return parsed.skills.filter(
        (entry) =>
            entry &&
            typeof entry.id === 'string' &&
            entry.id.trim() !== '' &&
            typeof entry.file === 'string' &&
            entry.file.trim() !== ''
    );
}

/**
 * 获取技能索引：优先使用本地缓存（TTL 1 天），过期或强制刷新时重新下载；
 * 下载失败但存在旧缓存时回退到旧缓存，保证离线可用。
 */
export async function fetchSkillsIndex(
    options: FetchIndexOptions = {}
): Promise<SkillIndexEntry[]> {
    const cache = readSkillsIndexCache();
    const cacheAgeMs = cache
        ? Date.now() - Date.parse(cache.fetchedAt)
        : Number.POSITIVE_INFINITY;
    const cacheFresh =
        Boolean(cache) &&
        cacheAgeMs >= 0 &&
        cacheAgeMs < SKILLS_INDEX_CACHE_TTL_MS;
    const mustRefresh =
        options.forceRefresh === true && !indexDownloadedInProcess;

    if (cache && cacheFresh && !mustRefresh) {
        logger.debug(
            `使用本地技能索引缓存: ${getSkillsIndexCacheFilePath()} (${cache?.fetchedAt})`
        );
        return cache.skills;
    }

    try {
        const skills = await downloadSkillsIndex();
        writeSkillsIndexCache(skills);
        indexDownloadedInProcess = true;
        return skills;
    } catch (error) {
        if (cache) {
            const message =
                error instanceof Error ? error.message : String(error);
            logger.warn(
                `技能索引下载失败，回退到本地缓存 (${cache.fetchedAt}): ${message}`
            );
            return cache.skills;
        }
        throw new GetSkillError(
            'NETWORK_ERROR',
            error instanceof Error ? error.message : String(error)
        );
    }
}

export function normalizeSkillIndexKey(skillName: string): string {
    return skillName
        .trim()
        .replace(/^skills\//, '')
        .replace(/[\\/_\s]+/g, '-')
        .replace(/-{2,}/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

export function filterIndexByKeyword(
    entries: SkillIndexEntry[],
    keyword: string,
    limit = 20,
    page = 1
): SkillIndexEntry[] {
    if (!Array.isArray(entries) || entries.length === 0) {
        return [];
    }

    const normalizedKeyword = (keyword || '').trim().toLowerCase();
    if (!normalizedKeyword) {
        return [];
    }

    const matched = entries.filter((entry) => {
        const haystacks = [
            entry.id,
            entry.name,
            entry.description,
            entry.category || '',
            entry.author || '',
            ...(Array.isArray(entry.tags) ? entry.tags : [])
        ];

        return haystacks.some(
            (value) =>
                typeof value === 'string' &&
                value.toLowerCase().includes(normalizedKeyword)
        );
    });

    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 20;
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;
    const start = (safePage - 1) * safeLimit;

    return matched.slice(start, start + safeLimit);
}

export function mapIndexEntryToSearchSkill(
    entry: SkillIndexEntry
): SearchSkill {
    const downloadUrl = getSkillPackageUrl(entry);

    return {
        name: entry.name || entry.id,
        full_name: entry.id,
        description: entry.description || '',
        html_url: `${getBaseUrl()}/skill.html?id=${encodeURIComponent(entry.id)}`,
        git_url: downloadUrl,
        clone_url: downloadUrl,
        download_url: downloadUrl,
        version: entry.version || 'unknown',
        category: entry.category || '',
        author: entry.author || '',
        size: typeof entry.size === 'number' ? entry.size : 0,
        installed: false,
        installed_version: null,
        suggested_action: 'install'
    };
}

export async function findSkillIndexEntry(
    skillName: string,
    options: FetchIndexOptions = {}
): Promise<SkillIndexEntry | null> {
    if (!skillName || typeof skillName !== 'string') {
        return null;
    }

    const normalized = normalizeSkillIndexKey(skillName);
    if (!normalized) {
        return null;
    }

    const entries = await fetchSkillsIndex(options);
    return (
        entries.find(
            (entry) =>
                normalizeSkillIndexKey(entry.id) === normalized ||
                normalizeSkillIndexKey(entry.name || '') === normalized
        ) || null
    );
}

/**
 * 拉取站点上的 SKILL.md 预览（`<base-url>/skills/<id>/SKILL.md`）。
 * 技能不存在或站点未提供该文件时返回 null，不抛异常。
 */
export async function fetchSkillMarkdown(
    skillName: string
): Promise<string | null> {
    const entry = await findSkillIndexEntry(skillName);
    if (!entry) {
        return null;
    }

    const url = `${getBaseUrl()}/skills/${encodeURIComponent(entry.id)}/SKILL.md`;
    try {
        const response = await request(url, {
            timeout: Math.min(REQUEST_TIMEOUT_MS, 15_000)
        });
        return response.body;
    } catch {
        return null;
    }
}

export async function repositoryHasSkillFile(
    skillName: string
): Promise<boolean> {
    if (!skillName || typeof skillName !== 'string') {
        return false;
    }

    const normalized = skillName
        .trim()
        .replace(/^skills\//, '')
        .replace(/[\\/]/g, '_');
    if (!normalized) {
        return false;
    }

    const url = `${getBaseUrl()}/skills/${encodeURIComponent(normalized)}/SKILL.md`;

    try {
        await request(url, { timeout: Math.min(REQUEST_TIMEOUT_MS, 15_000) });
        return true;
    } catch {
        return false;
    }
}

export async function searchSkills(
    keyword: string,
    options: SearchOptions = {}
): Promise<SearchSkill[]> {
    if (!keyword || typeof keyword !== 'string') {
        throw new GetSkillError('INVALID_ARGS', '搜索失败: 关键词无效');
    }

    const { page = 1, limit = 20 } = options;

    try {
        const entries = await fetchSkillsIndex();
        const matched = filterIndexByKeyword(entries, keyword, limit, page);

        const installedByKey = new Map<string, InstalledSkillSnapshot>();
        getInstalledSkillsSnapshot().forEach((item) => {
            installedByKey.set(normalizeSkillIndexKey(item.skillName), item);
            installedByKey.set(
                normalizeSkillIndexKey(item.localSkillName),
                item
            );
        });

        return matched.map((entry) => {
            const skill = mapIndexEntryToSearchSkill(entry);
            const local =
                installedByKey.get(normalizeSkillIndexKey(entry.id)) ||
                installedByKey.get(normalizeSkillIndexKey(entry.name || '')) ||
                null;

            skill.installed = Boolean(local);
            skill.installed_version = local?.version ?? null;
            skill.suggested_action = !local
                ? 'install'
                : local.version && local.version === entry.version
                  ? 'skip'
                  : 'update';
            return skill;
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        let friendly: string;

        if (message.includes('Host not found')) {
            friendly = '搜索失败: 无法连接到服务器，请检查网络或 API 地址配置';
        } else if (message.includes('timeout')) {
            friendly = '搜索失败: 请求超时，请稍后重试';
        } else if (message.includes('Connection refused')) {
            friendly = '搜索失败: 服务器拒绝连接，请检查 API 地址是否正确';
        } else if (message.includes('status code')) {
            friendly = `搜索失败: 服务器返回错误 (${message})`;
        } else {
            friendly = `搜索失败: ${message}`;
        }

        logger.error(friendly);
        // 抛出带错误码的异常，让调用方区分“搜索失败”与“无匹配结果”
        throw new GetSkillError('NETWORK_ERROR', friendly);
    }
}
