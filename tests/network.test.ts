import fs from 'fs';
import os from 'os';
import path from 'path';

import { getBaseUrl, refreshConfig } from '../lib/config';
import {
    assertPackageUrlAllowed,
    filterIndexByKeyword,
    getSkillPackageUrl,
    getSkillsIndexUrl,
    mapIndexEntryToSearchSkill,
    normalizeSkillIndexKey,
    readCachedIndexEntries
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
