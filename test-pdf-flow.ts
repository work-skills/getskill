import path from 'path';

import * as getskill from './main';

async function run(): Promise<void> {
    const keyword = 'pdf';

    console.log('步骤 1/5: 从 getskill.work 静态索引搜索关键词 "pdf"...');
    const results = await getskill.searchSkills(keyword);
    if (!Array.isArray(results) || results.length === 0) {
        throw new Error('搜索结果为空，无法继续测试');
    }

    console.log('步骤 2/5: 提取第一条记录...');
    const first = results[0];
    const skillName = first.full_name || first.name;
    if (!skillName) {
        throw new Error('第一条记录缺少 full_name/name，无法继续测试');
    }

    console.log('第一条记录:');
    console.log(`  名称: ${skillName}`);
    console.log(`  描述: ${first.description || '(无描述)'}`);
    console.log(`  版本: ${first.version || '(未知)'}`);
    console.log(`  下载: ${first.download_url || '(无)'}`);

    console.log('步骤 3/5: 下载并安装该技能 zip 包...');
    const downloadResult = await getskill.downloadSkill(skillName);
    console.log('下载结果:');
    console.log(`  本地缓存: ${downloadResult.repoPath}`);
    console.log(`  已安装版本: ${downloadResult.version || '(未知)'}`);
    (downloadResult.files || []).forEach((file) => {
        console.log(`  已安装目录: ${file}`);
    });

    console.log('步骤 4/5: 读取本地技能并检查是否包含刚安装技能...');
    const localSkills = getskill.listLocalSkills();
    const installedSkillDirs = (downloadResult.files || []).map((file) =>
        path.basename(file)
    );
    const containsInstalled = installedSkillDirs.some((dirName) =>
        localSkills.includes(dirName)
    );

    console.log(`本地技能总数: ${localSkills.length}`);
    console.log(`是否包含刚安装技能: ${containsInstalled ? '是' : '否'}`);

    if (!containsInstalled) {
        throw new Error(
            `本地技能列表未包含新安装技能目录: ${installedSkillDirs.join(', ')}`
        );
    }

    console.log('步骤 5/5: 校验更新检查（刚安装的技能应为最新版本）...');
    const updateResult = await getskill.updateSkill(skillName);
    if (!updateResult.upToDate) {
        throw new Error(
            `刚安装的技能未通过最新版本校验: version=${updateResult.version || 'unknown'}`
        );
    }
    console.log(
        `  校验结果: 技能已是最新版本 (v${updateResult.version || 'unknown'})，全流程无需登录`
    );

    console.log(
        '\n测试通过: 搜索 -> 下载安装 -> 本地校验 -> 版本更新检查 全流程成功'
    );
}

run().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('\n测试失败:', message);
    process.exit(1);
});
