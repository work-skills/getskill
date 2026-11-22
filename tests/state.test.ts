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
    readInstallState
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
