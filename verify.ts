import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

import * as exported from './main';

const projectRoot = __dirname;
const candidateProjectRoots = [projectRoot, path.resolve(projectRoot, '..')];

function findFirstExistingPath(relativePath: string): string {
    for (const root of candidateProjectRoots) {
        const candidate = path.join(root, relativePath);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return path.join(projectRoot, relativePath);
}

const tsconfigPath = findFirstExistingPath('tsconfig.json');
const packageJsonPath = findFirstExistingPath('package.json');

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

function run(): void {
    execFileSync(
        process.execPath,
        [require.resolve('typescript/bin/tsc'), '--noEmit', '-p', tsconfigPath],
        {
            cwd: projectRoot,
            stdio: 'inherit'
        }
    );

    const packageJson = JSON.parse(
        fs.readFileSync(packageJsonPath, 'utf8')
    ) as { version: string };

    assert(
        typeof exported.searchSkills === 'function',
        'searchSkills 导出缺失'
    );
    assert(
        typeof exported.downloadSkill === 'function',
        'downloadSkill 导出缺失'
    );
    assert(typeof exported.updateSkill === 'function', 'updateSkill 导出缺失');
    assert(
        typeof exported.listLocalSkills === 'function',
        'listLocalSkills 导出缺失'
    );
    assert(
        typeof exported.getSkillsDirectory === 'function',
        'getSkillsDirectory 导出缺失'
    );
    assert(
        typeof exported.getSkillsCacheDirectory === 'function',
        'getSkillsCacheDirectory 导出缺失'
    );
    assert(
        typeof exported.publishSkill === 'function',
        'publishSkill 导出缺失'
    );

    const originalLog = console.log;
    const logLines: string[] = [];

    console.log = (...args: unknown[]) => {
        logLines.push(args.map((arg) => String(arg)).join(' '));
    };

    try {
        exported.printHelp();
    } finally {
        console.log = originalLog;
    }

    const helpOutput = logLines.join('\n');

    assert(helpOutput.includes('getskill --help'), '帮助输出缺少 --help');
    assert(helpOutput.includes('getskill --version'), '帮助输出缺少 --version');
    assert(
        helpOutput.includes('getskill install <技能名称>'),
        '帮助输出缺少 install 用法'
    );
    assert(
        helpOutput.includes('--version <tag>'),
        '帮助输出缺少 install/update --version 用法'
    );
    assert(
        helpOutput.includes('getskill update <技能名称>'),
        '帮助输出缺少 update 用法'
    );
    assert(
        helpOutput.includes('getskill update --all'),
        '帮助输出缺少 update --all 用法'
    );
    assert(
        helpOutput.includes('getskill uninstall <技能名称>'),
        '帮助输出缺少 uninstall 用法'
    );
    assert(
        helpOutput.includes('getskill inspect <技能名称>'),
        '帮助输出缺少 inspect 用法'
    );
    assert(
        helpOutput.includes('getskill search <关键词> --json'),
        '帮助输出缺少 search --json 用法'
    );
    assert(
        helpOutput.includes('getskill publish <目录> --repo <git-url>'),
        '帮助输出缺少 publish 用法'
    );

    const versionOutput = exported.getCliVersion();

    assert(
        versionOutput === packageJson.version,
        `--version 输出异常: expected ${packageJson.version}, got ${versionOutput}`
    );

    console.log('verify passed');
}

try {
    run();
} catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('verify failed:', message);
    process.exit(1);
}
