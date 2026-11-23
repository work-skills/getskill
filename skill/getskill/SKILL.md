---
name: getskill
description: 通过 getskill CLI 从 getskill.work 技能注册表搜索、预览、安装、更新和卸载 AI Agent 技能。当任务需要当前不具备的能力（如 PDF 处理、表格转换、绘图等）时使用本技能查找并安装合适的技能包。
---

# GetSkill 技能管理工作流

使用 `getskill` CLI（`npm i -g @workskills/getskill`）从 getskill.work 注册表获取技能。
所有命令都支持 `--json`：stdout 为纯 JSON，过程日志走 stderr；出错时输出
`{ "command", "skill"?, "error": { "code", "message", "suggestions"? } }` 并以非零码退出。
未知命令/未知选项/非法数值一律报 `INVALID_ARGS`，不会静默成功。
`SKILL_NOT_FOUND` 的 `suggestions` 列出本地索引中相近的技能名（did-you-mean）。

## 前置：一次 status 完成所有检查

```bash
getskill status --json
```

返回 `explicit_target`（安装门禁是否满足）、`skills_dir`、`index`（缓存年龄/是否过期/内容哈希）、
`installed`（已装技能+版本+managed）、`stale_records`（目录被手动删的记录）、`state_locked`、
`cli_version`、`lock_pid`/`lock_stale`（状态锁占用进程与是否疑似残留）。
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
   `reload_command`/`reloaded`（是否已自动重载宿主）、`local_modified`（覆盖了本地改动时为 true）、
   `warnings[]`（跳过符号链接/超大文件、包体积与索引不一致等非致命警告，需检查）。
   **按 `next_step` 阅读 `skill_md_path` 并照做**；技能名称大小写不敏感，信封回显规范 id。
   索引每次访问都会按站点 manifest 哈希校验，正常不会滞后；无 manifest 的旧式源可用 `getskill install <名称> --refresh --json` 强制刷新。

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
getskill uninstall <名称> --force  # 无安装记录的手工目录默认拒删（UNMANAGED_SKILL），--force 才删
getskill install <名称> --force    # 覆盖无安装记录的手工目录同样需 --force 确认（update 亦然）
getskill clean --dry-run --json    # 预演清理：would_remove 列出将删除的路径
getskill clean --keep-index --json # 清理缓存但保留索引缓存
```

## 错误码处理

| code                    | 含义与对策                                                            |
| ----------------------- | --------------------------------------------------------------------- |
| `NETWORK_ERROR`         | 网络/站点不可用/跨域包被拒；有旧索引缓存时搜索仍可用，稍后重试        |
| `SKILL_NOT_FOUND`       | 名称不存在；优先看 `error.suggestions`，或用 search/index 重新确认    |
| `VERSION_NOT_AVAILABLE` | 站点仅提供最新版本；去掉 `--version` 重试                             |
| `TARGET_NOT_CONFIGURED` | 未显式指定技能目录；按“前置”步骤配置后重试                            |
| `STATE_LOCKED`          | 另一进程正在写状态文件；稍后重试                                      |
| `INVALID_ARGS`          | 未知命令/选项、参数缺失或非法（含不安全技能名）；按 message 修正      |
| `AMBIGUOUS_SKILL`       | 名称归一化后匹配多个技能；改用完整 id 重试                            |
| `EXTRACT_ERROR`         | 技能包解压失败（损坏/CRC 不符/超限/含符号链接）；换网络重试或反馈站点 |
| `PACKAGE_INVALID`       | 技能包缺少技能 .md 文件；该包无效，反馈站点                           |
| `UNMANAGED_SKILL`       | 目标目录无安装记录（手工技能）；确认要删/覆盖时加 `--force`           |

## 注意

- 布尔开关（`--json` `--force` `--all` `--prune` `--brief` `--keep-cache` `--dry-run` `--keep-index` `--refresh`）可放在任意位置；`--` 之后全部视为位置参数。重复选项以最后一次为准（stderr 有告警）。
- `-V <tag>` 是技能版本；`-v`/`--version` 是 CLI 版本。网络超时可用 `--timeout <ms>` 调整（默认 60000）。
- 索引缓存按站点 `manifest.json` 内容哈希校验：哈希一致不重复下载（无 1 天过期），哈希变化才下载新索引；manifest 不可达时回退旧缓存（信封 `index.stale=true`）。无 manifest 的旧式源保留 TTL 1 天，`update`/`--refresh` 强制刷新。
- install/update 不会静默降级：本地版本更高时视为最新；确需旧版本用显式 `--version`。非 semver 版本（如 unknown）视为低于任何正式版本，会触发一次更新。
- 安全边界：技能包默认仅允许与索引同源下载，每一跳重定向同样校验（信任跨域源时设 `GETSKILL_ALLOW_CROSS_ORIGIN=1`）；拒绝 HTTPS→HTTP 降级重定向；zip 解压限额单文件 20MB/总量 200MB，校验 CRC 并拒绝符号链接；技能名禁止 `..`/盘符/保留设备名等不安全字符。
