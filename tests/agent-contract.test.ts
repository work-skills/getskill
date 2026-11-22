import fs from 'fs';
import http from 'http';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import type { AddressInfo } from 'net';

import { parseCommandOptions, positiveIntOption } from '../lib/cli-args';
import {
    clearRuntimeOverrides,
    refreshConfig,
    setRequestTimeoutOverride,
    getRequestTimeoutMs
} from '../lib/config';
import {
    clearSkillsIndexCache,
    fetchSkillMarkdown,
    findSkillIndexEntry,
    matchIndexEntries,
    searchSkillsPage
} from '../lib/network';
import {
    downloadSkill,
    uninstallSkill,
    updateAllSkills,
    updateSkill
} from '../lib/skill-manager';
import {
    computeSkillDirHash,
    getInstalledSkillInfo,
    listLocalSkillsDetailed,
    readInstallState,
    resolveLocalSkillName,
    writeInstallState
} from '../lib/state';
import { compareVersions } from '../lib/version';
import type { SkillIndexEntry } from '../lib/types';

const originalEnv = { ...process.env };
const projectRoot = path.resolve(__dirname, '..');

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

function crc32(data: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of data) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** 构造最小 stored（method 0）zip，含真实 CRC（extractZip 会校验）。 */
function makeStoredZip(files: Record<string, string>): Buffer {
    const locals: Buffer[] = [];
    const centrals: Buffer[] = [];
    let offset = 0;

    Object.entries(files).forEach(([name, content]) => {
        const nameBuf = Buffer.from(name, 'utf8');
        const data = Buffer.from(content, 'utf8');
        const crc = crc32(data);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 8); // method 0 = stored
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(data.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        locals.push(local, nameBuf, data);

        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 10);
        central.writeUInt32LE(crc, 16);
        central.writeUInt32LE(data.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        centrals.push(central, nameBuf);

        offset += 30 + nameBuf.length + data.length;
    });

    const centralBuf = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(Object.keys(files).length, 8);
    eocd.writeUInt16LE(Object.keys(files).length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(offset, 16);

    return Buffer.concat([...locals, centralBuf, eocd]);
}

describe('strict cli argument parsing', () => {
    it('rejects unknown flags instead of silently ignoring them', () => {
        expect(() => parseCommandOptions(['search', 'pdf', '--josn'])).toThrow(
            /未知选项/
        );
        expect(() => parseCommandOptions(['-x'])).toThrow(/未知选项/);
    });

    it('rejects value flags without a value', () => {
        expect(() => parseCommandOptions(['search', 'pdf', '--limit'])).toThrow(
            /缺少值/
        );
        expect(() => parseCommandOptions(['--agent'])).toThrow(/缺少值/);
    });

    it('does not swallow a command name as a flag value', () => {
        expect(() => parseCommandOptions(['--limit', 'search', 'pdf'])).toThrow(
            /缺少值/
        );
        const parsed = parseCommandOptions(['--version', 'install', 'x']);
        expect(parsed.positionals).toEqual(['install', 'x']);
        expect(parsed.options.version).toBe(true);
    });

    it('treats --json=0/no/off as false and rejects invalid booleans', () => {
        expect(parseCommandOptions(['--json=0']).options.json).toBe(false);
        expect(parseCommandOptions(['--json=no']).options.json).toBe(false);
        expect(parseCommandOptions(['--json=1']).options.json).toBe(true);
        expect(() => parseCommandOptions(['--json=maybe'])).toThrow(/值无效/);
    });

    it('supports the -- terminator', () => {
        const { positionals, options } = parseCommandOptions([
            'search',
            '--',
            '--weird-keyword'
        ]);
        expect(positionals).toEqual(['search', '--weird-keyword']);
        expect(options.json).toBeUndefined();
    });

    it('validates numeric options strictly', () => {
        const { options } = parseCommandOptions(['search', 'pdf', '--limit=5']);
        expect(positiveIntOption(options, 'limit')).toBe(5);
        expect(() => positiveIntOption({ limit: 'abc' }, 'limit')).toThrow(
            /正整数/
        );
        expect(() => positiveIntOption({ page: '0' }, 'page')).toThrow(
            /大于 0/
        );
        expect(positiveIntOption({}, 'limit')).toBeUndefined();
    });
});

describe('semver comparison', () => {
    it('compares numerically per segment', () => {
        expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
        expect(compareVersions('1.9.0', '1.10.0')).toBe(-1);
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
        expect(compareVersions('v2.0.0', '2.0.0')).toBe(0);
        expect(compareVersions('1.0', '1.0.0')).toBe(0);
        expect(compareVersions('2.0.0', '10.0.0')).toBe(-1);
    });
});

describe('multi-token index matching', () => {
    const entries = [
        makeEntry(),
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

    it('requires every token to match (AND semantics)', () => {
        expect(
            matchIndexEntries(entries, 'pdf merge').map((e) => e.id)
        ).toEqual(['pdf-merge']);
        expect(
            matchIndexEntries(entries, 'pdf extract').map((e) => e.id)
        ).toEqual(['pdf-extract']);
        expect(matchIndexEntries(entries, 'pdf nothing')).toEqual([]);
        expect(
            matchIndexEntries(entries, '  pdf   merge  ').map((e) => e.id)
        ).toEqual(['pdf-merge']);
    });
});

describe('request timeout override', () => {
    afterEach(() => setRequestTimeoutOverride(null));

    it('applies and clears the process-level override', () => {
        setRequestTimeoutOverride(1234);
        expect(getRequestTimeoutMs()).toBe(1234);
        setRequestTimeoutOverride(null);
        expect(getRequestTimeoutMs()).toBe(60_000);
    });
});

// ---- 以下用例需要本地 HTTP 服务 ----

let server: http.Server;
let baseUrl = '';
let entries: SkillIndexEntry[] = [];
let zipHits = 0;
let serveHtmlSkillMd = false;

function useTempEnv(): string {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'getskill-contract-'));
    process.env.GETSKILL_HOME = home;
    process.env.GETSKILL_CACHE_DIR = path.join(home, 'cache');
    process.env.GETSKILL_SKILLS_DIR = path.join(home, 'skills');
    process.env.GETSKILL_BASE_URL = baseUrl;
    process.env.GETSKILL_LOG_LEVEL = 'silent';
    delete process.env.GETSKILL_AGENT;
    delete process.env.GETSKILL_STATE_FILE;
    delete process.env.GETSKILL_RESTART_CMD;
    clearRuntimeOverrides();
    refreshConfig();
    clearSkillsIndexCache();
    return home;
}

/** 异步 spawn：execFileSync 会阻塞 worker 事件循环，导致同进程 HTTP 服务无法响应。 */
function runCli(
    args: string[],
    home: string,
    envPatch: Record<string, string | undefined> = {}
): Promise<{ stdout: string; code: number }> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [require.resolve('tsx/cli'), 'main.ts', ...args],
            {
                cwd: projectRoot,
                env: {
                    ...process.env,
                    GETSKILL_HOME: home,
                    GETSKILL_CACHE_DIR: path.join(home, 'cache'),
                    GETSKILL_SKILLS_DIR: path.join(home, 'skills'),
                    GETSKILL_BASE_URL: baseUrl,
                    GETSKILL_LOG_LEVEL: 'silent',
                    ...envPatch
                },
                stdio: ['ignore', 'pipe', 'pipe']
            }
        );
        let stdout = '';
        child.stdout.on('data', (chunk) => {
            stdout += String(chunk);
        });
        child.stderr.on('data', () => {
            // 过程日志走 stderr，测试只关心 stdout 与退出码
        });
        child.on('error', reject);
        child.on('close', (code) => {
            resolve({ stdout, code: code ?? 1 });
        });
    });
}

describe('agent contract behaviors (local server)', () => {
    beforeAll(async () => {
        const zip = makeStoredZip({
            'SKILL.md': '# PDF Extract\n\nExtract text from PDF files.'
        });
        server = http.createServer((req, res) => {
            if (req.url === '/data/skills.json') {
                res.setHeader('content-type', 'application/json');
                res.end(JSON.stringify({ skills: entries }));
                return;
            }
            if (req.url === '/skills/pdf-extract.zip') {
                zipHits += 1;
                res.setHeader('content-type', 'application/zip');
                res.end(zip);
                return;
            }
            if (req.url === '/skills/pdf-extract/SKILL.md') {
                if (serveHtmlSkillMd) {
                    res.setHeader('content-type', 'text/html');
                    res.end(
                        '<!DOCTYPE html><html><body>SPA fallback</body></html>'
                    );
                    return;
                }
                res.setHeader('content-type', 'text/markdown');
                res.end('# PDF Extract\n\nExtract text from PDF files.');
                return;
            }
            res.statusCode = 404;
            res.end('not found');
        });
        await new Promise<void>((resolve) => {
            server.listen(0, '127.0.0.1', resolve);
        });
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    beforeEach(() => {
        zipHits = 0;
        serveHtmlSkillMd = false;
        entries = [makeEntry()];
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        clearRuntimeOverrides();
        refreshConfig();
    });

    it('installs under the canonical entry.id and uninstalls case-insensitively', async () => {
        const home = useTempEnv();
        const result = await downloadSkill('PDF-EXTRACT');
        expect(result.skillName).toBe('pdf-extract');
        expect(path.basename(result.files[0])).toBe('pdf-extract');
        expect(readInstallState().skills['pdf-extract']).toBeTruthy();

        const removed = await uninstallSkill('Pdf_Extract');
        expect(removed.removedInstall).toBe(true);
        expect(readInstallState().skills['pdf-extract']).toBeUndefined();

        const again = await uninstallSkill('pdf-extract');
        expect(again.removedInstall).toBe(false);
        expect(again.removedCache).toBe(false);
        expect(fs.existsSync(path.join(home, 'skills', 'pdf-extract'))).toBe(
            false
        );
    });

    it('resolveLocalSkillName finds legacy mixed-case records', () => {
        const home = useTempEnv();
        const skillsDir = path.join(home, 'skills');
        fs.mkdirSync(path.join(skillsDir, 'PDF-Toolkit'), { recursive: true });
        expect(resolveLocalSkillName('pdf-toolkit')).toBe('PDF-Toolkit');
        expect(resolveLocalSkillName('PDF_Toolkit')).toBe('PDF-Toolkit');
        expect(resolveLocalSkillName('unknown-skill')).toBe('unknown-skill');
    });

    it('never downgrades: local newer version is treated as up to date', async () => {
        useTempEnv();
        await downloadSkill('pdf-extract');
        const hitsAfterInstall = zipHits;

        entries = [makeEntry({ version: '0.9.0' })];
        clearSkillsIndexCache();

        const updated = await updateSkill('pdf-extract');
        expect(updated.upToDate).toBe(true);
        expect(updated.version).toBe('1.0.0');
        expect(zipHits).toBe(hitsAfterInstall);

        const page = await searchSkillsPage('pdf');
        expect(page.results[0].suggested_action).toBe('skip');
    });

    it('detects local modifications before overwriting and clears the flag after update', async () => {
        useTempEnv();
        const installed = await downloadSkill('pdf-extract');
        const skillMd = path.join(installed.files[0], 'SKILL.md');
        expect(getInstalledSkillInfo('pdf-extract').localModified).toBe(false);

        fs.appendFileSync(skillMd, '\nlocal edit');
        expect(getInstalledSkillInfo('pdf-extract').localModified).toBe(true);

        entries = [makeEntry({ version: '2.0.0' })];
        clearSkillsIndexCache();
        const updated = await updateSkill('pdf-extract');
        expect(updated.localModified).toBe(true);
        expect(updated.version).toBe('2.0.0');
        expect(getInstalledSkillInfo('pdf-extract').localModified).toBe(false);
    });

    it('update --all skips missing install dirs instead of resurrecting them', async () => {
        const home = useTempEnv();
        await downloadSkill('pdf-extract');
        const hitsAfterInstall = zipHits;
        fs.rmSync(path.join(home, 'skills', 'pdf-extract'), {
            recursive: true,
            force: true
        });

        const { results } = await updateAllSkills();
        expect(results).toHaveLength(1);
        expect(results[0].status).toBe('missing');
        expect(results[0].skipped).toBe(true);
        expect(zipHits).toBe(hitsAfterInstall);
        expect(fs.existsSync(path.join(home, 'skills', 'pdf-extract'))).toBe(
            false
        );
    });

    it('update --all --prune removes records that are both missing on disk and delisted', async () => {
        const home = useTempEnv();
        await downloadSkill('pdf-extract');
        fs.rmSync(path.join(home, 'skills', 'pdf-extract'), {
            recursive: true,
            force: true
        });

        // 仍在索引中：missing，不可 prune
        const kept = await updateAllSkills({ prune: true });
        expect(kept.results[0].status).toBe('missing');
        expect(kept.pruned).toEqual([]);
        expect(readInstallState().skills['pdf-extract']).toBeTruthy();

        // 索引下架后：stale，--prune 应清理
        entries = [];
        clearSkillsIndexCache();
        const { results, pruned } = await updateAllSkills({ prune: true });
        expect(results[0].status).toBe('stale');
        expect(pruned).toEqual(['pdf-extract']);
        expect(readInstallState().skills['pdf-extract']).toBeUndefined();
    });

    it('reports AMBIGUOUS_SKILL when normalization collides across ids', async () => {
        useTempEnv();
        entries = [
            makeEntry(),
            makeEntry({ id: 'PDF_Extract', name: 'PDF_Extract' })
        ];
        await expect(findSkillIndexEntry('pdf-extract')).rejects.toMatchObject({
            code: 'AMBIGUOUS_SKILL'
        });
        await expect(downloadSkill('pdf-extract')).rejects.toMatchObject({
            code: 'AMBIGUOUS_SKILL'
        });
    });

    it('rejects HTML SPA fallback as SKILL.md preview', async () => {
        useTempEnv();
        serveHtmlSkillMd = true;
        expect(await fetchSkillMarkdown('pdf-extract')).toBeNull();
        serveHtmlSkillMd = false;
        expect(await fetchSkillMarkdown('pdf-extract')).toContain(
            '# PDF Extract'
        );
    });

    it('searchSkillsPage exposes pagination metadata', async () => {
        useTempEnv();
        entries = [
            makeEntry(),
            makeEntry({ id: 'pdf-merge', name: 'pdf-merge' }),
            makeEntry({ id: 'pdf-split', name: 'pdf-split' })
        ];
        const page = await searchSkillsPage('pdf', { limit: 2, page: 1 });
        expect(page.total).toBe(3);
        expect(page.results).toHaveLength(2);
        expect(page.has_more).toBe(true);
        const last = await searchSkillsPage('pdf', { limit: 2, page: 2 });
        expect(last.results).toHaveLength(1);
        expect(last.has_more).toBe(false);
    });

    it('list merges directories with state and marks unmanaged skills', async () => {
        const home = useTempEnv();
        await downloadSkill('pdf-extract');
        fs.mkdirSync(path.join(home, 'skills', 'manual-skill'), {
            recursive: true
        });

        const details = listLocalSkillsDetailed();
        const managed = details.find((item) => item.name === 'pdf-extract');
        const manual = details.find((item) => item.name === 'manual-skill');
        expect(managed).toMatchObject({ managed: true, version: '1.0.0' });
        expect(manual).toMatchObject({ managed: false, version: null });
    });

    it('computeSkillDirHash is stable and content-sensitive', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'getskill-hash-'));
        fs.writeFileSync(path.join(dir, 'SKILL.md'), '# a');
        const first = computeSkillDirHash(dir);
        expect(computeSkillDirHash(dir)).toBe(first);
        fs.writeFileSync(path.join(dir, 'SKILL.md'), '# b');
        expect(computeSkillDirHash(dir)).not.toBe(first);
        expect(computeSkillDirHash(path.join(dir, 'missing'))).toBeNull();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('uninstall refuses unmanaged directories unless forced (S2)', async () => {
        const home = useTempEnv();
        const manualDir = path.join(home, 'skills', 'manual-skill');
        fs.mkdirSync(manualDir, { recursive: true });
        fs.writeFileSync(path.join(manualDir, 'SKILL.md'), '# manual');

        await expect(uninstallSkill('manual-skill')).rejects.toMatchObject({
            code: 'UNMANAGED_SKILL'
        });
        expect(fs.existsSync(manualDir)).toBe(true);

        const removed = await uninstallSkill('manual-skill', { force: true });
        expect(removed.removedInstall).toBe(true);
        expect(removed.managed).toBe(false);
        expect(fs.existsSync(manualDir)).toBe(false);
    });

    it('install results carry a warnings array (N2)', async () => {
        useTempEnv();
        const result = await downloadSkill('pdf-extract');
        expect(Array.isArray(result.warnings)).toBe(true);
        const again = await downloadSkill('pdf-extract');
        expect(again.upToDate).toBe(true);
        expect(Array.isArray(again.warnings)).toBe(true);
    });

    it('non-semver local version no longer blocks updates (N1)', async () => {
        useTempEnv();
        await downloadSkill('pdf-extract');

        const state = readInstallState();
        state.skills['pdf-extract'].version = 'unknown';
        writeInstallState(state);
        clearSkillsIndexCache();

        const updated = await updateSkill('pdf-extract');
        expect(updated.upToDate).toBeFalsy();
        expect(updated.version).toBe('1.0.0');
    });

    it('install/update refuse unmanaged directories unless forced (S2 install)', async () => {
        const home = useTempEnv();
        const manualDir = path.join(home, 'skills', 'pdf-extract');
        fs.mkdirSync(manualDir, { recursive: true });
        fs.writeFileSync(path.join(manualDir, 'SKILL.md'), '# manual');

        await expect(downloadSkill('pdf-extract')).rejects.toMatchObject({
            code: 'UNMANAGED_SKILL'
        });
        await expect(updateSkill('pdf-extract')).rejects.toMatchObject({
            code: 'UNMANAGED_SKILL'
        });
        expect(fs.readFileSync(path.join(manualDir, 'SKILL.md'), 'utf8')).toBe(
            '# manual'
        );

        const forced = await downloadSkill('pdf-extract', { force: true });
        expect(forced.upToDate).toBeFalsy();
        expect(readInstallState().skills['pdf-extract']).toBeTruthy();
    });

    it('update --force overwrites unmanaged directories (S2 update)', async () => {
        const home = useTempEnv();
        const manualDir = path.join(home, 'skills', 'pdf-extract');
        fs.mkdirSync(manualDir, { recursive: true });
        fs.writeFileSync(path.join(manualDir, 'SKILL.md'), '# manual');

        await expect(updateSkill('pdf-extract')).rejects.toMatchObject({
            code: 'UNMANAGED_SKILL'
        });

        const forced = await updateSkill('pdf-extract', { force: true });
        expect(forced.upToDate).toBeFalsy();
        expect(forced.version).toBe('1.0.0');
        expect(readInstallState().skills['pdf-extract']).toBeTruthy();
        expect(
            fs.readFileSync(path.join(manualDir, 'SKILL.md'), 'utf8')
        ).not.toBe('# manual');
    });
});

describe('cli json envelope (spawned process)', () => {
    beforeEach(() => {
        zipHits = 0;
        serveHtmlSkillMd = false;
        entries = [makeEntry()];
    });

    afterEach(() => {
        process.env = { ...originalEnv };
        clearRuntimeOverrides();
        refreshConfig();
    });

    afterAll(async () => {
        await new Promise((resolve) => server.close(resolve));
    });

    it('unknown command exits non-zero with INVALID_ARGS and a suggestion', async () => {
        const home = useTempEnv();
        const { stdout, code } = await runCli(['serch', 'pdf', '--json'], home);
        expect(code).toBe(1);
        const payload = JSON.parse(stdout);
        expect(payload.error.code).toBe('INVALID_ARGS');
        expect(payload.error.message).toContain('search');
    });

    it('install --dry-run enforces the target gate and writes nothing (N10)', async () => {
        const home = useTempEnv();
        const { stdout, code } = await runCli(
            ['install', 'pdf-extract', '--dry-run', '--json'],
            home,
            { GETSKILL_SKILLS_DIR: undefined, GETSKILL_AGENT: undefined }
        );
        expect(code).toBe(1);
        const payload = JSON.parse(stdout);
        expect(payload.results[0].ok).toBe(false);
        expect(payload.results[0].error.code).toBe('TARGET_NOT_CONFIGURED');
        expect(
            fs.existsSync(path.join(home, 'cache', 'skills-index.json'))
        ).toBe(false);
    });

    it('install --dry-run blocks unmanaged dirs like real install (S2)', async () => {
        const home = useTempEnv();
        const manualDir = path.join(home, 'skills', 'pdf-extract');
        fs.mkdirSync(manualDir, { recursive: true });
        fs.writeFileSync(path.join(manualDir, 'SKILL.md'), '# manual');

        const { stdout, code } = await runCli(
            ['install', 'pdf-extract', '--dry-run', '--json'],
            home
        );
        expect(code).toBe(1);
        const payload = JSON.parse(stdout);
        expect(payload.results[0].action).toBe('blocked');
        expect(payload.results[0].error.code).toBe('UNMANAGED_SKILL');
        expect(fs.readFileSync(path.join(manualDir, 'SKILL.md'), 'utf8')).toBe(
            '# manual'
        );

        const forced = await runCli(
            ['install', 'pdf-extract', '--dry-run', '--force', '--json'],
            home
        );
        expect(forced.code).toBe(0);
        expect(JSON.parse(forced.stdout).results[0].ok).toBe(true);
    });

    it('update --dry-run/--force mirror unmanaged protection (S2 update)', async () => {
        const home = useTempEnv();
        const manualDir = path.join(home, 'skills', 'pdf-extract');
        fs.mkdirSync(manualDir, { recursive: true });
        fs.writeFileSync(path.join(manualDir, 'SKILL.md'), '# manual');

        const plan = await runCli(
            ['update', 'pdf-extract', '--dry-run', '--json'],
            home
        );
        expect(plan.code).toBe(1);
        expect(JSON.parse(plan.stdout).results[0]).toMatchObject({
            ok: false,
            action: 'blocked',
            error: { code: 'UNMANAGED_SKILL' }
        });

        const forcedPlan = await runCli(
            ['update', 'pdf-extract', '--dry-run', '--force', '--json'],
            home
        );
        expect(forcedPlan.code).toBe(0);
        expect(JSON.parse(forcedPlan.stdout).results[0].ok).toBe(true);
        expect(fs.readFileSync(path.join(manualDir, 'SKILL.md'), 'utf8')).toBe(
            '# manual'
        );

        const refused = await runCli(['update', 'pdf-extract', '--json'], home);
        expect(refused.code).toBe(1);
        expect(JSON.parse(refused.stdout).error.code).toBe('UNMANAGED_SKILL');

        const forced = await runCli(
            ['update', 'pdf-extract', '--force', '--json'],
            home
        );
        expect(forced.code).toBe(0);
        expect(JSON.parse(forced.stdout).status).toBe('updated');
        expect(
            fs.readFileSync(path.join(manualDir, 'SKILL.md'), 'utf8')
        ).not.toBe('# manual');
    });

    it('clean refuses when cache dir equals skills dir (H8)', async () => {
        const home = useTempEnv();
        const skills = path.join(home, 'skills');
        const manualDir = path.join(skills, 'manual-skill');
        fs.mkdirSync(manualDir, { recursive: true });
        fs.writeFileSync(path.join(manualDir, 'SKILL.md'), '# manual');

        const { stdout, code } = await runCli(['clean', '--json'], home, {
            GETSKILL_CACHE_DIR: skills
        });
        expect(code).toBe(1);
        expect(JSON.parse(stdout).error.code).toBe('INVALID_ARGS');
        expect(fs.existsSync(path.join(manualDir, 'SKILL.md'))).toBe(true);
    });

    it('unknown flag exits non-zero with INVALID_ARGS', async () => {
        const home = useTempEnv();
        const { stdout, code } = await runCli(
            ['search', 'pdf', '--josn'],
            home
        );
        expect(code).toBe(1);
        expect(stdout.trim()).toBe('');
        const asJson = await runCli(
            ['search', 'pdf', '--json', '--bogus'],
            home
        );
        expect(asJson.code).toBe(1);
        expect(JSON.parse(asJson.stdout).error.code).toBe('INVALID_ARGS');
    });

    it('aliases normalize to install in the error envelope', async () => {
        const home = useTempEnv();
        const { stdout, code } = await runCli(['get', '--json'], home);
        expect(code).toBe(1);
        const payload = JSON.parse(stdout);
        expect(payload.command).toBe('install');
        expect(payload.error.code).toBe('INVALID_ARGS');
    });

    it('supports --json for version/path/status/config/clean', async () => {
        const home = useTempEnv();
        const version = await runCli(['--version', '--json'], home);
        expect(version.code).toBe(0);
        expect(JSON.parse(version.stdout).command).toBe('version');

        const pathResult = await runCli(['path', '--json'], home);
        expect(JSON.parse(pathResult.stdout).skills_dir).toContain('skills');

        const status = await runCli(['status', '--json'], home);
        const statusPayload = JSON.parse(status.stdout);
        expect(statusPayload.command).toBe('status');
        expect(statusPayload.explicit_target).toBe(true);
        expect(statusPayload.state_locked).toBe(false);

        const config = await runCli(['config', 'get', '--json'], home);
        expect(JSON.parse(config.stdout).config).toHaveLength(4);

        const clean = await runCli(['clean', '--json', '--keep-index'], home);
        expect(JSON.parse(clean.stdout).kept_index).toBe(true);
    });

    it('config validation errors go through the envelope', async () => {
        const home = useTempEnv();
        const { stdout, code } = await runCli(
            ['config', 'set', 'agent', 'not-an-agent', '--json'],
            home
        );
        expect(code).toBe(1);
        const payload = JSON.parse(stdout);
        expect(payload.command).toBe('config');
        expect(payload.error.code).toBe('INVALID_ARGS');
    });

    it('uninstall of a missing skill reports not_installed', async () => {
        const home = useTempEnv();
        const { stdout, code } = await runCli(
            ['uninstall', 'no-such-skill', '--json'],
            home
        );
        expect(code).toBe(0);
        const payload = JSON.parse(stdout);
        expect(payload.status).toBe('not_installed');
        expect(payload.removed_install).toBe(false);
    });

    it('install error envelope echoes the skill name', async () => {
        const home = useTempEnv();
        const { stdout, code } = await runCli(
            ['install', 'missing-skill', '--json'],
            home
        );
        expect(code).toBe(1);
        const payload = JSON.parse(stdout);
        expect(payload.command).toBe('install');
        expect(payload.skill).toBe('missing-skill');
        expect(payload.error.code).toBe('SKILL_NOT_FOUND');
    });

    it('install --dry-run returns a plan without downloading', async () => {
        const home = useTempEnv();
        const { stdout, code } = await runCli(
            ['install', 'pdf-extract', '--dry-run', '--json'],
            home
        );
        expect(code).toBe(0);
        const payload = JSON.parse(stdout);
        expect(payload.dry_run).toBe(true);
        expect(payload.results[0]).toMatchObject({
            skill: 'pdf-extract',
            action: 'install',
            exists: false
        });
        expect(fs.existsSync(path.join(home, 'skills', 'pdf-extract'))).toBe(
            false
        );
        expect(zipHits).toBe(0);
    });

    it('SKILL_NOT_FOUND carries did-you-mean suggestions', async () => {
        const home = useTempEnv();
        const { stdout, code } = await runCli(
            ['install', 'pdf-extrac', '--json'],
            home
        );
        expect(code).toBe(1);
        const payload = JSON.parse(stdout);
        expect(payload.error.code).toBe('SKILL_NOT_FOUND');
        expect(payload.error.suggestions).toContain('pdf-extract');
    });

    it('uninstall --dry-run blocks unmanaged dirs and --force removes them', async () => {
        const home = useTempEnv();
        const manualDir = path.join(home, 'skills', 'manual-skill');
        fs.mkdirSync(manualDir, { recursive: true });

        const blocked = await runCli(
            ['uninstall', 'manual-skill', '--dry-run', '--json'],
            home
        );
        expect(blocked.code).toBe(1);
        const blockedPayload = JSON.parse(blocked.stdout);
        expect(blockedPayload.results[0]).toMatchObject({
            ok: false,
            action: 'blocked',
            managed: false
        });
        expect(blockedPayload.results[0].error.code).toBe('UNMANAGED_SKILL');
        expect(fs.existsSync(manualDir)).toBe(true);

        const forced = await runCli(
            ['uninstall', 'manual-skill', '--force', '--json'],
            home
        );
        expect(forced.code).toBe(0);
        const forcedPayload = JSON.parse(forced.stdout);
        expect(forcedPayload.status).toBe('removed');
        expect(forcedPayload.managed).toBe(false);
        expect(fs.existsSync(manualDir)).toBe(false);
    });

    it('status exposes cli_version and lock details', async () => {
        const home = useTempEnv();
        const { stdout, code } = await runCli(['status', '--json'], home);
        expect(code).toBe(0);
        const payload = JSON.parse(stdout);
        expect(payload.cli_version).toMatch(/^\d+\.\d+\.\d+/);
        expect(payload.state_locked).toBe(false);
        expect(payload.lock_pid).toBeNull();
        expect(payload.lock_stale).toBe(false);
    });

    it('clean --dry-run lists paths without deleting', async () => {
        const home = useTempEnv();
        const cacheDir = path.join(home, 'cache');
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(path.join(cacheDir, 'leftover.bin'), 'x');

        const { stdout, code } = await runCli(
            ['clean', '--dry-run', '--json'],
            home
        );
        expect(code).toBe(0);
        const payload = JSON.parse(stdout);
        expect(payload.dry_run).toBe(true);
        expect(payload.would_remove).toContain(cacheDir);
        expect(fs.existsSync(path.join(cacheDir, 'leftover.bin'))).toBe(true);
    });

    it('install envelope includes warnings and index meta', async () => {
        const home = useTempEnv();
        const { stdout, code } = await runCli(
            ['install', 'pdf-extract', '--json'],
            home
        );
        expect(code).toBe(0);
        const payload = JSON.parse(stdout);
        expect(payload.status).toBe('installed');
        expect(Array.isArray(payload.warnings)).toBe(true);
        // 首次下载为 remote；安装流程内二次查找命中刚写入的缓存时为 cache
        expect(['remote', 'cache']).toContain(payload.index.source);
        expect(payload.index.stale).toBe(false);
    });

    it('help --json exposes exit_codes and the new error codes', async () => {
        const home = useTempEnv();
        const { stdout, code } = await runCli(['--help', '--json'], home);
        expect(code).toBe(0);
        const payload = JSON.parse(stdout);
        expect(payload.exit_codes['1']).toBeTruthy();
        expect(payload.error_codes).toContain('UNMANAGED_SKILL');
        expect(payload.error_codes).toContain('EXTRACT_ERROR');
        expect(payload.error_codes).toContain('PACKAGE_INVALID');
        expect(payload.env_vars).toContain('GETSKILL_ALLOW_CROSS_ORIGIN');
    });
});
