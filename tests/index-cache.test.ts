import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import type { AddressInfo } from 'net';

import {
    clearRuntimeOverrides,
    refreshConfig,
    getStateFilePath
} from '../lib/config';
import {
    clearSkillsIndexCache,
    fetchSkillMarkdown,
    fetchSkillsIndex,
    getSkillsIndexCacheFilePath,
    getSkillsIndexMeta,
    searchSkills
} from '../lib/network';
import {
    downloadSkill,
    uninstallSkill,
    updateSkill
} from '../lib/skill-manager';
import { readInstallState, updateInstallState } from '../lib/state';
import type { SkillIndexEntry } from '../lib/types';

const originalEnv = { ...process.env };

let server: http.Server;
let baseUrl = '';
let indexHits = 0;
let zipHits = 0;
let failIndex = false;
let entries: SkillIndexEntry[] = [];
/** manifest 模拟：on=正常提供哈希；off=404（旧式源回退 TTL）；fail=500（网络不可达）。 */
let manifestMode: 'on' | 'off' | 'fail' = 'on';
let manifestHits = 0;

function currentHash(): string {
    return crypto
        .createHash('sha1')
        .update(JSON.stringify(entries))
        .digest('hex')
        .slice(0, 12);
}

function makeEntry(overrides: Partial<SkillIndexEntry> = {}): SkillIndexEntry {
    return {
        id: 'pdf-extract',
        name: 'pdf-extract',
        description: 'Extract text from PDF files',
        version: '1.0.0',
        file: 'skills/pdf-extract.zip',
        ...overrides
    };
}

function useTempEnv(): string {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'getskill-index-'));

    process.env.GETSKILL_HOME = home;
    process.env.GETSKILL_CACHE_DIR = path.join(home, 'cache');
    process.env.GETSKILL_SKILLS_DIR = path.join(home, 'skills');
    process.env.GETSKILL_BASE_URL = baseUrl;
    delete process.env.GETSKILL_AGENT;
    delete process.env.GETSKILL_STATE_FILE;
    delete process.env.GETSKILL_RESTART_CMD;
    clearRuntimeOverrides();
    refreshConfig();
    clearSkillsIndexCache();

    return home;
}

function writeInstalledRecord(home: string, version: string): void {
    const skillsDir = path.join(home, 'skills');
    const installDir = path.join(skillsDir, 'pdf-extract');
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'SKILL.md'), '# skill');
    fs.writeFileSync(
        path.join(home, 'state.json'),
        JSON.stringify({
            skills: {
                'pdf-extract': {
                    inputSkillName: 'pdf-extract',
                    localSkillName: 'pdf-extract',
                    installDir,
                    skillsDir,
                    version,
                    repoPath: path.join(home, 'cache', 'pdf-extract')
                }
            }
        }),
        'utf8'
    );
}

function expireIndexCache(): void {
    const cacheFile = getSkillsIndexCacheFilePath();
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    cached.fetchedAt = new Date(
        Date.now() - 2 * 24 * 60 * 60 * 1000
    ).toISOString();
    fs.writeFileSync(cacheFile, JSON.stringify(cached), 'utf8');
}
describe('skills index local cache', () => {
    beforeAll(async () => {
        server = http.createServer((req, res) => {
            if (req.url === '/manifest.json') {
                manifestHits += 1;
                if (manifestMode === 'off') {
                    res.statusCode = 404;
                    res.end('not found');
                    return;
                }
                if (manifestMode === 'fail') {
                    res.statusCode = 500;
                    res.end('manifest unavailable');
                    return;
                }
                res.setHeader('content-type', 'application/json');
                res.end(
                    JSON.stringify({
                        hash: currentHash(),
                        skills: `/v/${currentHash()}/skills.json`
                    })
                );
                return;
            }

            if (
                req.url === '/data/skills.json' ||
                /^\/v\/[0-9a-f]+\/skills\.json$/.test(req.url || '')
            ) {
                indexHits += 1;
                if (failIndex) {
                    res.statusCode = 500;
                    res.end('index unavailable');
                    return;
                }
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ skills: entries }));
                return;
            }

            if (req.url === '/skills/pdf-extract/SKILL.md') {
                res.setHeader('content-type', 'text/markdown');
                res.end('# PDF Extract\n\nExtract text from PDF files.');
                return;
            }

            zipHits += 1;
            res.statusCode = 404;
            res.end('not found');
        });

        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
        await new Promise((resolve) => server.close(resolve));
    });

    beforeEach(() => {
        indexHits = 0;
        zipHits = 0;
        failIndex = false;
        manifestMode = 'on';
        manifestHits = 0;
        entries = [makeEntry()];
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        clearRuntimeOverrides();
        refreshConfig();
    });

    it('downloads once and reuses the cache while the manifest hash matches', async () => {
        useTempEnv();

        const first = await fetchSkillsIndex();
        expect(first.map((entry) => entry.id)).toEqual(['pdf-extract']);
        expect(indexHits).toBe(1);
        expect(fs.existsSync(getSkillsIndexCacheFilePath())).toBe(true);

        const second = await fetchSkillsIndex();
        expect(second.map((entry) => entry.id)).toEqual(['pdf-extract']);
        expect(indexHits).toBe(1);
        expect(manifestHits).toBe(2);
        expect(getSkillsIndexMeta()).toMatchObject({
            source: 'cache',
            stale: false,
            hash: currentHash()
        });
    });

    it('re-downloads when the manifest hash changes', async () => {
        useTempEnv();

        await fetchSkillsIndex();
        entries = [makeEntry({ version: '2.0.0' })];

        const refreshed = await fetchSkillsIndex();
        expect(indexHits).toBe(2);
        expect(refreshed[0].version).toBe('2.0.0');
        expect(getSkillsIndexMeta().hash).toBe(currentHash());
    });

    it('keeps an old cache when the hash matches (no TTL expiry)', async () => {
        useTempEnv();

        await fetchSkillsIndex();
        expireIndexCache();

        const result = await fetchSkillsIndex();
        expect(indexHits).toBe(1);
        expect(result.map((entry) => entry.id)).toEqual(['pdf-extract']);
        expect(getSkillsIndexMeta()).toMatchObject({
            source: 'cache',
            stale: false
        });
    });

    it('forceRefresh does not re-download when the hash matches', async () => {
        useTempEnv();

        await fetchSkillsIndex();
        expect(indexHits).toBe(1);

        await fetchSkillsIndex({ forceRefresh: true });
        expect(indexHits).toBe(1);
        expect(getSkillsIndexMeta().source).toBe('cache');
    });

    it('forceRefresh bypasses a fresh cache once per process on legacy sources', async () => {
        useTempEnv();
        manifestMode = 'off';

        await fetchSkillsIndex();
        expect(indexHits).toBe(1);

        // 重置进程内标记，但保留一份新鲜缓存
        clearSkillsIndexCache();
        fs.mkdirSync(path.dirname(getSkillsIndexCacheFilePath()), {
            recursive: true
        });
        fs.writeFileSync(
            getSkillsIndexCacheFilePath(),
            JSON.stringify({
                baseUrl,
                fetchedAt: new Date().toISOString(),
                skills: [makeEntry()]
            }),
            'utf8'
        );

        await fetchSkillsIndex();
        expect(indexHits).toBe(1);

        await fetchSkillsIndex({ forceRefresh: true });
        expect(indexHits).toBe(2);

        // 本进程已下载过，后续 forceRefresh 不再重复下载
        await fetchSkillsIndex({ forceRefresh: true });
        expect(indexHits).toBe(2);
    });

    it('legacy sources without a manifest still use the 1-day TTL', async () => {
        useTempEnv();
        manifestMode = 'off';

        await fetchSkillsIndex();
        await fetchSkillsIndex();
        expect(indexHits).toBe(1);

        expireIndexCache();
        entries = [makeEntry({ version: '2.0.0' })];

        const refreshed = await fetchSkillsIndex();
        expect(indexHits).toBe(2);
        expect(refreshed[0].version).toBe('2.0.0');
        expect(getSkillsIndexMeta().hash).toBeNull();
    });

    it('falls back to the stale cache when the download fails', async () => {
        useTempEnv();

        await fetchSkillsIndex();
        entries = [makeEntry({ version: '2.0.0' })];
        failIndex = true;

        const result = await fetchSkillsIndex();
        expect(indexHits).toBe(2);
        expect(result.map((entry) => entry.id)).toEqual(['pdf-extract']);
        expect(getSkillsIndexMeta()).toMatchObject({
            source: 'stale-cache',
            stale: true
        });
    });

    it('uses the cache without downloading when the manifest is unreachable', async () => {
        useTempEnv();

        await fetchSkillsIndex();
        manifestMode = 'fail';

        const result = await fetchSkillsIndex();
        expect(indexHits).toBe(1);
        expect(result.map((entry) => entry.id)).toEqual(['pdf-extract']);
        expect(getSkillsIndexMeta()).toMatchObject({
            source: 'stale-cache',
            stale: true
        });
    });

    it('ignores a cache written for a different base url', async () => {
        useTempEnv();

        await fetchSkillsIndex();
        const cacheFile = getSkillsIndexCacheFilePath();
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        cached.baseUrl = 'https://other.example.com';
        fs.writeFileSync(cacheFile, JSON.stringify(cached), 'utf8');

        await fetchSkillsIndex();
        expect(indexHits).toBe(2);
    });
    it('annotates search results with the local install state', async () => {
        const home = useTempEnv();
        writeInstalledRecord(home, '1.0.0');

        let results = await searchSkills('pdf');
        expect(results[0]).toMatchObject({
            installed: true,
            installed_version: '1.0.0',
            suggested_action: 'skip'
        });

        entries = [makeEntry({ version: '2.0.0' })];
        clearSkillsIndexCache();
        results = await searchSkills('pdf');
        expect(results[0]).toMatchObject({
            installed: true,
            installed_version: '1.0.0',
            suggested_action: 'update'
        });

        entries = [
            makeEntry(),
            makeEntry({
                id: 'pdf-merge',
                name: 'pdf-merge',
                file: 'skills/pdf-merge.zip'
            })
        ];
        clearSkillsIndexCache();
        results = await searchSkills('pdf');
        const merge = results.find((item) => item.full_name === 'pdf-merge');
        expect(merge).toMatchObject({
            installed: false,
            installed_version: null,
            suggested_action: 'install'
        });
    });

    it('search never downloads or installs any skill', async () => {
        const home = useTempEnv();

        const results = await searchSkills('pdf');

        expect(results.length).toBe(1);
        expect(results[0].suggested_action).toBe('install');
        expect(indexHits).toBe(1);
        // 搜索只返回候选信息：不下载 ZIP、不创建技能目录
        expect(zipHits).toBe(0);
        expect(fs.existsSync(path.join(home, 'skills'))).toBe(false);
    });
    it('returns no results for an unknown keyword and keeps the full index readable locally', async () => {
        useTempEnv();

        const results = await searchSkills('no-such-skill-xyz');

        expect(results).toEqual([]);
        expect(zipHits).toBe(0);
        // 无结果时索引仍已落盘，Agent 可直接读取该文件自行挑选技能
        const cacheFile = getSkillsIndexCacheFilePath();
        expect(fs.existsSync(cacheFile)).toBe(true);
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        expect(cached.skills).toHaveLength(1);
        expect(cached.skills[0].name).toBe('pdf-extract');
        expect(cached.skills[0].description).toBeTruthy();
    });
    it('install/update skip the download when the same version is installed', async () => {
        const home = useTempEnv();
        writeInstalledRecord(home, '1.0.0');

        const installed = await downloadSkill('pdf-extract');
        expect(installed.upToDate).toBe(true);
        expect(installed.version).toBe('1.0.0');
        expect(zipHits).toBe(0);

        const updated = await updateSkill('pdf-extract');
        expect(updated.upToDate).toBe(true);
        expect(zipHits).toBe(0);
    });

    it('install proceeds when the installed version differs', async () => {
        const home = useTempEnv();
        writeInstalledRecord(home, '0.9.0');

        // 服务器对 zip 返回 404，证明 install 未跳过而是尝试了下载
        await expect(downloadSkill('pdf-extract')).rejects.toThrow(/404/);
        expect(zipHits).toBe(1);
    });

    it('search throws NETWORK_ERROR when the index is unavailable and no cache exists', async () => {
        useTempEnv();
        failIndex = true;

        await expect(searchSkills('pdf')).rejects.toMatchObject({
            code: 'NETWORK_ERROR'
        });
    });

    it('search still works offline via stale cache instead of throwing', async () => {
        useTempEnv();
        await fetchSkillsIndex();
        manifestMode = 'fail';
        failIndex = true;

        const results = await searchSkills('pdf');
        expect(results).toHaveLength(1);
        expect(indexHits).toBe(1);
    });

    it('search throws INVALID_ARGS for an empty keyword', async () => {
        useTempEnv();

        await expect(searchSkills('')).rejects.toMatchObject({
            code: 'INVALID_ARGS'
        });
    });

    it('install reports SKILL_NOT_FOUND and VERSION_NOT_AVAILABLE codes', async () => {
        useTempEnv();

        await expect(downloadSkill('missing-skill')).rejects.toMatchObject({
            code: 'SKILL_NOT_FOUND'
        });
        await expect(
            downloadSkill('pdf-extract', { version: '9.9.9' })
        ).rejects.toMatchObject({ code: 'VERSION_NOT_AVAILABLE' });
    });

    it('fetchSkillMarkdown previews remote SKILL.md and tolerates missing files', async () => {
        useTempEnv();

        const markdown = await fetchSkillMarkdown('pdf-extract');
        expect(markdown).toContain('# PDF Extract');

        // 未知技能 → null（不抛异常）
        expect(await fetchSkillMarkdown('missing-skill')).toBeNull();

        // 索引中存在但站点未提供 SKILL.md → null
        entries = [
            makeEntry(),
            makeEntry({
                id: 'pdf-merge',
                name: 'pdf-merge',
                file: 'skills/pdf-merge.zip'
            })
        ];
        clearSkillsIndexCache();
        expect(await fetchSkillMarkdown('pdf-merge')).toBeNull();
    });

    it('search honors limit and page options', async () => {
        useTempEnv();
        entries = [
            makeEntry(),
            makeEntry({
                id: 'pdf-merge',
                name: 'pdf-merge',
                file: 'skills/pdf-merge.zip'
            }),
            makeEntry({
                id: 'pdf-split',
                name: 'pdf-split',
                file: 'skills/pdf-split.zip'
            })
        ];

        const firstPage = await searchSkills('pdf', { limit: 2, page: 1 });
        expect(firstPage.map((item) => item.full_name)).toEqual([
            'pdf-extract',
            'pdf-merge'
        ]);

        const secondPage = await searchSkills('pdf', { limit: 2, page: 2 });
        expect(secondPage.map((item) => item.full_name)).toEqual(['pdf-split']);
    });

    it('uninstall refuses to run when the skills dir is only auto-detected', async () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'getskill-gate-'));
        process.env.GETSKILL_HOME = home;
        process.env.GETSKILL_BASE_URL = baseUrl;
        delete process.env.GETSKILL_SKILLS_DIR;
        delete process.env.GETSKILL_AGENT;
        clearRuntimeOverrides();
        refreshConfig();

        await expect(uninstallSkill('pdf-extract')).rejects.toMatchObject({
            code: 'TARGET_NOT_CONFIGURED'
        });
    });

    it('reclaims a stale state lock and removes the lock after writing', async () => {
        const home = useTempEnv();
        const lockPath = `${getStateFilePath()}.lock`;
        fs.writeFileSync(lockPath, '99999');
        const staleTime = new Date(Date.now() - 60_000);
        fs.utimesSync(lockPath, staleTime, staleTime);

        await updateInstallState(
            'skill-a',
            path.join(home, 'cache', 'skill-a'),
            path.join(home, 'skills', 'skill-a'),
            'install',
            undefined,
            '1.0.0'
        );

        expect(readInstallState().skills['skill-a']).toBeTruthy();
        expect(fs.existsSync(lockPath)).toBe(false);
    });

    it('reports STATE_LOCKED when another process holds a fresh lock', async () => {
        const home = useTempEnv();
        process.env.GETSKILL_STATE_LOCK_TIMEOUT_MS = '200';
        const lockPath = `${getStateFilePath()}.lock`;
        fs.writeFileSync(lockPath, '99999');

        try {
            await expect(
                updateInstallState(
                    'skill-b',
                    path.join(home, 'cache', 'skill-b'),
                    path.join(home, 'skills', 'skill-b'),
                    'install',
                    undefined,
                    '1.0.0'
                )
            ).rejects.toMatchObject({ code: 'STATE_LOCKED' });
        } finally {
            fs.rmSync(lockPath, { force: true });
            delete process.env.GETSKILL_STATE_LOCK_TIMEOUT_MS;
        }
    });
});
