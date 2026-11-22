# GetSkill 使用示例

> 当前版本基于 `getskill.work` 静态索引 + ZIP 包下载，提供**搜索、下载（安装）、更新**三大核心功能，全部**无需 Git、无需登录**。

## 场景 1: 搜索技能 → Agent 判断 → 安装/更新

> `search` 只返回候选技能与简介（含本地安装状态），**不会自动安装任何技能**。
> 由 Agent 根据简介判断需要哪个技能，再自行执行 `install` / `update` 命令。

```bash
# 第一步: 搜索技能，把候选列表与简介返回给 Agent
$ getskill search pdf-toolkit

找到 1 个技能:

1. pdf-toolkit (v1.0.0)
   描述: PDF 文档处理技能：提取文本、合并拆分、页面旋转与加水印。
   分类: 文档处理
   下载: https://getskill.work/skills/pdf-toolkit.zip
   本地: 未安装（如需要: getskill install pdf-toolkit）

提示: search 只返回候选技能与简介，不会自动安装任何技能。
      请由 Agent 根据简介判断需要哪个技能，再自行执行 getskill install / update <技能名称>。

# 第二步: Agent 阅读简介后自行判断——
#   - 简介匹配任务需求且未安装 → 执行 install
#   - 已安装但版本落后（suggested_action=update）→ 执行 update
#   - 同版本已安装（suggested_action=skip）或简介不匹配 → 不执行任何命令

# 第三步: Agent 决定安装后，自行运行安装命令
$ getskill install pdf-toolkit

下载技能: pdf-toolkit...
下载技能包: https://getskill.work/skills/pdf-toolkit.zip
下载完成 (1025 bytes)，正在解压...
技能 pdf-toolkit (v1.0.0) 安装成功！

目标 Agent: claude (Claude Code)
技能已安装到 skills 目录:
  - ~/.claude/skills/pdf-toolkit

本地缓存: ~/.getskill/cache/pdf-toolkit/pdf-toolkit
已安装版本: 1.0.0
```

## 场景 2: 日常使用流程

```bash
# 列出已安装的技能
$ getskill list

本地已安装的技能 (1) · Agent: claude · 目录: ~/.claude/skills
1. pdf-toolkit

# 检查更新（版本比较）
$ getskill update pdf-toolkit

正在更新技能: pdf-toolkit...
发现新版本: 1.0.0 -> 1.1.0
下载技能包: https://getskill.work/skills/pdf-toolkit.zip
下载完成 (175000 bytes)，正在解压...
技能 pdf-toolkit 更新成功！

目标 Agent: claude (Claude Code)
技能已更新到 skills 目录:
  - ~/.claude/skills/pdf-toolkit
当前版本: 1.1.0

# 已是最新时
$ getskill update pdf-toolkit

正在更新技能: pdf-toolkit...
技能 pdf-toolkit 已是最新版本 (1.1.0)，无需更新

技能已是最新版本 (v1.1.0)，无需更新。

# 批量更新所有已安装技能（--prune 同时清理已下架技能的历史记录）
$ getskill update --all
$ getskill update --all --prune

批量更新完成：1/1 个技能成功。

# 查看某个技能的安装状态
$ getskill inspect pdf-toolkit

# 查看 Agent 与目录路径
$ getskill path

Agent: claude (Claude Code)
技能目录: ~/.claude/skills
缓存目录: ~/.getskill/cache
配置文件: ~/.getskill/config.json
状态文件: ~/.getskill/state.json
站点地址: https://getskill.work

# 清理 ZIP 下载/解压缓存
$ getskill clean

已清理缓存目录: ~/.getskill/cache
```

## 场景 3: JSON 输出与脚本集成

```bash
$ getskill search xlsx --json

{
    "keyword": "xlsx",
    "count": 1,
    "results": [
        {
            "name": "xlsx",
            "full_name": "xlsx",
            "description": "...",
            "html_url": "https://getskill.work/skill.html?id=xlsx",
            "git_url": "https://getskill.work/skills/xlsx.zip",
            "clone_url": "https://getskill.work/skills/xlsx.zip",
            "download_url": "https://getskill.work/skills/xlsx.zip",
            "version": "1.0.0",
            "category": "文档处理",
            "author": "Anthropic",
            "size": 173410,
            "installed": false,
            "installed_version": null,
            "suggested_action": "install"
        }
    ]
}
```

Agent 集成建议：把 `--json` 结果（名称 + `description` + `suggested_action`）交给 Agent，
由 Agent 判断需要哪个技能后再执行 `getskill install/update <名称>`；search 本身不安装任何技能。

批量安装脚本（技能清单由人工/Agent 事先选定，而非直接安装全部搜索结果）：

```bash
#!/bin/bash
skills=(
    "pdf-extract"
    "xlsx"
    "docx"
)

for skill in "${skills[@]}"; do
    echo "正在安装: $skill"
    getskill install "$skill"
    echo "---"
done
```

### Agent 全 JSON 工作流（status / index / show / install / uninstall）

```bash
# 第 0 步: 一次 status 完成前置检查（门禁/目录/索引缓存/已装技能/失效记录/锁）
$ getskill status --json
{ "command": "status", "cli_version": "3.3.0", "agent": "claude", "skills_dir": "~/.claude/skills",
  "explicit_target": true, "index": { "exists": true, "fetched_at": "…", "skill_count": 5459, "stale": false },
  "installed": { "count": 1, "skills": [ { "name": "pdf-toolkit", "version": "1.0.0", "managed": true, ... } ] },
  "stale_records": [], "state_locked": false, "lock_pid": null, "lock_stale": false }

# 搜索无结果时，按分类紧凑浏览完整索引（不要直接读数 MB 的原始索引文件）
$ getskill index --categories --json
{ "command": "index", "mode": "categories", "total": 5459, "category_count": 20,
  "categories": [ { "category": "开发效率", "count": 1348 }, ... ], "index": { ... } }

$ getskill index --category 文档处理 --json --limit 50
{ "command": "index", "mode": "list", "category": "文档处理", "total": 12, "page": 1, "limit": 50, "count": 12,
  "skills": [ { "name": "pdf-toolkit", "description": "…(截断到约120字符)", "version": "1.0.0", "category": "文档处理" }, ... ] }

# 安装前预览 SKILL.md 全文（HTML fallback 不会被当成 SKILL.md）
$ getskill show pdf-toolkit --json
{ "command": "show", "skill": "pdf-toolkit", "version": "1.0.0", "source": "remote", "skill_md": "---\nname: pdf-toolkit\n...", "index": { ... } }

# 预演（只读，不下载不写入）：确认动作与目标版本后再真正执行
$ getskill install pdf-toolkit --dry-run --json
{ "command": "install", "dry_run": true, "total": 1,
  "results": [ { "skill": "pdf-toolkit", "action": "install", "current_version": null, "target_version": "1.0.0", "exists": false, ... } ] }

# 安装 / 重复安装（幂等跳过）/ 更新 / 卸载，全部返回结果信封
$ getskill install pdf-toolkit --json
{ "command": "install", "status": "installed", "skill": "pdf-toolkit", "version": "1.0.0",
  "up_to_date": false, "install_dir": "~/.claude/skills/pdf-toolkit", "files": [...], "agent": "claude",
  "local_modified": false, "warnings": [], "index": { ... },
  "skill_md_path": "~/.claude/skills/pdf-toolkit/SKILL.md", "next_step": "阅读 …/SKILL.md 并按其说明使用技能；…",
  "reload_command": null, "reloaded": null }

# warnings[] 是非致命警告（跳过符号链接/超大文件、包体积与索引声明不一致等），Agent 应检查
# 索引缓存滞后、站点刚更新时，用 --refresh 强制刷新索引后再解析
$ getskill install pdf-toolkit --refresh --json

$ getskill install pdf-toolkit --json
{ "command": "install", "status": "skipped", "up_to_date": true, ... }

$ getskill update pdf-toolkit --json
{ "command": "update", "status": "up_to_date", "version": "1.0.0", ... }

$ getskill uninstall pdf-toolkit --json
{ "command": "uninstall", "status": "removed", "removed_install": true, "removed_cache": true, ... }

$ getskill uninstall pdf-toolkit --json   # 再次卸载：不再误报 removed
{ "command": "uninstall", "status": "not_installed", "removed_install": false, "removed_cache": false, ... }

# 无安装记录的手工技能目录默认拒删（UNMANAGED_SKILL），确认要删时加 --force
$ getskill uninstall manual-skill --json
{ "command": "uninstall", "skill": "manual-skill", "error": { "code": "UNMANAGED_SKILL", "message": "技能目录 … 不由 getskill 管理（无安装记录）…确认删除请使用 --force…" } }

$ getskill uninstall manual-skill --dry-run --json   # 预演同样如实反映保护
{ "command": "uninstall", "dry_run": true, "total": 1,
  "results": [ { "skill": "manual-skill", "ok": false, "action": "blocked", "managed": false, "error": { "code": "UNMANAGED_SKILL", ... } } ] }

$ getskill uninstall manual-skill --force --json
{ "command": "uninstall", "status": "removed", "managed": false, "removed_install": true, ... }

# 清理缓存前预演（只列出将删除的路径，不执行删除）
$ getskill clean --dry-run --json
{ "command": "clean", "dry_run": true, "would_remove": ["~/.getskill/cache"], "kept_index": false, "cache_dir": "~/.getskill/cache" }

# 批量操作：逐项结果 + 计数，部分失败时退出码非零
$ getskill install pdf-toolkit excel-helper --json
{ "command": "install", "total": 2, "succeeded": 2, "failed": 0, "results": [ { "skill": "pdf-toolkit", "ok": true, ... }, ... ] }

$ getskill update --all --json
{ "command": "update", "all": true, "total": 2, "succeeded": 1, "skipped": 1, "failed": 0, "pruned": [],
  "results": [ { "skillName": "pdf-toolkit", "ok": true, "status": "up_to_date", ... },
               { "skillName": "old-skill", "ok": false, "skipped": true, "status": "missing", "error": "安装目录已不存在…" } ] }

# 本地状态（list 合并目录扫描与 state，标注 managed）
$ getskill list --json
{ "command": "list", "agent": "claude", "skills_dir": "~/.claude/skills", "count": 1,
  "skills": [ { "name": "pdf-toolkit", "version": "1.0.0", "managed": true, "skill_dir": "…", "updated_at": "…" } ],
  "names": ["pdf-toolkit"] }

$ getskill inspect pdf-toolkit --json
{ "command": "inspect", "installed": true, "cached": true, "local_modified": false, "state": { "version": "1.0.0", ... }, ... }
```

出错时任何命令的 `--json` 都输出错误信封并非零退出（含未知命令/未知选项/非法数值），Agent 可按 `error.code` 程序化处理：

```bash
$ getskill search pdf --json --base-url http://127.0.0.1:9   # 站点不可用且无缓存
{ "command": "search", "keyword": "pdf", "error": { "code": "NETWORK_ERROR", "message": "搜索失败: …" } }

$ getskill install pdf-toolki --json   # 拼错技能名：附 did-you-mean 建议（本地索引离线计算）
{ "command": "install", "skill": "pdf-toolki", "error": { "code": "SKILL_NOT_FOUND", "message": "技能不存在: pdf-toolki，…（是否想使用: pdf-toolkit？）", "suggestions": ["pdf-toolkit"] } }

$ getskill serch pdf --json   # 拼错命令：不再打印 help 假装成功
{ "command": "serch", "error": { "code": "INVALID_ARGS", "message": "未知命令: serch（是否想执行 getskill search？）…" } }
```

布尔开关可放在任意位置：`getskill --json search pdf --brief --limit 10`；多词关键词用引号包裹（AND 匹配）：`getskill search "pdf merge" --json`。

## 场景 4: 编程接口使用

```javascript
const getskill = require('@workskills/getskill');

(async () => {
    try {
        // 设置自定义索引地址（可选）
        getskill.setBaseUrl('https://getskill.work');

        // 查看当前索引地址
        console.log('当前索引:', getskill.getBaseUrl());

        // 搜索技能（基于静态索引 data/skills.json）
        // 只返回候选技能与简介（含 installed/suggested_action），不会安装任何技能
        const results = await getskill.searchSkills('pdf');
        console.log('搜索结果:', results);

        // 由调用方/Agent 根据简介判断后，再决定是否安装
        // （示例中假定已选定 pdf-extract；下载 ZIP + 本地解压 + 复制）
        const result = await getskill.downloadSkill('pdf-extract');
        console.log('安装成功:', result.files);

        // 更新技能（版本比较）
        await getskill.updateSkill('pdf-extract');
        console.log('更新检查完成');

        // 列出本地技能
        const localSkills = getskill.listLocalSkills();
        console.log('本地技能:', localSkills);
    } catch (error) {
        console.error('错误:', error.message);
    }
})();
```

## 场景 5: 错误处理

```bash
# 技能不存在
$ getskill install non-existent-skill
下载技能: non-existent-skill...
下载技能失败: 技能不存在: non-existent-skill
执行命令时出错: 技能不存在: non-existent-skill

# 搜索关键词没有匹配到技能
$ getskill search 不存在的关键词

未找到与 "不存在的关键词" 匹配的技能。

提示: Agent 可自行浏览完整技能索引，按名称/简介挑选合适的技能，
      再执行 getskill install <技能名称> 安装使用；也可更换关键词重新搜索。
      浏览索引（紧凑输出，适合 Agent）:
        getskill index --categories
        getskill index --category <分类> --json
      本地索引文件: ~/.getskill/cache/skills-index.json
        （JSON 格式，skills 数组含 id/name/description/version 等字段）
      在线索引: https://getskill.work/data/skills.json

# --json 无结果时同样返回指引字段（count=0 时附加 message/hint/index_url，索引文件存在时附加 index_file）
$ getskill search 不存在的关键词 --json

{
  "keyword": "不存在的关键词",
  "count": 0,
  "results": [],
  "message": "未找到与 \"不存在的关键词\" 匹配的技能",
  "hint": "Agent 可用 getskill index --categories 查看分类，再用 getskill index --category <分类> --json 浏览紧凑技能列表，按名称/简介挑选后执行 getskill install <技能名称>；也可更换关键词重新搜索",
  "index_file": "~/.getskill/cache/skills-index.json",
  "index_url": "https://getskill.work/data/skills.json"
}

# 搜索失败（网络/站点不可用且无缓存）与"无结果"可区分：--json 输出 error.code 并非零退出
$ getskill search pdf --json
{ "command": "search", "keyword": "pdf", "error": { "code": "NETWORK_ERROR", "message": "搜索失败: …" } }
```

## 场景 6: 切换 Agent / 自定义目录 / 自定义索引

```bash
# 查看当前生效配置（含来源）
$ getskill config get

base-url: https://getskill.work
  来源: 默认值，未保存，使用默认站点
agent: claude (Claude Code)
  来源: 自动识别，未保存，自动识别本机 Agent
skills-dir: ~/.claude/skills
  来源: 自动识别，未单独保存，由 agent 推导
cache-dir: ~/.getskill/cache
  来源: 默认值，未保存，使用默认缓存目录
配置文件: ~/.getskill/config.json
状态文件: ~/.getskill/state.json

# 列出内置 Agent 预设
$ getskill agents

# 切换到其它 Agent（持久化）
$ getskill config set agent cursor
agent: cursor (Cursor)
  来源: 配置文件，已保存: cursor

# 任意 Agent：直接指定技能目录（持久化）
$ getskill config set skills-dir ~/.my-agent/skills

# 只对本次命令生效
$ getskill --agent codex install pdf-toolkit
$ getskill --skills-dir ~/.my-agent/skills install pdf-toolkit

# 删除配置项，恢复自动识别/默认值
$ getskill config unset agent

# 自定义索引地址（需要同样提供 /data/skills.json 与 /skills/<id>.zip）
$ getskill config set base-url https://custom-index.example.com

# 通过环境变量临时覆盖
$ GETSKILL_BASE_URL=https://another-index.com getskill search pdf
```

## 场景 7: 目录结构查看

```bash
$ tree ~/.getskill

~/.getskill/
├── config.json          # 持久化配置
├── state.json           # 安装记录（技能名、版本、安装目录）
└── cache/
    └── pdf-toolkit/     # ZIP 解压后的技能包内容
        └── pdf-toolkit/
            └── SKILL.md

$ tree ~/.claude/skills   # 当前 Agent 的技能目录

~/.claude/skills/
└── pdf-toolkit/
    └── SKILL.md
```

## 常见问题

### Q: 需要安装 Git 吗？

A: 不需要。搜索、安装、更新、卸载均通过 HTTP 直接下载 ZIP 并本地解压完成，全程不依赖 Git。

### Q: 我用的 Agent 不在预设列表里怎么办？

A: 用 `getskill config set skills-dir <path>`、`getskill --skills-dir <path> ...` 或 `GETSKILL_SKILLS_DIR=<path>` 指定该 Agent 的技能目录即可。

### Q: 如何卸载技能？

A: 使用 `getskill uninstall <技能名称>`，或直接删除当前技能目录（`getskill path` 可查看）下对应的子目录。注意：没有 getskill 安装记录的手工技能目录默认拒删（`UNMANAGED_SKILL`），确认要删时加 `--force`。

### Q: 安装时报“技能包地址跨域…默认拒绝下载”怎么办？

A: 3.2.1 起技能包默认仅允许与索引源（`base-url`）同源下载。若你信任索引中指向的其他域名（如自建 CDN），设置环境变量 `GETSKILL_ALLOW_CROSS_ORIGIN=1` 后重试。

### Q: 技能名可以用 `..` 或 `CON` 吗？

A: 不可以。install/update/uninstall/inspect 会拒绝不安全名称（目录穿越、盘符/数据流字符、Windows 保留设备名、控制字符、结尾点/空格），报 `INVALID_ARGS`，防止误删技能根目录或写入非法路径。

### Q: 缓存目录可以删除吗？

A: 可以使用 `getskill clean` 清理缓存，下次安装/更新时会重新下载 ZIP。

### Q: 更新是如何判断的？

A: 安装时会在本地记录技能版本与内容哈希；`update` 时拉取远端索引中的最新版本号做 semver 比较（`1.10.0 > 1.9.0`），站点版本更高才重新下载，不会静默降级。若本地文件被手动修改过，覆盖前会告警并在信封中标记 `local_modified: true`。

### Q: `update --all` 提示某些技能“已跳过”是什么意思？

A: 分两种：`status: "stale"` 表示技能已从索引中下架或改名（执行 `getskill update --all --prune` 可清理失效记录）；`status: "missing"` 表示安装目录被手动删除，getskill 不会静默重装，如需恢复请显式执行 `getskill install <名称>`。
