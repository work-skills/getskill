import fs from 'fs';
import os from 'os';
import path from 'path';

import {
    getSkillsCacheDirectory,
    getSkillsDirectory,
    refreshConfig
} from '../lib/config';
import {
    collectSkillMarkdownFiles,
    getInstalledSkillInfo,
    listInstalledSkillNames,
    normalizeCliSkillArgument,
    normalizeSkillName,
    pruneInstallState,
    readInstallState,
    removeInstalledSkill,
    writeInstallState
} from '../lib/state';
import type { SkillStateRecord } from '../lib/types';

function makeRecord(
    skillName: string,
    installDir: string,
    skillsDir?: string
): SkillStateRecord {
    const record: SkillStateRecord = {
        inputSkillName: skillName,
        localSkillName: skillName,
        remoteSkillPath: `skills/${skillName}`,
        repoPath: installDir,
        installDir,
        lastAction: 'install',
        installedAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        gitCommitHash: null,
        version: '1.0.0'
    };

    if (skillsDir) {
        record.skillsDir = skillsDir;
    }

    return record;
}

describe('state helpers', () => {
    it('normalizes skill names for local directories', () => {
        expect(normalizeSkillName('skills/demo-tool')).toBe('demo-tool');
        expect(normalizeSkillName('skills/team/demo-tool')).toBe(
            'team_demo-tool'
        );
    });

    it('rejects git urls in cli arguments', () => {
        expect(() =>
            normalizeCliSkillArgument('https://example.com/repo.git')
        ).toThrow(/技能名称/);
        expect(() => normalizeCliSkillArgument('demo-tool.git')).toThrow(
            /Git URL/
        );
    });

    it('collects markdown skills while ignoring README files', () => {
        const tempRoot = fs.mkdtempSync(
            path.join(os.tmpdir(), 'getskill-test-')
        );
        const nestedDir = path.join(tempRoot, 'examples');
        fs.mkdirSync(nestedDir, { recursive: true });

        fs.writeFileSync(path.join(tempRoot, 'SKILL.md'), '# skill');
        fs.writeFileSync(path.join(tempRoot, 'README.md'), '# readme');
        fs.writeFileSync(path.join(nestedDir, 'guide.md'), '# guide');

        const results = collectSkillMarkdownFiles(tempRoot).sort();

        expect(results).toEqual(
            ['SKILL.md', path.join('examples', 'guide.md')].sort()
        );
    });

    it('builds an inspection view for local skills', () => {
        const info = getInstalledSkillInfo('skills/demo-tool');

        expect(info.skillName).toBe('skills/demo-tool');
        expect(info.localSkillName).toBe('demo-tool');
        expect(typeof info.installed).toBe('boolean');
        expect(typeof info.cached).toBe('boolean');
        expect(info.skillDir).toBe(
            path.join(getSkillsDirectory(), 'demo-tool')
        );
        expect(info.cacheDir).toBe(
            path.join(getSkillsCacheDirectory(), 'demo-tool')
        );
        expect(info.skillsDir).toBe(getSkillsDirectory());
        expect(info.agent.length).toBeGreaterThan(0);
    });

    it('only lists skills recorded for the current skills directory', () => {
        const tempHome = fs.mkdtempSync(
            path.join(os.tmpdir(), 'getskill-state-')
        );
        const stateFile = path.join(tempHome, 'state.json');
        const currentSkillsDir = path.join(tempHome, 'current-agent', 'skills');
        const otherSkillsDir = path.join(tempHome, 'other-agent', 'skills');

        fs.mkdirSync(currentSkillsDir, { recursive: true });
        fs.writeFileSync(
            stateFile,
            JSON.stringify({
                skills: {
                    'kept-skill': makeRecord(
                        'kept-skill',
                        path.join(currentSkillsDir, 'kept-skill'),
                        currentSkillsDir
                    ),
                    'stale-skill': makeRecord(
                        'stale-skill',
                        path.join(otherSkillsDir, 'stale-skill'),
                        otherSkillsDir
                    ),
                    'legacy-skill': makeRecord(
                        'legacy-skill',
                        path.join(otherSkillsDir, 'legacy-skill')
                    )
                }
            }),
            'utf8'
        );

        process.env.GETSKILL_STATE_FILE = stateFile;
        process.env.GETSKILL_SKILLS_DIR = currentSkillsDir;
        refreshConfig();

        try {
            expect(listInstalledSkillNames()).toEqual(['kept-skill']);
            expect(getInstalledSkillInfo('stale-skill').installed).toBe(false);
            expect(pruneInstallState()).toEqual([
                'stale-skill',
                'legacy-skill'
            ]);
            expect(readInstallState().skills['stale-skill']).toBeUndefined();
            expect(readInstallState().skills['legacy-skill']).toBeUndefined();
            expect(listInstalledSkillNames()).toEqual(['kept-skill']);
        } finally {
            delete process.env.GETSKILL_STATE_FILE;
            delete process.env.GETSKILL_SKILLS_DIR;
            refreshConfig();
            fs.rmSync(tempHome, { recursive: true, force: true });
        }
    });
});

describe('uninstall safety (S1/S2/S3)', () => {
    function useTempEnv(): {
        home: string;
        skillsDir: string;
        stateFile: string;
    } {
        const home = fs.mkdtempSync(
            path.join(os.tmpdir(), 'getskill-uninstall-')
        );
        const skillsDir = path.join(home, 'skills');
        const stateFile = path.join(home, 'state.json');
        fs.mkdirSync(skillsDir, { recursive: true });
        process.env.GETSKILL_STATE_FILE = stateFile;
        process.env.GETSKILL_SKILLS_DIR = skillsDir;
        process.env.GETSKILL_CACHE_DIR = path.join(home, 'cache');
        process.env.GETSKILL_LOG_LEVEL = 'silent';
        refreshConfig();
        return { home, skillsDir, stateFile };
    }

    function restoreEnv(home: string): void {
        delete process.env.GETSKILL_STATE_FILE;
        delete process.env.GETSKILL_SKILLS_DIR;
        delete process.env.GETSKILL_CACHE_DIR;
        delete process.env.GETSKILL_LOG_LEVEL;
        refreshConfig();
        fs.rmSync(home, { recursive: true, force: true });
    }

    it('refuses to delete unmanaged directories unless forced (S2)', () => {
        const { home, skillsDir } = useTempEnv();
        try {
            const manualDir = path.join(skillsDir, 'manual-skill');
            fs.mkdirSync(manualDir, { recursive: true });
            fs.writeFileSync(path.join(manualDir, 'SKILL.md'), '# manual');

            expect(() => removeInstalledSkill('manual-skill')).toThrow(
                /不由 getskill 管理/
            );
            expect(fs.existsSync(manualDir)).toBe(true);

            const removed = removeInstalledSkill('manual-skill', {
                force: true
            });
            expect(removed.removedInstall).toBe(true);
            expect(removed.managed).toBe(false);
            expect(fs.existsSync(manualDir)).toBe(false);
        } finally {
            restoreEnv(home);
        }
    });

    it('removes managed skills and reports managed=true', () => {
        const { home, skillsDir, stateFile } = useTempEnv();
        try {
            const skillDir = path.join(skillsDir, 'managed-skill');
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# managed');
            writeInstallState({
                skills: {
                    'managed-skill': makeRecord(
                        'managed-skill',
                        skillDir,
                        skillsDir
                    )
                }
            });

            const removed = removeInstalledSkill('managed-skill');
            expect(removed.removedInstall).toBe(true);
            expect(removed.managed).toBe(true);
            expect(fs.existsSync(skillDir)).toBe(false);
            expect(fs.existsSync(stateFile)).toBe(true);
        } finally {
            restoreEnv(home);
        }
    });
    it('never deletes repoPath outside managed roots (S3)', () => {
        const { home, skillsDir } = useTempEnv();
        const outside = fs.mkdtempSync(
            path.join(os.tmpdir(), 'getskill-outside-')
        );
        try {
            const skillDir = path.join(skillsDir, 'tampered-skill');
            fs.mkdirSync(skillDir, { recursive: true });
            fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# skill');
            const precious = path.join(outside, 'precious');
            fs.mkdirSync(precious, { recursive: true });
            fs.writeFileSync(path.join(precious, 'data.txt'), 'keep me');

            const record = makeRecord('tampered-skill', skillDir, skillsDir);
            record.repoPath = precious;
            writeInstallState({ skills: { 'tampered-skill': record } });

            const removed = removeInstalledSkill('tampered-skill');
            expect(removed.removedInstall).toBe(true);
            expect(fs.existsSync(precious)).toBe(true);
            expect(fs.existsSync(path.join(precious, 'data.txt'))).toBe(true);
        } finally {
            restoreEnv(home);
            fs.rmSync(outside, { recursive: true, force: true });
        }
    });

    it('never deletes repoPath equal to the home or cache root (S3 strict)', () => {
        const { home, skillsDir } = useTempEnv();
        try {
            fs.writeFileSync(path.join(home, 'config.json'), '{}');
            const cacheRoot = getSkillsCacheDirectory();
            fs.mkdirSync(cacheRoot, { recursive: true });
            fs.writeFileSync(path.join(cacheRoot, 'marker.txt'), 'keep');

            const skillDir = path.join(skillsDir, 'root-tamper');
            fs.mkdirSync(skillDir, { recursive: true });
            const record = makeRecord('root-tamper', skillDir, skillsDir);
            record.repoPath = home;
            writeInstallState({ skills: { 'root-tamper': record } });

            const removed = removeInstalledSkill('root-tamper');
            expect(removed.removedInstall).toBe(true);
            expect(fs.existsSync(path.join(home, 'config.json'))).toBe(true);

            const skillDir2 = path.join(skillsDir, 'cache-tamper');
            fs.mkdirSync(skillDir2, { recursive: true });
            const record2 = makeRecord('cache-tamper', skillDir2, skillsDir);
            record2.repoPath = cacheRoot;
            writeInstallState({ skills: { 'cache-tamper': record2 } });

            const removed2 = removeInstalledSkill('cache-tamper');
            expect(removed2.removedInstall).toBe(true);
            expect(fs.existsSync(path.join(cacheRoot, 'marker.txt'))).toBe(
                true
            );
        } finally {
            restoreEnv(home);
        }
    });

    it('rejects traversal names before touching the filesystem (S1)', () => {
        const { home } = useTempEnv();
        try {
            expect(() => removeInstalledSkill('..')).toThrow(/不安全/);
            expect(() => getInstalledSkillInfo('..')).toThrow(/不安全/);
        } finally {
            restoreEnv(home);
        }
    });
});

describe('state file robustness (H3)', () => {
    it('backs up a corrupt state file and continues with empty state', () => {
        const home = fs.mkdtempSync(
            path.join(os.tmpdir(), 'getskill-corrupt-')
        );
        const stateFile = path.join(home, 'state.json');
        fs.writeFileSync(stateFile, '{ this is not valid json', 'utf8');
        process.env.GETSKILL_STATE_FILE = stateFile;
        process.env.GETSKILL_LOG_LEVEL = 'silent';
        refreshConfig();
        try {
            expect(readInstallState()).toEqual({ skills: {} });
            const backups = fs
                .readdirSync(home)
                .filter((name) => name.startsWith('state.json.corrupt-'));
            expect(backups.length).toBe(1);
        } finally {
            delete process.env.GETSKILL_STATE_FILE;
            delete process.env.GETSKILL_LOG_LEVEL;
            refreshConfig();
            fs.rmSync(home, { recursive: true, force: true });
        }
    });

    it('writes atomically without leaving temp files', () => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'getskill-atomic-'));
        const stateFile = path.join(home, 'state.json');
        process.env.GETSKILL_STATE_FILE = stateFile;
        refreshConfig();
        try {
            writeInstallState({ skills: {} });
            writeInstallState({ skills: {} });
            const leftovers = fs
                .readdirSync(home)
                .filter((name) => name.includes('.tmp-'));
            expect(leftovers).toEqual([]);
            expect(JSON.parse(fs.readFileSync(stateFile, 'utf8'))).toEqual({
                skills: {}
            });
        } finally {
            delete process.env.GETSKILL_STATE_FILE;
            refreshConfig();
            fs.rmSync(home, { recursive: true, force: true });
        }
    });
});
