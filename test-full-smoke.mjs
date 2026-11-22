#!/usr/bin/env node
/**
 * 全功能真实 CLI 冒烟测试（发布前验收）。
 * 用法: node test-full-smoke.mjs [技能名]（默认 ads-report，需为站点上体积较小的真实技能）
 * 依赖构建产物 dist/main.js，访问真实站点 getskill.work；
 * 全程使用临时 HOME/技能目录/缓存目录，不触碰用户配置。
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(root, 'dist', 'main.js');
const pkg = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
);
const SKILL = process.argv[2] || 'ads-report';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'getskill-smoke-full-'));
const emptyHome = path.join(tmpRoot, 'userprofile');
const home = path.join(tmpRoot, 'home');
const skillsDir = path.join(tmpRoot, 'skills');
const cacheDir = path.join(tmpRoot, 'cache');
fs.mkdirSync(emptyHome, { recursive: true });

function baseEnv(extra = {}) {
    const env = { ...process.env };
    Object.keys(env)
        .filter((key) => key.startsWith('GETSKILL_'))
        .forEach((key) => delete env[key]);
    // 隔离 Agent 自动识别（os.homedir 在 Windows 读 USERPROFILE）
    env.HOME = emptyHome;
    env.USERPROFILE = emptyHome;
    env.GETSKILL_HOME = home;
    env.GETSKILL_CACHE_DIR = cacheDir;
    env.GETSKILL_LOG_LEVEL = 'silent';
    return { ...env, ...extra };
}

const mainEnv = baseEnv({ GETSKILL_SKILLS_DIR: skillsDir });
const gateEnv = baseEnv();

function run(args, env = mainEnv) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [cliPath, ...args], {
            env,
            windowsHide: true
        });
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`超时(90s): getskill ${args.join(' ')}`));
        }, 90000);
        child.stdout.on('data', (chunk) => (stdout += chunk));
        child.stderr.on('data', (chunk) => (stderr += chunk));
        child.on('error', reject);
        child.on('close', (code) => {
            clearTimeout(timer);
            let json = null;
            if (args.includes('--json')) {
                try {
                    json = JSON.parse(stdout);
                } catch {
                    reject(
                        new Error(
                            `stdout 不是合法 JSON: getskill ${args.join(' ')}\n${stdout.slice(0, 500)}`
                        )
                    );
                    return;
                }
            }
            resolve({ code, stdout, stderr, json });
        });
    });
}

let passed = 0;
const failures = [];
async function t(name, fn) {
    try {
        await fn();
        passed += 1;
        console.log(`  ok  ${name}`);
    } catch (error) {
        failures.push({ name, message: error.message });
        console.log(`FAIL  ${name}\n      ${error.message}`);
    }
}
function assert(cond, message) {
    if (!cond) {
        throw new Error(message);
    }
}
function eq(actual, expected, label) {
    assert(
        actual === expected,
        `${label}: 期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`
    );
}
async function main() {
    console.log(`冒烟目标技能: ${SKILL}，临时目录: ${tmpRoot}\n`);

    console.log('[A] 基础 / 参数解析 / 错误信封');
    await t('--version --json', async () => {
        const r = await run(['--version', '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.version, pkg.version, 'version');
    });
    await t('-v 纯文本', async () => {
        const r = await run(['-v']);
        eq(r.code, 0, 'exit');
        eq(r.stdout.trim(), pkg.version, 'version');
    });
    await t('--help --json 机器可读命令表', async () => {
        const r = await run(['--help', '--json']);
        eq(r.code, 0, 'exit');
        assert(r.json.commands.length >= 14, 'commands 数量不足');
        assert(
            r.json.error_codes.includes('AMBIGUOUS_SKILL'),
            'error_codes 缺 AMBIGUOUS_SKILL'
        );
    });
    await t('无参数输出帮助且 exit 0', async () => {
        const r = await run([]);
        eq(r.code, 0, 'exit');
        assert(r.stdout.includes('用法'), '帮助文本缺失');
    });
    await t('仅 --json 无命令 → INVALID_ARGS exit 1', async () => {
        const r = await run(['--json']);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'INVALID_ARGS', 'code');
    });
    await t('未知命令 serch → 建议 search + exit 1', async () => {
        const r = await run(['serch', 'pdf', '--json']);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'INVALID_ARGS', 'code');
        assert(r.json.error.message.includes('search'), '缺少建议');
    });
    await t(
        '未知选项 --bogus → INVALID_ARGS（解析失败仍走 JSON）',
        async () => {
            const r = await run(['search', 'pdf', '--bogus', '--json']);
            eq(r.code, 1, 'exit');
            eq(r.json.error.code, 'INVALID_ARGS', 'code');
        }
    );
    await t('非法数值 --limit abc → INVALID_ARGS', async () => {
        const r = await run(['search', 'pdf', '--limit', 'abc', '--json']);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'INVALID_ARGS', 'code');
    });
    await t('search 缺关键词 → INVALID_ARGS', async () => {
        const r = await run(['search', '--json']);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'INVALID_ARGS', 'code');
    });
    await t('search 多余位置参数 → INVALID_ARGS', async () => {
        const r = await run(['search', 'pdf', 'merge', '--json']);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'INVALID_ARGS', 'code');
    });
    await t('install Git URL → INVALID_ARGS', async () => {
        const r = await run([
            'install',
            'https://github.com/x/y.git',
            '--json'
        ]);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'INVALID_ARGS', 'code');
    });

    console.log('\n[B] search / index / show（真实站点）');
    let page1Names = [];
    let topCategory = null;
    await t('search --brief --limit 3：分页元数据 + 剔除 URL', async () => {
        const r = await run([
            'search',
            'pdf',
            '--json',
            '--brief',
            '--limit',
            '3'
        ]);
        eq(r.code, 0, 'exit');
        assert(r.json.total > 3, `total 异常: ${r.json.total}`);
        eq(r.json.count, 3, 'count');
        eq(r.json.page, 1, 'page');
        eq(r.json.has_more, true, 'has_more');
        assert(r.json.index && r.json.index.fetched_at, 'index 元数据缺失');
        r.json.results.forEach((item) => {
            assert(!('download_url' in item), 'brief 未剔除 download_url');
            assert(!('git_url' in item), 'brief 未剔除 git_url');
            assert(
                typeof item.suggested_action === 'string',
                'suggested_action 缺失'
            );
        });
        page1Names = r.json.results.map((item) => item.full_name);
    });
    await t('search --page 2 与第 1 页不重叠', async () => {
        const r = await run([
            'search',
            'pdf',
            '--json',
            '--limit',
            '3',
            '--page',
            '2'
        ]);
        eq(r.code, 0, 'exit');
        eq(r.json.page, 2, 'page');
        const names = r.json.results.map((item) => item.full_name);
        assert(
            names.every((name) => !page1Names.includes(name)),
            '分页结果重叠'
        );
    });
    await t('多词 AND 搜索 "pdf merge"', async () => {
        const r = await run(['search', 'pdf merge', '--json']);
        eq(r.code, 0, 'exit');
        r.json.results.forEach((item) => {
            const haystack =
                `${item.full_name} ${item.description} ${item.category}`.toLowerCase();
            assert(
                haystack.includes('pdf') && haystack.includes('merge'),
                `AND 语义失效: ${item.full_name}`
            );
        });
    });
    await t('无结果搜索 → count 0 + hint', async () => {
        const r = await run(['search', 'zzz-no-such-skill-xyz', '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.count, 0, 'count');
        assert(r.json.hint, 'hint 缺失');
    });
    await t('index --categories：mode/category_count', async () => {
        const r = await run(['index', '--categories', '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.mode, 'categories', 'mode');
        eq(r.json.category_count, r.json.categories.length, 'category_count');
        assert(r.json.total > 0, 'total 为 0');
        topCategory = r.json.categories[0];
    });
    await t('index --category 分页', async () => {
        const r = await run([
            'index',
            '--category',
            topCategory.category,
            '--json',
            '--limit',
            '2'
        ]);
        eq(r.code, 0, 'exit');
        eq(r.json.mode, 'list', 'mode');
        eq(r.json.total, topCategory.count, 'total');
        assert(r.json.count <= 2, 'count 超限');
    });
    await t('index 不存在的分类 → count 0 + hint', async () => {
        const r = await run(['index', '--category', '不存在分类xyz', '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.count, 0, 'count');
        assert(r.json.hint, 'hint 缺失');
    });
    await t('show 远端 SKILL.md', async () => {
        const r = await run(['show', SKILL, '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.skill, SKILL, 'skill');
        assert(
            r.json.source === 'remote' || r.json.source === 'local',
            `source 异常: ${r.json.source}`
        );
        assert(
            typeof r.json.skill_md === 'string' && r.json.skill_md.length > 0,
            'skill_md 为空'
        );
        assert(!r.json.skill_md.includes('<!DOCTYPE'), '返回了 HTML fallback');
    });
    await t('show 不存在技能 → SKILL_NOT_FOUND + skill 回显', async () => {
        const r = await run(['show', 'no-such-skill-xyz', '--json']);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'SKILL_NOT_FOUND', 'code');
        eq(r.json.skill, 'no-such-skill-xyz', 'skill 回显');
    });
    await t('show 多余位置参数 → INVALID_ARGS', async () => {
        const r = await run(['show', SKILL, 'extra', '--json']);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'INVALID_ARGS', 'code');
    });

    console.log('\n[C] 安装门禁 / install 生命周期');
    await t('未显式指定目标 → TARGET_NOT_CONFIGURED', async () => {
        const r = await run(['install', SKILL, '--json'], gateEnv);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'TARGET_NOT_CONFIGURED', 'code');
    });
    await t('install --dry-run 只读预演', async () => {
        const r = await run(['install', SKILL, '--dry-run', '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.dry_run, true, 'dry_run');
        eq(r.json.results[0].action, 'install', 'action');
        assert(
            !fs.existsSync(path.join(skillsDir, SKILL)),
            'dry-run 写入了目录'
        );
    });
    let installedVersion = null;
    await t('install 成功 + 激活信号', async () => {
        const r = await run(['install', SKILL, '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.status, 'installed', 'status');
        eq(r.json.skill, SKILL, 'skill');
        assert(r.json.version, 'version 缺失');
        assert(fs.existsSync(r.json.skill_md_path), 'skill_md_path 不存在');
        assert(r.json.next_step, 'next_step 缺失');
        assert(r.json.index && r.json.index.fetched_at, 'index 元数据缺失');
        installedVersion = r.json.version;
    });
    await t('重复 install → skipped 不降级', async () => {
        const r = await run(['install', SKILL, '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.status, 'skipped', 'status');
        eq(r.json.up_to_date, true, 'up_to_date');
    });
    await t('大小写不敏感 install → 规范名 skipped', async () => {
        const r = await run(['install', SKILL.toUpperCase(), '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.status, 'skipped', 'status');
        eq(r.json.skill, SKILL, '规范名');
    });
    await t('install -V 0.0.1 → VERSION_NOT_AVAILABLE', async () => {
        const r = await run(['install', SKILL, '-V', '0.0.1', '--json']);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'VERSION_NOT_AVAILABLE', 'code');
        eq(r.json.skill, SKILL, 'skill 回显');
    });
    await t('install 不存在技能 → SKILL_NOT_FOUND', async () => {
        const r = await run(['install', 'no-such-skill-xyz', '--json']);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'SKILL_NOT_FOUND', 'code');
        eq(r.json.skill, 'no-such-skill-xyz', 'skill 回显');
    });
    await t('批量 install 部分失败 → exit 1 + 计数', async () => {
        const r = await run(['install', SKILL, 'no-such-skill-xyz', '--json']);
        eq(r.code, 1, 'exit');
        eq(r.json.total, 2, 'total');
        eq(r.json.succeeded, 1, 'succeeded');
        eq(r.json.failed, 1, 'failed');
        eq(r.json.results[1].error.code, 'SKILL_NOT_FOUND', '逐项错误码');
    });
    await t('批量 install + --version → INVALID_ARGS', async () => {
        const r = await run([
            'install',
            SKILL,
            'other-skill',
            '--version',
            '1.0.0',
            '--json'
        ]);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'INVALID_ARGS', 'code');
    });
    await t('别名 get → 信封 command=install', async () => {
        const r = await run(['get', SKILL, '--dry-run', '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.command, 'install', 'command 归一');
    });
    await t('list 明细 + managed 标注', async () => {
        fs.mkdirSync(path.join(skillsDir, 'manual-skill'), {
            recursive: true
        });
        fs.writeFileSync(
            path.join(skillsDir, 'manual-skill', 'SKILL.md'),
            '# manual\n'
        );
        const r = await run(['list', '--json']);
        eq(r.code, 0, 'exit');
        assert(r.json.names.includes(SKILL), 'names 缺失');
        const managed = r.json.skills.find((item) => item.name === SKILL);
        const manual = r.json.skills.find(
            (item) => item.name === 'manual-skill'
        );
        eq(managed.managed, true, 'managed');
        eq(managed.version, installedVersion, 'version');
        eq(manual.managed, false, 'manual managed');
    });
    await t('inspect 已安装 + 大小写解析', async () => {
        const r = await run(['inspect', SKILL, '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.installed, true, 'installed');
        eq(r.json.local_modified, false, 'local_modified');
        const upper = await run(['inspect', SKILL.toUpperCase(), '--json']);
        eq(upper.json.localSkillName, SKILL, '大小写解析');
    });
    await t('inspect 多余位置参数 → INVALID_ARGS', async () => {
        const r = await run(['inspect', SKILL, 'extra', '--json']);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'INVALID_ARGS', 'code');
    });

    console.log('\n[D] 本地修改 / update / 失效记录 / uninstall');
    await t('本地修改检测 + dry-run 告警', async () => {
        const mdPath = path.join(skillsDir, SKILL, 'SKILL.md');
        fs.appendFileSync(mdPath, '\n<!-- local edit -->\n');
        const r = await run(['inspect', SKILL, '--json']);
        eq(r.json.local_modified, true, 'local_modified');
        const plan = await run(['update', SKILL, '--dry-run', '--json']);
        eq(plan.code, 0, 'exit');
        eq(plan.json.results[0].local_modified, true, 'plan local_modified');
        eq(plan.json.results[0].action, 'skip', '同版本 action=skip');
    });
    await t('install --force 覆盖本地修改并告警', async () => {
        const r = await run(['install', SKILL, '--force', '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.status, 'installed', 'status');
        eq(r.json.local_modified, true, 'local_modified 告警');
        const after = await run(['inspect', SKILL, '--json']);
        eq(after.json.local_modified, false, '覆盖后应一致');
    });
    await t('update 同版本 → up_to_date', async () => {
        const r = await run(['update', SKILL, '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.status, 'up_to_date', 'status');
        eq(r.json.up_to_date, true, 'up_to_date');
    });
    await t('update --all --dry-run 只读', async () => {
        const r = await run(['update', '--all', '--dry-run', '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.all, true, 'all');
        eq(r.json.dry_run, true, 'dry_run');
        assert(r.json.results.length >= 1, 'results 为空');
    });
    await t('update --all 成功 + 计数字段', async () => {
        const r = await run(['update', '--all', '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.failed, 0, 'failed');
        assert(Array.isArray(r.json.pruned), 'pruned 缺失');
        assert(r.json.index, 'index 元数据缺失');
    });
    await t('update --all 带名称 → INVALID_ARGS', async () => {
        const r = await run(['update', '--all', SKILL, '--json']);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'INVALID_ARGS', 'code');
    });
    await t(
        '手动删目录 → status 失效记录 + update --all missing 跳过',
        async () => {
            fs.rmSync(path.join(skillsDir, SKILL), {
                recursive: true,
                force: true
            });
            const st = await run(['status', '--json']);
            assert(st.json.stale_records.includes(SKILL), 'stale_records 缺失');
            const plan = await run(['update', '--all', '--dry-run', '--json']);
            const item = plan.json.results.find((x) => x.skill === SKILL);
            eq(item.action, 'missing', 'dry-run missing');
            const r = await run(['update', '--all', '--json']);
            eq(r.code, 0, 'exit（missing 是跳过非失败）');
            assert(r.json.skipped >= 1, 'skipped 计数');
            assert(
                !fs.existsSync(path.join(skillsDir, SKILL)),
                'missing 被复活'
            );
        }
    );
    await t('update --all --prune 清理下架记录', async () => {
        const stateFile = path.join(home, 'state.json');
        const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        const template = state.skills[SKILL];
        assert(template, 'state 中无模板记录');
        state.skills['ghost-skill-xyz'] = {
            ...template,
            inputSkillName: 'ghost-skill-xyz',
            localSkillName: 'ghost-skill-xyz',
            installDir: path.join(skillsDir, 'ghost-skill-xyz')
        };
        fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
        const r = await run(['update', '--all', '--prune', '--json']);
        eq(r.code, 0, 'exit');
        assert(
            r.json.pruned.includes('ghost-skill-xyz'),
            `pruned 未包含 ghost: ${JSON.stringify(r.json.pruned)}`
        );
        const after = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
        assert(!after.skills['ghost-skill-xyz'], 'ghost 记录未删除');
    });
    await t('重新 install 恢复 missing 技能', async () => {
        const r = await run(['install', SKILL, '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.status, 'installed', 'status');
    });
    await t('uninstall --dry-run 只读', async () => {
        const r = await run(['uninstall', SKILL, '--dry-run', '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.results[0].action, 'remove', 'action');
        assert(
            fs.existsSync(path.join(skillsDir, SKILL)),
            'dry-run 删除了目录'
        );
    });
    await t('大小写不敏感 uninstall → removed', async () => {
        const r = await run(['uninstall', SKILL.toUpperCase(), '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.status, 'removed', 'status');
        eq(r.json.removed_install, true, 'removed_install');
        assert(!fs.existsSync(path.join(skillsDir, SKILL)), '目录未删除');
    });
    await t('重复 uninstall → not_installed exit 0', async () => {
        const r = await run(['uninstall', SKILL, '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.status, 'not_installed', 'status');
    });
    await t('批量 uninstall（含未管理目录与不存在技能）', async () => {
        const r = await run([
            'uninstall',
            'manual-skill',
            'no-such-skill-xyz',
            '--json'
        ]);
        eq(r.code, 0, 'exit');
        eq(r.json.total, 2, 'total');
        eq(r.json.failed, 0, 'failed');
        eq(r.json.results[0].status, 'removed', 'manual removed');
        eq(r.json.results[1].status, 'not_installed', 'not_installed');
    });

    console.log('\n[E] status / path / agents / config / clean / 网络');
    await t('status 全字段', async () => {
        const r = await run(['status', '--json']);
        eq(r.code, 0, 'exit');
        eq(r.json.explicit_target, true, 'explicit_target');
        eq(r.json.state_locked, false, 'state_locked');
        assert(r.json.index && 'exists' in r.json.index, 'index 状态缺失');
        assert(
            r.json.installed && 'count' in r.json.installed,
            'installed 缺失'
        );
        assert(Array.isArray(r.json.stale_records), 'stale_records 缺失');
    });
    await t('path / agents --json', async () => {
        const p = await run(['path', '--json']);
        eq(p.code, 0, 'exit');
        eq(p.json.skills_dir, skillsDir, 'skills_dir');
        const a = await run(['agents', '--json']);
        eq(a.code, 0, 'exit');
        assert(a.json.agents.length >= 4, 'agents 预设不足');
        assert(a.json.current.skills_dir, 'current 缺失');
    });
    await t('config get/set/unset 闭环', async () => {
        const get = await run(['config', 'get', '--json']);
        eq(get.code, 0, 'exit');
        eq(get.json.config.length, 4, 'config 行数');
        const set = await run(['config', 'set', 'agent', 'claude', '--json']);
        eq(set.code, 0, 'exit');
        eq(set.json.action, 'set', 'action');
        const one = await run(['config', 'get', 'agent', '--json']);
        eq(one.json.config[0].key, 'agent', 'key');
        assert(one.json.config[0].value.includes('claude'), 'set 未生效');
        const unset = await run(['config', 'unset', 'agent', '--json']);
        eq(unset.code, 0, 'exit');
        eq(unset.json.action, 'unset', 'action');
        const cp = await run(['config', 'path', '--json']);
        eq(cp.code, 0, 'exit');
        assert(cp.json.config_file, 'config_file 缺失');
    });
    await t('config 非法 key / 非法子命令 → INVALID_ARGS', async () => {
        const bad = await run(['config', 'set', 'badkey', 'v', '--json']);
        eq(bad.code, 1, 'exit');
        eq(bad.json.error.code, 'INVALID_ARGS', 'code');
        const sub = await run(['config', 'bogus', '--json']);
        eq(sub.code, 1, 'exit');
        eq(sub.json.error.code, 'INVALID_ARGS', 'code');
    });
    await t('clean --keep-index 保留索引，clean 全清', async () => {
        const indexFile = path.join(cacheDir, 'skills-index.json');
        assert(fs.existsSync(indexFile), '前置：索引缓存不存在');
        const keep = await run(['clean', '--keep-index', '--json']);
        eq(keep.code, 0, 'exit');
        eq(keep.json.kept_index, true, 'kept_index');
        assert(fs.existsSync(indexFile), '--keep-index 删除了索引');
        const full = await run(['clean', '--json']);
        eq(full.code, 0, 'exit');
        assert(!fs.existsSync(indexFile), 'clean 未删除索引');
    });
    await t('--timeout 1 → NETWORK_ERROR（全新缓存）', async () => {
        const env = baseEnv({
            GETSKILL_HOME: path.join(tmpRoot, 'home2'),
            GETSKILL_CACHE_DIR: path.join(tmpRoot, 'cache2'),
            GETSKILL_SKILLS_DIR: skillsDir
        });
        const r = await run(['search', 'pdf', '--timeout', '1', '--json'], env);
        eq(r.code, 1, 'exit');
        eq(r.json.error.code, 'NETWORK_ERROR', 'code');
        eq(r.json.keyword, 'pdf', 'keyword 回显');
    });
    await t('纯文本模式冒烟（search/list/status）', async () => {
        const s = await run(['search', 'pdf', '--limit', '1']);
        eq(s.code, 0, 'exit');
        assert(s.stdout.includes('pdf'), 'search 文本输出异常');
        const l = await run(['list']);
        eq(l.code, 0, 'exit');
        const st = await run(['status']);
        eq(st.code, 0, 'exit');
        assert(st.stdout.includes('安装门禁'), 'status 文本输出异常');
    });

    console.log(`\n结果: ${passed} 通过, ${failures.length} 失败`);
    if (failures.length > 0) {
        console.log('\n失败明细:');
        failures.forEach((f) => console.log(`  - ${f.name}: ${f.message}`));
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error('冒烟脚本异常:', error);
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    process.exit(1);
});
