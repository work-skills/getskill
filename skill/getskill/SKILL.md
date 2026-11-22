---
name: getskill
description: 通过 getskill CLI 从 getskill.work 技能注册表搜索、预览、安装、更新和卸载 AI Agent 技能。当任务需要当前不具备的能力（如 PDF 处理、表格转换、绘图等）时使用本技能查找并安装合适的技能包。
---

# GetSkill 技能管理工作流

使用 `getskill` CLI（`npm i -g @workskills/getskill`）从 getskill.work 注册表获取技能。
所有命令都支持 `--json`：stdout 为纯 JSON，过程日志走 stderr；出错时输出
`{ "command", "skill"?, "error": { "code", "message" } }` 并以非零码退出。
未知命令/未知选项/非法数值一律报 `INVALID_ARGS`，不会静默成功。

## 前置：一次 status 完成所有检查

```bash
getskill status --json
```

返回 `explicit_target`（安装门禁是否满足）、`skills_dir`、`index`（缓存年龄/是否过期）、
`installed`（已装技能+版本+managed）、`stale_records`（目录被手动删的记录）、`state_locked`。
若 `explicit_target=false`，先执行其一（否则 install/update/uninstall 报 `TARGET_NOT_CONFIGURED`）：

```bash
getskill config set agent <claude|codex|cursor|openclaw|...>   # 内置 Agent
getskill config set skills-dir <技能目录>                       # 任意目录
# 或仅本次生效: getskill --skills-dir <目录> install <名称>
```

## 标准流程：search → 决策 → install/update

1. **搜索候选**（不会自动安装任何技能；多词为 AND 匹配，用引号包裹）：

    ```bash
    getskill search "<关键词>" --json --brief --limit 10
    ```

    信封含 `total/page/limit/has_more` 与 `index`（索引来源与新鲜度）。每条结果含
    `description`、`version`、`installed`、`installed_version`、`suggested_action`：
    - `install`：未安装 → 如需要该能力，执行 `getskill install <full_name> --json`
    - `update`：站点有更新版本 → 如需要，执行 `getskill update <full_name> --json`
    - `skip`：本地版本不低于站点（semver 比较）→ 不要重复安装，直接使用本地技能

2. **由你（Agent）根据简介判断**是否需要该技能；不匹配就换关键词（可减少词数），不要盲目安装。
   不确定时可先 `getskill show <名称> --json` 读 SKILL.md 全文，或
   `getskill install <名称> --dry-run --json` 查看预演计划（不下载不写入）。

3. **安装/更新结果**（`--json`）：`status` 为 `installed` / `skipped` / `updated` /
   `up_to_date`，附 `version`、`install_dir`、`skill_md_path`、`next_step`、
   `reload_command`/`reloaded`（是否已自动重载宿主）、`local_modified`（覆盖了本地改动时为 true）。
   **按 `next_step` 阅读 `skill_md_path` 并照做**；技能名称大小写不敏感，信封回显规范 id。

4. **批量**：`getskill install a b c --json` / `update a b --json` / `uninstall a b --json`
   返回 `{ total, succeeded, failed, results[] }`，部分失败时退出码非零，逐项检查 `ok`。

## 无结果时：浏览完整索引

```bash
getskill index --categories --json            # mode=categories，分类及数量
getskill index --category <分类> --json --limit 50   # mode=list，紧凑列表
getskill index --category <分类> --json --page 2     # 翻页
```

挑选后同样执行 `getskill install <名称> --json`。勿直接读原始索引文件（可能数 MB）。

## 维护

```bash
getskill list --json               # 本地技能明细（name/version/managed/skill_dir）
getskill inspect <名称> --json     # 单个技能状态，含 local_modified
getskill update --all --json       # 批量更新；信封含 succeeded/skipped/failed/pruned
getskill update --all --dry-run    # 预演；目录被手动删的技能报 missing 而非静默重装
getskill update --all --prune      # 同时清理已下架技能的本地记录
getskill uninstall <名称> --json   # 未安装时 status=not_installed（不是 removed）
getskill clean --keep-index --json # 清理缓存但保留索引缓存
```

## 错误码处理

| code                    | 含义与对策                                          |
| ----------------------- | --------------------------------------------------- |
| `NETWORK_ERROR`         | 网络/站点不可用；有旧索引缓存时搜索仍可用，稍后重试 |
| `SKILL_NOT_FOUND`       | 名称不存在；用 search/index 重新确认名称            |
| `VERSION_NOT_AVAILABLE` | 站点仅提供最新版本；去掉 `--version` 重试           |
| `TARGET_NOT_CONFIGURED` | 未显式指定技能目录；按“前置”步骤配置后重试          |
| `STATE_LOCKED`          | 另一进程正在写状态文件；稍后重试                    |
| `INVALID_ARGS`          | 未知命令/选项、参数缺失或非法；按 message 修正      |
| `AMBIGUOUS_SKILL`       | 名称归一化后匹配多个技能；改用完整 id 重试          |

## 注意

- 布尔开关（`--json` `--force` `--all` `--prune` `--brief` `--keep-cache` `--dry-run` `--keep-index`）可放在任意位置；`--` 之后全部视为位置参数。
- `-V <tag>` 是技能版本；`-v`/`--version` 是 CLI 版本。网络超时可用 `--timeout <ms>` 调整（默认 60000）。
- 索引缓存 TTL 1 天；`update` 会强制刷新；离线时搜索回退旧缓存（信封 `index.stale=true`）。
- install/update 不会静默降级：本地版本更高时视为最新；确需旧版本用显式 `--version`。
