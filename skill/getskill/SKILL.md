---
name: getskill
description: 通过 getskill CLI 从 getskill.work 技能注册表搜索、预览、安装、更新和卸载 AI Agent 技能。当任务需要当前不具备的能力（如 PDF 处理、表格转换、绘图等）时使用本技能查找并安装合适的技能包。
---

# GetSkill 技能管理工作流

使用 `getskill` CLI（`npm i -g @workskills/getskill`）从 getskill.work 注册表获取技能。
所有命令都支持 `--json`：stdout 为纯 JSON，过程日志走 stderr；出错时输出
`{ "error": { "code", "message" } }` 并以非零码退出。

## 前置：确认目标目录（必须）

install/update/uninstall 有安全门禁：技能目录必须显式指定，仅自动探测时会报
`TARGET_NOT_CONFIGURED`。先执行其一：

```bash
getskill config set agent <claude|codex|cursor|openclaw|...>   # 内置 Agent
getskill config set skills-dir <技能目录>                       # 任意目录
# 或仅本次生效: getskill --skills-dir <目录> install <名称>
```

用 `getskill path` / `getskill agents` 查看当前生效目录。

## 标准流程：search → 决策 → install/update

1. **搜索候选**（不会自动安装任何技能）：

    ```bash
    getskill search <关键词> --json --brief --limit 10
    ```

    每条结果含 `description`（简介）、`version`、`installed`、`installed_version`、
    `suggested_action`：
    - `install`：未安装 → 如需要该能力，执行 `getskill install <full_name> --json`
    - `update`：已装但版本落后 → 如需要，执行 `getskill update <full_name> --json`
    - `skip`：同版本已装 → 不要重复安装，直接使用本地技能

2. **由你（Agent）根据简介判断**是否需要该技能；不匹配就换关键词，不要盲目安装。

3. **安装/更新结果**（`--json`）：`status` 为 `installed` / `skipped` / `updated` /
   `up_to_date`，附 `version`、`install_dir`。安装后阅读 `install_dir/SKILL.md`
   并按其说明使用技能。

## 无结果时：浏览完整索引

```bash
getskill index --categories --json            # 分类及数量（索引可达数千条，勿直接读原始索引文件）
getskill index --category <分类> --json --limit 50   # 紧凑列表（name/description/version）
getskill index --category <分类> --json --page 2     # 翻页
```

挑选后同样执行 `getskill install <名称> --json`。

## 安装前预览（可选）

```bash
getskill show <技能名称> --json    # 返回 skill_md（SKILL.md 全文），先读再决定是否安装
```

## 维护

```bash
getskill list --json               # 本地已安装技能
getskill inspect <名称> --json     # 单个技能的安装/缓存/版本状态
getskill update --all --json       # 批量更新（索引强制刷新）
getskill update --all --prune      # 同时清理已下架技能的本地记录
getskill uninstall <名称> --json   # 卸载（--keep-cache 保留缓存）
getskill clean                     # 清理下载缓存与索引缓存
```

## 错误码处理

| code                    | 含义与对策                                          |
| ----------------------- | --------------------------------------------------- |
| `NETWORK_ERROR`         | 网络/站点不可用；有旧索引缓存时搜索仍可用，稍后重试 |
| `SKILL_NOT_FOUND`       | 名称不存在；用 search/index 重新确认名称            |
| `VERSION_NOT_AVAILABLE` | 站点仅提供最新版本；去掉 `--version` 重试           |
| `TARGET_NOT_CONFIGURED` | 未显式指定技能目录；按“前置”步骤配置后重试          |
| `STATE_LOCKED`          | 另一进程正在写状态文件；稍后重试                    |
| `INVALID_ARGS`          | 参数缺失/无效；按 message 中的用法修正              |

## 注意

- 布尔开关（`--json` `--force` `--all` `--prune` `--brief` `--keep-cache`）可放在任意位置。
- 索引缓存 TTL 1 天；`update` 会强制刷新；离线时搜索回退旧缓存。
- 不要直接读取 `<cache-dir>/skills-index.json` 原始文件（可能数 MB），用 `getskill index` 紧凑浏览。
