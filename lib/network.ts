import http from 'http';
import https from 'https';

import { getBaseUrl, REQUEST_TIMEOUT_MS } from './config';
import logger from './logger';
import type {
    RepositoryCandidate,
    RequestOptions,
    RequestResponse,
    SearchApiItem,
    SearchApiPayload,
    SearchOptions,
    SearchSkill
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
            if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0)) {
                const locationHeader = res.headers.location;
                const redirectUrl = Array.isArray(locationHeader)
                    ? locationHeader[0]
                    : locationHeader;

                if (!redirectUrl) {
                    reject(
                        new Error(
                            `Redirect location header missing (${res.statusCode})`
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
                    (res.statusCode ?? 0) >= 200 &&
                    (res.statusCode ?? 0) < 300
                ) {
                    resolve({
                        statusCode: res.statusCode ?? 0,
                        headers: res.headers,
                        body: data
                    });
                    return;
                }

                reject(
                    new Error(
                        `Request failed with status code ${res.statusCode}: ${data.substring(0, 200)}`
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

function mapRepositoryCandidate(
    item: RepositoryCandidate | SearchApiItem
): RepositoryCandidate | null {
    if ('repository' in item && item.repository) {
        return item.repository;
    }

    return item as RepositoryCandidate;
}

export async function repositoryHasSkillFile(
    repoFullName: string
): Promise<boolean> {
    if (
        !repoFullName ||
        typeof repoFullName !== 'string' ||
        !repoFullName.includes('/')
    ) {
        return false;
    }

    const segments = repoFullName.split('/');
    const owner = segments.shift();
    const repo = segments.join('/');

    if (!owner || !repo) {
        return false;
    }

    const url = `${getBaseUrl()}/api/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/SKILL.md`;

    try {
        await request(url, { timeout: Math.min(REQUEST_TIMEOUT_MS, 15_000) });
        return true;
    } catch {
        return false;
    }
}

export async function transformSearchResults(
    result: SearchApiPayload,
    hasSkillFile: (
        repoFullName: string
    ) => Promise<boolean> = repositoryHasSkillFile
): Promise<SearchSkill[]> {
    if (!result || result.ok === false || !Array.isArray(result.data)) {
        return [];
    }

    const filteredCandidates = result.data
        .map(mapRepositoryCandidate)
        .filter((item): item is RepositoryCandidate =>
            Boolean(item && (item.full_name || item.name))
        )
        .filter(
            (item) =>
                !item.private &&
                !item.empty &&
                !item.archived &&
                !item.template &&
                !item.fork
        );

    const skillChecks = await Promise.all(
        filteredCandidates.map(async (item) => {
            const repoFullName = item.full_name || item.name || '';
            const hasSkill = await hasSkillFile(repoFullName);
            if (!hasSkill) {
                return null;
            }

            return {
                name: item.full_name || item.name || '',
                full_name: item.full_name || '',
                description: item.description || '',
                html_url: item.html_url || '',
                git_url:
                    item.clone_url ||
                    (item.html_url ? `${item.html_url}.git` : ''),
                clone_url: item.clone_url || ''
            } satisfies SearchSkill;
        })
    );

    return skillChecks.filter((item): item is SearchSkill => Boolean(item));
}

export async function searchSkills(
    keyword: string,
    options: SearchOptions = {}
): Promise<SearchSkill[]> {
    if (!keyword || typeof keyword !== 'string') {
        logger.error('搜索失败: 关键词无效');
        return [];
    }

    const { sort = 'updated', order = 'desc', page = 1, limit = 20 } = options;

    const fixedSearchParams = [
        'private=false',
        'is_private=false',
        'archived=false',
        'template=false'
    ].join('&');

    const url = `${getBaseUrl()}/api/v1/repos/search?q=${encodeURIComponent(keyword)}&${fixedSearchParams}&sort=${sort}&order=${order}&page=${page}&limit=${limit}`;

    try {
        const response = await request(url, { timeout: REQUEST_TIMEOUT_MS });
        if (!response.body || response.body.trim() === '') {
            logger.warn('搜索警告: 服务器返回空响应');
            return [];
        }

        let parsed: SearchApiPayload;
        try {
            parsed = JSON.parse(response.body) as SearchApiPayload;
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            logger.error('搜索失败: JSON 解析错误', message);
            logger.debug('响应内容:', response.body.substring(0, 200));
            return [];
        }

        return transformSearchResults(parsed);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (message.includes('Host not found')) {
            logger.error(
                '搜索失败: 无法连接到服务器，请检查网络或 API 地址配置'
            );
        } else if (message.includes('timeout')) {
            logger.error('搜索失败: 请求超时，请稍后重试');
        } else if (message.includes('Connection refused')) {
            logger.error('搜索失败: 服务器拒绝连接，请检查 API 地址是否正确');
        } else if (message.includes('status code')) {
            logger.error('搜索失败: 服务器返回错误', message);
        } else {
            logger.error('搜索失败:', message);
        }

        return [];
    }
}
