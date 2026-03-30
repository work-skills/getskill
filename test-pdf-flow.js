#!/usr/bin/env node

const path = require('path');
const getskill = require('./index');

async function run() {
    const keyword = 'pdf';

    console.log('步骤 1/4: 搜索关键词 "pdf"...');
    const results = await getskill.searchSkills(keyword);
    if (!Array.isArray(results) || results.length === 0) {
        throw new Error('搜索结果为空，无法继续测试');
    }

    console.log('步骤 2/4: 提取第一条记录...');
    const first = results[0];
    const skillName = first.full_name || first.name;
    if (!skillName) {
        throw new Error('第一条记录缺少 full_name/name，无法继续测试');
    }

    console.log('第一条记录:');
    console.log(`  名称: ${skillName}`);
    console.log(`  描述: ${first.description || '(无描述)'}`);
    console.log(`  Git: ${first.git_url || first.clone_url || '(无)'}`);

    console.log('步骤 3/4: 下载该记录对应仓库...');
    const downloadResult = await getskill.downloadSkill(skillName);
    console.log('下载结果:');
    console.log(`  仓库缓存: ${downloadResult.repoPath}`);
    (downloadResult.files || []).forEach(file => {
        console.log(`  已安装目录: ${file}`);
    });

    console.log('步骤 4/4: 读取本地技能并检查是否包含刚安装技能...');
    const localSkills = getskill.listLocalSkills();
    const installedSkillDirs = (downloadResult.files || []).map(file => path.basename(file));
    const containsInstalled = installedSkillDirs.some(dirName => localSkills.includes(dirName));

    console.log(`本地技能总数: ${localSkills.length}`);
    console.log(`是否包含刚安装技能: ${containsInstalled ? '是' : '否'}`);

    if (!containsInstalled) {
        throw new Error(`本地技能列表未包含新安装技能目录: ${installedSkillDirs.join(', ')}`);
    }

    console.log('\n测试通过: 搜索 -> 提取首条 -> 下载 -> 本地校验 全流程成功');
}

run().catch((error) => {
    console.error('\n测试失败:', error.message);
    process.exit(1);
});
