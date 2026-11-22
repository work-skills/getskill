import fs from 'fs';
import os from 'os';
import path from 'path';

import {
    AGENT_PRESETS,
    applyRuntimeOverrides,
    assertExplicitSkillsDir,
    clearRuntimeOverrides,
    detectAgentName,
    getAgentPreset,
    getConfigFilePath,
    getPresetSkillsDir,
    listAgents,
    normalizeConfigKey,
    readConfigFile,
    refreshConfig,
    resolveConfig,
    setConfigValue,
    unsetConfigValue
} from '../lib/config';
import {
    downloadSkill,
    updateAllSkills,
    updateSkill
} from '../lib/skill-manager';

const originalEnv = { ...process.env };

function useTempHome(): string {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'getskill-config-'));

    process.env.GETSKILL_HOME = tempHome;
    delete process.env.GETSKILL_AGENT;
    delete process.env.GETSKILL_SKILLS_DIR;
    delete process.env.GETSKILL_CACHE_DIR;
    delete process.env.GETSKILL_BASE_URL;
    delete process.env.GETSKILL_STATE_FILE;
    delete process.env.GETSKILL_RESTART_CMD;
    clearRuntimeOverrides();

    return tempHome;
}

function presetSkillsDir(name: string): string {
    const preset = getAgentPreset(name);
    if (!preset) {
        throw new Error(`unknown preset in test: ${name}`);
    }
    return getPresetSkillsDir(preset);
}

describe('getskill config', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        clearRuntimeOverrides();
    });

    it('normalizes config key aliases', () => {
        expect(normalizeConfigKey('skills_dir')).toBe('skillsDir');
        expect(normalizeConfigKey('BASE-URL')).toBe('baseUrl');
        expect(() => normalizeConfigKey('nope')).toThrow(/未知配置项/);
    });

    it('persists config values to the config file', () => {
        const tempHome = useTempHome();

        setConfigValue('agent', 'cursor');
        setConfigValue('base-url', 'https://custom.example.com/');

        expect(fs.existsSync(path.join(tempHome, 'config.json'))).toBe(true);
        expect(readConfigFile()).toEqual({
            agent: 'cursor',
            baseUrl: 'https://custom.example.com'
        });

        const config = resolveConfig();
        expect(getConfigFilePath()).toBe(path.join(tempHome, 'config.json'));
        expect(config.agent).toBe('cursor');
        expect(config.baseUrl).toBe('https://custom.example.com');
        expect(config.skillsDir).toBe(presetSkillsDir('cursor'));
        expect(config.sources.agent).toBe('file');
        expect(config.stateFile).toBe(path.join(tempHome, 'state.json'));
        expect(config.cacheDir).toBe(path.join(tempHome, 'cache'));
    });

    it('restores auto detection after unset', () => {
        useTempHome();

        setConfigValue('agent', 'codex');
        expect(resolveConfig().agent).toBe('codex');

        unsetConfigValue('agent');
        expect(readConfigFile().agent).toBeUndefined();
        expect(resolveConfig().skillsDir).toBe(
            presetSkillsDir(detectAgentName())
        );
    });

    it('rejects invalid agent and url values', () => {
        useTempHome();

        expect(() => setConfigValue('agent', 'not-an-agent')).toThrow(
            /未知 agent/
        );
        expect(() => setConfigValue('base-url', 'ftp://example.com')).toThrow(
            /http/
        );
        expect(() => setConfigValue('agent', '  ')).toThrow(/不能为空/);
        expect(fs.existsSync(getConfigFilePath())).toBe(false);
    });

    it('applies precedence cli > env > file > default', () => {
        useTempHome();

        setConfigValue('agent', 'cursor');
        expect(resolveConfig().agent).toBe('cursor');

        process.env.GETSKILL_AGENT = 'codex';
        refreshConfig();
        expect(resolveConfig().agent).toBe('codex');
        expect(resolveConfig().sources.agent).toBe('env');

        applyRuntimeOverrides({ agent: 'gemini' });
        expect(resolveConfig().agent).toBe('gemini');
        expect(resolveConfig().sources.agent).toBe('cli');
        expect(resolveConfig().skillsDir).toBe(presetSkillsDir('gemini'));
    });

    it('supports arbitrary agent directories', () => {
        const tempHome = useTempHome();
        const customDir = path.join(tempHome, 'my-agent', 'skills');

        process.env.GETSKILL_SKILLS_DIR = customDir;
        process.env.GETSKILL_CACHE_DIR = path.join(tempHome, 'my-cache');
        refreshConfig();

        const config = resolveConfig();
        expect(config.skillsDir).toBe(customDir);
        expect(config.cacheDir).toBe(path.join(tempHome, 'my-cache'));
        expect(config.agent).toBe('custom');
        expect(config.agentLabel).toBe('自定义目录');
    });

    it('expands ~ in configured directories', () => {
        useTempHome();

        setConfigValue('skills-dir', '~/custom-agent/skills');
        expect(resolveConfig().skillsDir).toBe(
            path.resolve(os.homedir(), 'custom-agent', 'skills')
        );
    });

    it('detects the agent from previous install records', () => {
        const tempHome = useTempHome();
        const openclawDir = presetSkillsDir('openclaw');

        fs.mkdirSync(tempHome, { recursive: true });
        fs.writeFileSync(
            path.join(tempHome, 'state.json'),
            JSON.stringify({
                skills: {
                    demo: {
                        inputSkillName: 'demo',
                        localSkillName: 'demo',
                        installDir: path.join(openclawDir, 'demo')
                    }
                }
            }),
            'utf8'
        );

        expect(detectAgentName()).toBe('openclaw');
        expect(resolveConfig().agent).toBe('openclaw');
        expect(resolveConfig().skillsDir).toBe(openclawDir);
        expect(resolveConfig().restartCommand).toBe('openclaw gateway restart');
    });

    it('exposes agent presets for listing', () => {
        useTempHome();

        const agents = listAgents();
        expect(agents.length).toBe(AGENT_PRESETS.length);
        expect(agents.filter((agent) => agent.active).length).toBe(1);
        expect(agents.some((agent) => agent.name === 'openclaw')).toBe(true);
        expect(agents.some((agent) => agent.name === 'claude')).toBe(true);
    });
});

describe('explicit skills-dir gate', () => {
    afterEach(() => {
        process.env = { ...originalEnv };
        clearRuntimeOverrides();
    });

    it('rejects writes when the skills directory only comes from auto detection', () => {
        useTempHome();

        expect(resolveConfig().sources.skillsDir).toBe('detect');
        expect(() => assertExplicitSkillsDir()).toThrow(/自动探测结果/);
        expect(() => assertExplicitSkillsDir()).toThrow(/显式指定/);
    });

    it('rejects install/update before any network access when auto-detected', async () => {
        useTempHome();

        await expect(downloadSkill('demo')).rejects.toThrow(/显式指定/);
        await expect(updateSkill('demo')).rejects.toThrow(/显式指定/);
        await expect(updateAllSkills()).rejects.toThrow(/显式指定/);
    });

    it('allows writes after an explicit agent is persisted', () => {
        useTempHome();

        setConfigValue('agent', 'codex');
        const config = assertExplicitSkillsDir();
        expect(config.skillsDir).toBe(presetSkillsDir('codex'));
        expect(config.sources.skillsDir).toBe('file');
    });

    it('allows writes with env or cli skills-dir overrides', () => {
        const tempHome = useTempHome();

        process.env.GETSKILL_SKILLS_DIR = path.join(tempHome, 'env-skills');
        refreshConfig();
        expect(assertExplicitSkillsDir().skillsDir).toBe(
            path.join(tempHome, 'env-skills')
        );

        delete process.env.GETSKILL_SKILLS_DIR;
        refreshConfig();
        expect(() => assertExplicitSkillsDir()).toThrow(/显式指定/);

        applyRuntimeOverrides({
            skillsDir: path.join(tempHome, 'cli-skills')
        });
        expect(assertExplicitSkillsDir().skillsDir).toBe(
            path.join(tempHome, 'cli-skills')
        );
    });

    it('keeps the gate closed after unsetting explicit values', () => {
        useTempHome();

        setConfigValue('skills-dir', '~/custom-agent/skills');
        expect(() => assertExplicitSkillsDir()).not.toThrow();

        unsetConfigValue('skills-dir');
        expect(resolveConfig().sources.skillsDir).toBe('detect');
        expect(() => assertExplicitSkillsDir()).toThrow(/显式指定/);
    });
});
