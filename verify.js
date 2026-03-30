#!/usr/bin/env node

const { execFileSync } = require('child_process');
const path = require('path');

const projectRoot = __dirname;
const indexPath = path.join(projectRoot, 'index.js');

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function run() {
    execFileSync(process.execPath, ['--check', indexPath], {
        cwd: projectRoot,
        stdio: 'inherit'
    });

    const exported = require(indexPath);

    assert(typeof exported.searchSkills === 'function', 'searchSkills 导出缺失');
    assert(typeof exported.downloadSkill === 'function', 'downloadSkill 导出缺失');
    assert(typeof exported.updateSkill === 'function', 'updateSkill 导出缺失');
    assert(typeof exported.listLocalSkills === 'function', 'listLocalSkills 导出缺失');
    assert(typeof exported.getSkillsDirectory === 'function', 'getSkillsDirectory 导出缺失');
    assert(typeof exported.getSkillsCacheDirectory === 'function', 'getSkillsCacheDirectory 导出缺失');

    console.log('verify passed');
}

try {
    run();
} catch (error) {
    console.error('verify failed:', error.message);
    process.exit(1);
}