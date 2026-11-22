import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';

import {
    MAX_DOWNLOAD_BYTES,
    MAX_INDEX_RESPONSE_BYTES,
    getBaseUrl,
    getRequestTimeoutMs,
    getSkillsCacheDirectory,
    SKILLS_INDEX_CACHE_TTL_MS
} from './config';
import logger from './logger';
import { GetSkillError } from './errors';
import { getInstalledSkillsSnapshot, normalizeSkillIndexKey } from './state';
import { ensureDirectoryExists } from './system';
import { compareVersions } from './version';
import type {
    FetchIndexOptions,
    InstalledSkillSnapshot,
    RequestOptions,
    RequestResponse,
    SearchOptions,
    SearchPage,
    SearchSkill,
    SkillIndexEntry,
    SkillsIndexMeta,
    SkillsIndexPayload
} from './types';

export { normalizeSkillIndexKey } from './state';

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
            timeout: options.timeout || getRequestTimeoutMs()
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

                // H6：拒绝 HTTPS→HTTP 降级重定向（防中间人篡改技能包）
                if (
                    urlObj.protocol === 'https:' &&
                    new URL(newUrl).protocol === 'http:'
                ) {
                    res.resume();
                    reject(
                        new Error(
                            `Refusing HTTPS to HTTP downgrade redirect: ${newUrl}`
                        )
                    );
                    return;
                }

                res.resume();
                request(newUrl, options, redirectCount + 1)
                    .then(resolve)
                    .catch(reject);
                return;
            }

            let data = '';
            let receivedBytes = 0;

            res.on('data', (chunk: Buffer | string) => {
                receivedBytes += Buffer.byteLength(chunk);
                // H5：文本响应体积上限，防异常/恶意服务器耗尽内存
                if (receivedBytes > MAX_INDEX_RESPONSE_BYTES) {
                    res.destroy();
                    reject(
                        new Error(
                            `Response body exceeds limit ${MAX_INDEX_RESPONSE_BYTES} bytes: ${url}`
                        )
                    );
                    return;
                }
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
            timeout: getRequestTimeoutMs()
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

                // H6：拒绝 HTTPS→HTTP 降级重定向（防中间人篡改技能包）
                if (
                    urlObj.protocol === 'https:' &&
                    new URL(newUrl).protocol === 'http:'
                ) {
                    reject(
                        new Error(
                            `Refusing HTTPS to HTTP downgrade redirect: ${newUrl}`
                        )
                    );
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
                receivedBytes += Buffer.byteLength(chunk);
                // H5：下载体积上限，超限立即中断并清理半成品文件
                if (receivedBytes > MAX_DOWNLOAD_BYTES) {
                    res.destroy();
                    fileStream.destroy();
                    fs.rmSync(destPath, { force: true });
                    reject(
                        new Error(
                            `Skill package exceeds download limit ${MAX_DOWNLOAD_BYTES} bytes: ${url}`
                        )
                    );
                }
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
                    `Request timeout after ${getRequestTimeoutMs()}ms: ${url}`
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

/**
 * H6：下载前的地址策略校验。
 * - 技能包地址与索引源不同源时默认拒绝（GETSKILL_ALLOW_CROSS_ORIGIN=1 可放行）；
 * - 非本机回环地址的明文 HTTP 下载给出告警。
 * search/show 仅展示 URL 不受影响，只有真正下载时调用。
 */
export function assertPackageUrlAllowed(url: string): void {
    let target: URL;
    try {
        target = new URL(url);
    } catch {
        throw new GetSkillError('NETWORK_ERROR', `技能包地址无效: ${url}`);
    }

    const base = new URL(getBaseUrl());
    if (
        target.origin !== base.origin &&
        process.env.GETSKILL_ALLOW_CROSS_ORIGIN !== '1'
    ) {
        throw new GetSkillError(
            'NETWORK_ERROR',
            `技能包地址跨域（${target.origin}，索引源为 ${base.origin}），默认拒绝下载。如信任该来源，请设置 GETSKILL_ALLOW_CROSS_ORIGIN=1 后重试`
        );
    }

    if (
        target.protocol === 'http:' &&
        !['localhost', '127.0.0.1', '::1', '[::1]'].includes(target.hostname)
    ) {
        logger.warn(
            `技能包将通过明文 HTTP 下载 (${target.origin})，内容可能被中间人篡改；建议使用 HTTPS 索引源`
        );
    }
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
        // 原子写：先写临时文件再 rename，避免并发读到半截 JSON
        const tempFile = `${cacheFile}.tmp-${process.pid}`;
        fs.writeFileSync(tempFile, JSON.stringify(payload, null, 2), 'utf8');
        fs.renameSync(tempFile, cacheFile);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`技能索引缓存写入失败（不影响本次结果）: ${message}`);
    }
}

/** 最近一次 fetchSkillsIndex 的来源与新鲜度（供 JSON 信封输出）。 */
let lastIndexMeta: SkillsIndexMeta = {
    fetched_at: null,
    source: 'none',
    stale: false
};

export function getSkillsIndexMeta(): SkillsIndexMeta {
    return { ...lastIndexMeta };
}

/** 只读查看本地索引缓存（status 命令使用，不触发下载）。 */
export function peekSkillsIndexCache(): {
    fetched_at: string;
    skill_count: number;
    stale: boolean;
} | null {
    const cache = readSkillsIndexCache();
    if (!cache) {
        return null;
    }
    const ageMs = Date.now() - Date.parse(cache.fetchedAt);
    return {
        fetched_at: cache.fetchedAt,
        skill_count: cache.skills.length,
        stale: !(ageMs >= 0 && ageMs < SKILLS_INDEX_CACHE_TTL_MS)
    };
}

/** 只读读取本地索引缓存条目（did-you-mean 建议使用，不触发下载）。 */
export function readCachedIndexEntries(): SkillIndexEntry[] | null {
    return readSkillsIndexCache()?.skills ?? null;
}

/** 删除本地索引缓存并重置进程内刷新标记（clean / 测试使用）。 */
export function clearSkillsIndexCache(): void {
    indexDownloadedInProcess = false;
    lastIndexMeta = { fetched_at: null, source: 'none', stale: false };
    const cacheFile = getSkillsIndexCacheFilePath();
    if (fs.existsSync(cacheFile)) {
        fs.rmSync(cacheFile, { force: true });
    }
}

async function downloadSkillsIndex(): Promise<SkillIndexEntry[]> {
    const url = getSkillsIndexUrl();
    const response = await request(url, { timeout: getRequestTimeoutMs() });

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
        lastIndexMeta = {
            fetched_at: cache.fetchedAt,
            source: 'cache',
            stale: false
        };
        return cache.skills;
    }

    try {
        const skills = await downloadSkillsIndex();
        writeSkillsIndexCache(skills);
        indexDownloadedInProcess = true;
        lastIndexMeta = {
            fetched_at: new Date().toISOString(),
            source: 'remote',
            stale: false
        };
        return skills;
    } catch (error) {
        if (cache) {
            const message =
                error instanceof Error ? error.message : String(error);
            logger.warn(
                `技能索引下载失败，回退到本地缓存 (${cache.fetchedAt}): ${message}`
            );
            lastIndexMeta = {
                fetched_at: cache.fetchedAt,
                source: 'stale-cache',
                stale: true
            };
            return cache.skills;
        }
        throw new GetSkillError(
            'NETWORK_ERROR',
            error instanceof Error ? error.message : String(error)
        );
    }
}

/** 关键词分词（空格分隔），每个词都必须命中某个字段（AND 语义）。 */
export function matchIndexEntries(
    entries: SkillIndexEntry[],
    keyword: string
): SkillIndexEntry[] {
    if (!Array.isArray(entries) || entries.length === 0) {
        return [];
    }

    const tokens = (keyword || '')
        .trim()
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    if (tokens.length === 0) {
        return [];
    }

    return entries.filter((entry) => {
        const haystacks = [
            entry.id,
            entry.name,
            entry.description,
            entry.category || '',
            entry.author || '',
            ...(Array.isArray(entry.tags) ? entry.tags : [])
        ]
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.toLowerCase());

        return tokens.every((token) =>
            haystacks.some((value) => value.includes(token))
        );
    });
}

export function filterIndexByKeyword(
    entries: SkillIndexEntry[],
    keyword: string,
    limit = 20,
    page = 1
): SkillIndexEntry[] {
    const matched = matchIndexEntries(entries, keyword);
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
    const matches = entries.filter(
        (entry) =>
            normalizeSkillIndexKey(entry.id) === normalized ||
            normalizeSkillIndexKey(entry.name || '') === normalized
    );

    const distinctIds = [...new Set(matches.map((entry) => entry.id))];
    if (distinctIds.length > 1) {
        throw new GetSkillError(
            'AMBIGUOUS_SKILL',
            `技能名称 "${skillName}" 匹配到多个不同技能: ${distinctIds.join(', ')}。请使用完整的技能 id 重试`
        );
    }

    return matches[0] || null;
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
            timeout: Math.min(getRequestTimeoutMs(), 15_000)
        });
        // 拒绝 SPA fallback / 错误页 HTML 被当成 SKILL.md
        const head = response.body.trimStart().slice(0, 200).toLowerCase();
        if (head.startsWith('<!doctype') || head.startsWith('<html')) {
            return null;
        }
        return response.body;
    } catch {
        return null;
    }
}

/**
 * 搜索并返回分页元数据（total/page/limit/has_more），
 * 与 index 命令的 JSON 契约对称。
 */
export async function searchSkillsPage(
    keyword: string,
    options: SearchOptions = {}
): Promise<SearchPage> {
    if (!keyword || typeof keyword !== 'string' || !keyword.trim()) {
        throw new GetSkillError('INVALID_ARGS', '搜索失败: 关键词无效');
    }

    const { page = 1, limit = 20 } = options;
    const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 20;
    const safePage = Number.isFinite(page) && page > 0 ? page : 1;

    try {
        const entries = await fetchSkillsIndex();
        const matched = matchIndexEntries(entries, keyword);
        const start = (safePage - 1) * safeLimit;
        const pageItems = matched.slice(start, start + safeLimit);

        const installedByKey = new Map<string, InstalledSkillSnapshot>();
        getInstalledSkillsSnapshot().forEach((item) => {
            installedByKey.set(normalizeSkillIndexKey(item.skillName), item);
            installedByKey.set(
                normalizeSkillIndexKey(item.localSkillName),
                item
            );
        });

        const results = pageItems.map((entry) => {
            const skill = mapIndexEntryToSearchSkill(entry);
            const local =
                installedByKey.get(normalizeSkillIndexKey(entry.id)) ||
                installedByKey.get(normalizeSkillIndexKey(entry.name || '')) ||
                null;

            skill.installed = Boolean(local);
            skill.installed_version = local?.version ?? null;
            skill.suggested_action = !local
                ? 'install'
                : local.version &&
                    compareVersions(local.version, entry.version || '0') >= 0
                  ? 'skip'
                  : 'update';
            return skill;
        });

        return {
            results,
            total: matched.length,
            page: safePage,
            limit: safeLimit,
            has_more: start + pageItems.length < matched.length
        };
    } catch (error) {
        if (error instanceof GetSkillError) {
            throw error;
        }
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

export async function searchSkills(
    keyword: string,
    options: SearchOptions = {}
): Promise<SearchSkill[]> {
    const page = await searchSkillsPage(keyword, options);
    return page.results;
}
