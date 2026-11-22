import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import type { AddressInfo } from 'net';

import { getBaseUrl, refreshConfig } from '../lib/config';
import {
    assertPackageUrlAllowed,
    downloadFile,
    filterIndexByKeyword,
    getSkillPackageUrl,
    getSkillsIndexUrl,
    mapIndexEntryToSearchSkill,
    normalizeSkillIndexKey,
    readCachedIndexEntries,
    request
} from '../lib/network';
import type { SkillIndexEntry } from '../lib/types';

function makeEntry(overrides: Partial<SkillIndexEntry> = {}): SkillIndexEntry {
    return {
        id: 'pdf-extract',
        name: 'pdf-extract',
        description: 'Extract text from PDF files',
        category: 'documents',
        tags: ['pdf'],
        version: '1.0.0',
        file: 'skills/pdf-extract.zip',
        ...overrides
    };
}

describe('static skills index helpers', () => {
    it('normalizes skill keys for index lookup', () => {
        expect(normalizeSkillIndexKey('skills/pdf-extract')).toBe(
            'pdf-extract'
        );
        expect(normalizeSkillIndexKey('  PDF_Extract ')).toBe('pdf-extract');
        expect(normalizeSkillIndexKey('team/demo-tool')).toBe('team-demo-tool');
        expect(normalizeSkillIndexKey('')).toBe('');
    });

    it('builds index and package urls from the base url', () => {
        const baseUrl = getBaseUrl();
        expect(getSkillsIndexUrl()).toBe(`${baseUrl}/data/skills.json`);

        const entry = makeEntry();
        expect(getSkillPackageUrl(entry)).toBe(
            `${baseUrl}/skills/pdf-extract.zip`
        );
        expect(getSkillPackageUrl(makeEntry({ file: '' }))).toBe(
            `${baseUrl}/skills/pdf-extract.zip`
        );
    });

    it('filters index entries by keyword and paginates', () => {
        const entries = [
            makeEntry({ id: 'pdf-extract' }),
            makeEntry({
                id: 'pdf-merge',
                name: 'pdf-merge',
                description: 'Merge PDF documents'
            }),
            makeEntry({
                id: 'excel-helper',
                name: 'excel-helper',
                description: 'Work with spreadsheets',
                tags: ['xlsx']
            })
        ];

        expect(filterIndexByKeyword(entries, 'pdf').map((e) => e.id)).toEqual([
            'pdf-extract',
            'pdf-merge'
        ]);
        expect(filterIndexByKeyword(entries, 'xlsx').map((e) => e.id)).toEqual([
            'excel-helper'
        ]);
        expect(
            filterIndexByKeyword(entries, 'pdf', 1, 2).map((e) => e.id)
        ).toEqual(['pdf-merge']);
        expect(filterIndexByKeyword(entries, 'nothing')).toEqual([]);
    });

    it('maps index entries to search results', () => {
        const skill = mapIndexEntryToSearchSkill(makeEntry());

        expect(skill).toMatchObject({
            name: 'pdf-extract',
            full_name: 'pdf-extract',
            description: 'Extract text from PDF files',
            version: '1.0.0',
            category: 'documents',
            author: '',
            download_url: `${getBaseUrl()}/skills/pdf-extract.zip`
        });
        expect(skill.download_url).toBe(skill.git_url);
        expect(skill.clone_url).toBe(skill.download_url);
    });
});

describe('package url policy (H6)', () => {
    const originalBaseUrl = process.env.GETSKILL_BASE_URL;
    const originalAllow = process.env.GETSKILL_ALLOW_CROSS_ORIGIN;

    beforeEach(() => {
        process.env.GETSKILL_BASE_URL = 'https://index.example.com';
        delete process.env.GETSKILL_ALLOW_CROSS_ORIGIN;
        refreshConfig();
    });

    afterEach(() => {
        if (originalBaseUrl === undefined) {
            delete process.env.GETSKILL_BASE_URL;
        } else {
            process.env.GETSKILL_BASE_URL = originalBaseUrl;
        }
        if (originalAllow === undefined) {
            delete process.env.GETSKILL_ALLOW_CROSS_ORIGIN;
        } else {
            process.env.GETSKILL_ALLOW_CROSS_ORIGIN = originalAllow;
        }
        refreshConfig();
    });

    it('allows same-origin package urls', () => {
        expect(() =>
            assertPackageUrlAllowed('https://index.example.com/skills/a.zip')
        ).not.toThrow();
    });

    it('rejects cross-origin package urls by default', () => {
        expect(() =>
            assertPackageUrlAllowed('https://evil.example.org/a.zip')
        ).toThrow(/跨域/);
    });

    it('allows cross-origin when GETSKILL_ALLOW_CROSS_ORIGIN=1', () => {
        process.env.GETSKILL_ALLOW_CROSS_ORIGIN = '1';
        expect(() =>
            assertPackageUrlAllowed('https://cdn.example.org/a.zip')
        ).not.toThrow();
    });

    it('rejects invalid package urls', () => {
        expect(() => assertPackageUrlAllowed('not a url')).toThrow(/无效/);
    });
});

describe('readCachedIndexEntries', () => {
    it('returns null when no index cache exists', () => {
        const home = fs.mkdtempSync(
            path.join(os.tmpdir(), 'getskill-index-peek-')
        );
        const originalHome = process.env.GETSKILL_HOME;
        process.env.GETSKILL_HOME = home;
        refreshConfig();
        try {
            expect(readCachedIndexEntries()).toBeNull();
        } finally {
            if (originalHome === undefined) {
                delete process.env.GETSKILL_HOME;
            } else {
                process.env.GETSKILL_HOME = originalHome;
            }
            refreshConfig();
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});

describe('transport hardening (N9/H7)', () => {
    const savedBaseUrl = process.env.GETSKILL_BASE_URL;
    const savedAllowCrossOrigin = process.env.GETSKILL_ALLOW_CROSS_ORIGIN;
    let indexServer: http.Server;
    let evilServer: http.Server;
    let base = '';
    let evilBase = '';
    const utf8Body = JSON.stringify({ note: '技能索引中文描述' });

    beforeAll(async () => {
        evilServer = http.createServer((_req, res) => {
            res.end('EVIL-CROSS-ORIGIN-CONTENT');
        });
        await new Promise<void>((resolve) => {
            evilServer.listen(0, '127.0.0.1', resolve);
        });
        evilBase = `http://127.0.0.1:${(evilServer.address() as AddressInfo).port}`;

        indexServer = http.createServer((req, res) => {
            if (req.url === '/data/skills.json') {
                const buf = Buffer.from(utf8Body, 'utf8');
                // 在多字节字符的续字节处切分，强制 UTF-8 跨 chunk
                let split = -1;
                for (let i = 1; i < buf.length; i += 1) {
                    if ((buf[i] & 0xc0) === 0x80) {
                        split = i;
                        break;
                    }
                }
                res.setHeader('content-type', 'application/json');
                res.write(buf.subarray(0, split));
                setTimeout(() => res.end(buf.subarray(split)), 20);
                return;
            }
            if (req.url === '/skills/redirect.zip') {
                res.statusCode = 302;
                res.setHeader('location', `${evilBase}/evil.zip`);
                res.end();
                return;
            }
            res.statusCode = 404;
            res.end('not found');
        });
        await new Promise<void>((resolve) => {
            indexServer.listen(0, '127.0.0.1', resolve);
        });
        base = `http://127.0.0.1:${(indexServer.address() as AddressInfo).port}`;
        process.env.GETSKILL_BASE_URL = base;
        delete process.env.GETSKILL_ALLOW_CROSS_ORIGIN;
        refreshConfig();
    });

    afterAll(async () => {
        await new Promise((resolve) => indexServer.close(resolve));
        await new Promise((resolve) => evilServer.close(resolve));
        if (savedBaseUrl === undefined) {
            delete process.env.GETSKILL_BASE_URL;
        } else {
            process.env.GETSKILL_BASE_URL = savedBaseUrl;
        }
        if (savedAllowCrossOrigin === undefined) {
            delete process.env.GETSKILL_ALLOW_CROSS_ORIGIN;
        } else {
            process.env.GETSKILL_ALLOW_CROSS_ORIGIN = savedAllowCrossOrigin;
        }
        refreshConfig();
    });

    it('decodes multi-byte utf-8 across chunk boundaries (N9)', async () => {
        const resp = await request(`${base}/data/skills.json`);
        expect(resp.body).toBe(utf8Body);
        expect(resp.body).not.toContain('\uFFFD');
    });

    it('refuses cross-origin redirects for downloads (H7)', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getskill-redir-'));
        const dest = path.join(dir, 'pkg.zip');
        try {
            await expect(
                downloadFile(`${base}/skills/redirect.zip`, dest)
            ).rejects.toThrow(/cross-origin/i);
            expect(fs.existsSync(dest)).toBe(false);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    it('allows cross-origin redirects with explicit opt-in', async () => {
        process.env.GETSKILL_ALLOW_CROSS_ORIGIN = '1';
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getskill-redir-'));
        const dest = path.join(dir, 'pkg.zip');
        try {
            await downloadFile(`${base}/skills/redirect.zip`, dest);
            expect(fs.readFileSync(dest, 'utf8')).toBe(
                'EVIL-CROSS-ORIGIN-CONTENT'
            );
        } finally {
            delete process.env.GETSKILL_ALLOW_CROSS_ORIGIN;
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
