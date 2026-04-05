import fs from 'fs';
import os from 'os';
import path from 'path';

import {
    collectSkillMarkdownFiles,
    getInstalledSkillInfo,
    normalizeCliSkillArgument,
    normalizeSkillName
} from '../lib/state';

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
        expect(
            info.skillDir.endsWith(
                path.join('.openclaw', 'skills', 'demo-tool')
            )
        ).toBe(true);
    });
});
