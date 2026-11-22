# GetSkill

AI Agent 技能管理工具 - 从 getskill.work 搜索、下载和更新技能文件，适用于任意 Agent（Claude Code、OpenClaw、Codex、Cursor……或任意自定义技能目录）。

## 功能特性

- 🔍 从 `getskill.work` 静态技能索引（`data/skills.json`）搜索技能，支持 `--json` 输出与 `--limit/--page/--brief`
- 🗂️ `getskill index` 紧凑浏览完整索引（分类统计 / 分类列表），`getskill show` 安装前预览 SKILL.md
- ⚡ 索引本地缓存（TTL 1 天）：搜索优先读本地缓存，过期自动刷新，下载失败回退旧缓存（离线可搜索）
- 🧠 搜索结果标注本地安装状态（`installed` / `installed_version` / `suggested_action`，semver 比较不会误降级），版本不低于站点时 `install` 自动跳过下载（`--force` 可强制重装）
- 🤝 面向 Agent 的 JSON 契约：**所有命令**支持 `--json` 结果信封（含 `status` 一次前置检查、`--dry-run` 预演、批量操作、`next_step` 生效指引）；出错输出 `error.code`（如 `NETWORK_ERROR` / `SKILL_NOT_FOUND` / `INVALID_ARGS`）并非零退出，未知命令/选项不再静默成功
- 📥 通过 HTTPS 直接下载技能 ZIP 包并在本地解压安装（同源策略、解压限额、CRC 校验、符号链接拒绝，见「安全边界」）
- 🔄 基于版本号比较的增量更新（`update` / `update --all`，`--prune` 可清理已下架技能的历史记录）
- 🤖 **不绑定任何 Agent**：内置多种 Agent 目录预设，可自动识别本机 Agent
- 💾 配置持久化到 `~/.getskill/config.json`，安装记录持久化到 `~/.getskill/state.json`（自动迁移旧版 `~/.openclaw/getskill/state.json`）
- ⚙️ 支持环境变量与命令行参数覆盖（`GETSKILL_BASE_URL`、`GETSKILL_AGENT`、`GETSKILL_SKILLS_DIR` 等）
- 📂 跨平台支持（Windows / macOS / Linux）
- 📦 零第三方运行时依赖（内置 ZIP 解析/解压实现）

## 安装

全局安装后即可在任意位置使用 `getskill` 命令：

```bash
npm install -g @workskills/getskill
```

也可以不安装直接通过 npx 运行：

```bash
npx @workskills/getskill search <关键词>
```

要求 Node.js >= 18。

## 目标 Agent 与技能目录

`getskill` 把技能安装到「当前 Agent 的技能目录」。查看当前生效的 Agent 与目录：

```bash
getskill path
```

列出内置 Agent 预设（`*` 表示当前生效）：

```bash
getskill agents
```

内置预设：

| agent      | Agent              | 技能目录                    |
| ---------- | ------------------ | --------------------------- |
| `claude`   | Claude Code        | `~/.claude/skills`          |
| `openclaw` | OpenClaw           | `~/.openclaw/skills`        |
| `codex`    | OpenAI Codex CLI   | `~/.codex/skills`           |
| `cursor`   | Cursor             | `~/.cursor/skills`          |
| `gemini`   | Gemini CLI         | `~/.gemini/skills`          |
| `qwen`     | Qwen Code          | `~/.qwen/skills`            |
| `copilot`  | GitHub Copilot CLI | `~/.copilot/skills`         |
| `amp`      | Amp                | `~/.config/amp/skills`      |
| `opencode` | OpenCode           | `~/.config/opencode/skills` |
| `agent`    | 通用 Agent 目录    | `~/.agent/skills`           |

默认 `agent = auto`：按「历史安装记录 → 已存在且非空的技能目录 → 已存在的 Agent 根目录」顺序自动识别；都识别不到时使用 `~/.claude/skills`。

> **安全门禁**：自动识别只是启发式猜测，可能选错 Agent（如历史记录过期、多 Agent 共存）。因此 `install` / `update` / `update --all` / `uninstall` 要求**显式指定** `agent` 或 `skills-dir`（配置文件、`--agent`/`--skills-dir` 参数、`GETSKILL_AGENT`/`GETSKILL_SKILLS_DIR` 环境变量任一即可）；若技能目录仅来自自动识别，命令会直接报错（`TARGET_NOT_CONFIGURED`）并给出设置指引，避免把技能装到/误删非当前 Agent 目录的文件。`search` / `index` / `show` / `list` / `path` / `inspect` 等只读命令不受影响。

不在预设列表中的 Agent，直接指定技能目录即可（三种方式任选一种）：

```bash
# 1) 持久化保存
getskill config set skills-dir ~/.my-agent/skills

# 2) 仅本次命令生效
getskill --skills-dir ~/.my-agent/skills install <技能名称>

# 3) 环境变量
GETSKILL_SKILLS_DIR=~/.my-agent/skills getskill install <技能名称>
```

指定 Agent（持久化 / 单次）：

```bash
getskill config set agent cursor
getskill --agent codex install <技能名称>
```

下载与解压缓存默认位于 `~/.getskill/cache`，可用 `cache-dir` 配置或 `GETSKILL_CACHE_DIR` 覆盖。

## 使用方法

### 搜索技能

```bash
getskill search <关键词>
```

JSON 格式输出：

```bash
getskill search <关键词> --json
```

分页与紧凑输出（节省 Agent 上下文）：

```bash
getskill search <关键词> --json --limit 10 --page 2   # 默认每页 20 条
getskill search <关键词> --json --brief               # 简介截断到约 120 字符
```

布尔开关（`--json` / `--brief` / `--force` / `--all` / `--prune` / `--keep-cache` / `--dry-run` / `--keep-index` / `--refresh`）可放在任意位置，例如 `getskill --json search pdf`。重复选项以最后一次的值为准（stderr 给出告警）。

示例（`getskill search pdf-toolkit`）：

```
找到 1 个技能:

1. pdf-toolkit (v1.0.0)
   描述: PDF 文档处理技能：提取文本、合并拆分、页面旋转与加水印。当用户需要处理 PDF 文件时使用。
   分类: 文档处理
   下载: https://getskill.work/skills/pdf-toolkit.zip
   本地: 已安装 v1.0.0（同版本，无需重复安装）
```

索引缓存与本地状态说明：

- **search 只返回候选技能与简介，不会自动安装任何技能。** 推荐的 Agent 工作流：
    1. 执行 `getskill search <关键词> --json`，把候选技能（名称 + `description` + 版本 + 本地安装状态）返回给 Agent；
    2. Agent 根据简介与任务需求自行判断需要哪个技能；
    3. Agent 决定后自行运行 `getskill install <名称>`（未安装）或 `getskill update <名称>`（已装但版本落后）；同版本已装或不匹配时不执行任何命令。
- 关键词没有匹配到技能时，会明确返回"未找到匹配的技能"，并提示 Agent 用 `getskill index --categories` / `getskill index --category <分类> --json` 紧凑浏览完整索引挑选合适的技能再安装（索引可达数千条，不要直接读取原始索引文件）；`--json` 在 `count: 0` 时附加 `message` / `hint` / `index_url` 字段，本地索引文件存在时附加 `index_file`。
- **搜索失败与无结果可区分**：网络/站点不可用且无本地缓存时，`search` 抛出 `NETWORK_ERROR`（`--json` 输出 `error.code` 并非零退出），不会伪装成"无匹配"；有过期缓存时仍回退离线搜索。
- 索引缓存在 `<cache-dir>/skills-index.json`（默认 `~/.getskill/cache/skills-index.json`）。缓存时间在 1 天内时直接在本地搜索，超过 1 天自动重新下载；下载失败时回退到旧缓存，离线也能搜索。`getskill update` 会强制刷新缓存，`getskill clean` 会将其清除。
- 每条搜索结果附带本地安装状态（文本输出的“本地: …”行，`--json` 中的字段），供 Agent 决策参考：
    - `installed` / `installed_version`：是否已安装到当前 Agent 的技能目录及其版本；
    - `suggested_action`：`skip` = 本地版本不低于站点版本（semver 比较），无需重复安装；`update` = 站点有更新版本，可按需 `getskill update <名称>`；`install` = 未安装，可按需 `getskill install <名称>`。

### 浏览完整索引（index）

搜索无结果或想按分类挑选时，用紧凑输出浏览完整索引（避免直接读取数 MB 的原始索引文件）：

```bash
getskill index --categories                # 分类及数量
getskill index --categories --json
getskill index --category <分类> --json     # 紧凑列表: name/description(截断)/version/category
getskill index --category <分类> --json --limit 50 --page 2
```

默认每页 100 条；`--json` 返回 `total` / `page` / `limit` / `count` / `skills`，还有更多结果时附 `hint` 提示翻页。

### 预览技能（show）

安装前查看技能的 SKILL.md 全文：

```bash
getskill show <技能名称>
getskill show <技能名称> --json    # 返回 skill_md 与 source (remote/local)
```

优先拉取站点 `<base-url>/skills/<id>/SKILL.md`；站点未提供时回退到本地已安装/已缓存副本。

### 安装技能

```bash
getskill install <技能名称>
```

示例：

```bash
getskill install pdf-toolkit
```

输出：

```
下载技能: pdf-toolkit...
下载技能包: https://getskill.work/skills/pdf-toolkit.zip
下载完成 (1025 bytes)，正在解压...
技能 pdf-toolkit (v1.0.0) 安装成功！

目标 Agent: claude (Claude Code)
技能已安装到 skills 目录:
  - C:\Users\<用户名>\.claude\skills\pdf-toolkit

本地缓存: C:\Users\<用户名>\.getskill\cache\pdf-toolkit\pdf-toolkit
已安装版本: 1.0.0
```

操作流程：

1. 在静态索引中定位技能条目，获取下载地址
2. 若同版本已安装（安装记录版本一致且技能目录存在），跳过下载并提示；`--force` 可强制重装
3. 下载 ZIP 包到缓存目录（默认 `~/.getskill/cache/<技能名称>`）并解压
4. 将技能目录复制到当前 Agent 的技能目录，并记录已安装版本

```bash
# 强制重装（忽略“同版本已安装”的跳过逻辑）
getskill install pdf-toolkit --force

# 强制刷新技能索引缓存后再解析（索引缓存滞后、站点刚更新时使用）
getskill install pdf-toolkit --refresh
```

### 更新技能

```bash
getskill update <技能名称>
```

批量更新所有已安装技能：

```bash
getskill update --all
```

批量更新并清理索引中已下架技能的历史记录：

```bash
getskill update --all --prune
```

更新逻辑：

1. 读取本地已安装技能的版本记录（仅统计属于当前技能目录的记录）
2. 强制刷新技能索引缓存，拉取远端最新版本号（`update --all` 每进程只刷新一次）
3. 版本一致时提示“已是最新版本”；不一致时重新下载 ZIP 并覆盖安装
4. 索引中已不存在的技能会被标记为“已跳过”，不算失败；加 `--prune` 可清理这些失效记录

### 卸载技能

```bash
getskill uninstall <技能名称>
```

仅卸载本地技能目录、保留缓存：

```bash
getskill uninstall <技能名称> --keep-cache
```

与 install/update 相同，`uninstall` 也受安全门禁保护：技能目录仅来自自动识别时会报 `TARGET_NOT_CONFIGURED`，避免误删其他 Agent 目录下的技能。

**未管理目录保护**：若目标目录存在但没有 getskill 安装记录（手工放入的技能），默认拒绝删除并报 `UNMANAGED_SKILL`；确认要删除时显式加 `--force`：

```bash
getskill uninstall <技能名称> --force
```

`uninstall --dry-run` 会如实预演该保护：未管理目录返回 `action: "blocked"`、`ok: false` 并以非零码退出。

### 查看安装状态

```bash
getskill inspect <技能名称>
```

输出示例：

```
技能名称: pdf-toolkit
本地目录: pdf-toolkit
目标 Agent: claude (Claude Code)
已安装: 是
已缓存: 是
技能路径: C:\Users\<用户名>\.claude\skills\pdf-toolkit
技能目录: C:\Users\<用户名>\.claude\skills
缓存目录: C:\Users\<用户名>\.getskill\cache\pdf-toolkit
解压路径: C:\Users\<用户名>\.getskill\cache\pdf-toolkit\pdf-toolkit
最后动作: install
版本: 1.0.0
```

### 列出本地技能

```bash
getskill list
```

返回当前 Agent 技能目录下的技能目录名称列表：

```
本地已安装的技能 (1) · Agent: claude · 目录: C:\Users\<用户名>\.claude\skills
1. pdf-toolkit
```

### --json 结果信封与错误码（面向 Agent）

**所有命令**均支持 `--json`（含 `path` / `agents` / `config` / `clean` / `status` / `--version`；`--help --json` 输出机器可读命令表）：stdout 只输出最终 JSON，过程日志全部走 stderr。

```bash
getskill status --json                 # 一次返回门禁/目录/索引缓存/已装技能/失效记录/锁状态
getskill install pdf-toolkit --json
# { "command": "install", "status": "installed" | "skipped", "skill": "<规范 id>",
#   "version": "...", "up_to_date": false, "install_dir": "...", "files": [...],
#   "local_modified": false, "warnings": [], "index": { "fetched_at", "source", "stale" },
#   "skill_md_path": "...", "next_step": "...", "reload_command": null, "reloaded": null }

getskill install a b c --json          # 批量: { command, total, succeeded, failed, results: [...] }
getskill install pdf-toolkit --dry-run --json   # 只读预演计划，不下载不写入
getskill update pdf-toolkit --json     # status: "updated" | "up_to_date"
getskill update --all --json           # { command, all: true, total, succeeded, skipped, failed, pruned, results }
                                       # 每项含 status: updated/up_to_date/stale/missing/failed 与 code；有失败时退出码非零
getskill uninstall pdf-toolkit --json  # status: "removed" | "not_installed"（未安装不再误报 removed）
getskill list --json                   # { command, agent, skills_dir, count, skills: [{name,version,managed,...}], names }
getskill inspect pdf-toolkit --json    # { command, ...安装/缓存/版本状态, local_modified }
getskill search "pdf merge" --json     # 多词 AND 匹配；信封含 total/page/limit/has_more/index
```

出错时（任何命令，包括未知命令/未知选项/非法数值）`--json` 输出错误信封并以非零码退出：

```json
{
    "command": "install",
    "skill": "pdf-toolki",
    "error": {
        "code": "SKILL_NOT_FOUND",
        "message": "技能不存在: …（是否想使用: pdf-toolkit？）",
        "suggestions": ["pdf-toolkit"]
    }
}
```

| code                    | 含义                                                  |
| ----------------------- | ----------------------------------------------------- |
| `NETWORK_ERROR`         | 网络/站点不可用（无缓存可回退）、跨域技能包被拒       |
| `SKILL_NOT_FOUND`       | 索引中不存在该技能（附 `suggestions` 相近名称建议）   |
| `VERSION_NOT_AVAILABLE` | 站点仅提供最新版本，`--version` 指定的版本不可用      |
| `TARGET_NOT_CONFIGURED` | 技能目录仅来自自动识别，需显式指定 agent/skills-dir   |
| `STATE_LOCKED`          | 状态文件被其他进程占用（`state.json.lock`），稍后重试 |
| `INVALID_ARGS`          | 未知命令/选项、参数缺失或非法数值、不安全技能名       |
| `AMBIGUOUS_SKILL`       | 名称归一化后匹配多个不同技能，需使用完整 id           |
| `EXTRACT_ERROR`         | 技能包解压失败（损坏/CRC 不符/超限/含符号链接）       |
| `PACKAGE_INVALID`       | 技能包缺少技能 .md 文件，包无效                       |
| `UNMANAGED_SKILL`       | 卸载目标无安装记录（手工技能），需 `--force` 确认     |
| `UNKNOWN_ERROR`         | 其他未分类错误                                        |

其他契约要点：

- 版本比较采用 semver（`1.10.0 > 1.9.0`，预发布版低于同号正式版）：本地版本不低于站点版本时 `suggested_action=skip`，install/update 跳过，不会静默降级；显式 `--version` 指定旧版本才允许降级。非 semver 版本（如 `unknown`）视为低于任何正式版本，会触发一次更新修正。
- 技能名称大小写不敏感：安装使用索引规范 id，uninstall/inspect 按 state 键与真实目录名解析。
- install/update 成功后按信封 `next_step` 阅读 `skill_md_path`；配置了重载命令（预设或 `GETSKILL_RESTART_CMD`）时会自动执行并回显 `reloaded`（Windows 上通过 shell 执行，`.cmd` shim 可用；命令超时默认 60 秒）。
- 覆盖被本地修改过的技能前会告警，信封 `local_modified=true`（安装时记录内容哈希，按原始字节计算）。
- install/update 信封含 `warnings[]`：跳过符号链接/超大文件、包体积与索引声明不一致等非致命警告，Agent 应检查。
- `update --all` 对「记录在、目录被手动删」的技能报 `missing` 并跳过，不会静默重装；`update --all --dry-run` 与真实执行语义一致（仅 `SKILL_NOT_FOUND` 视为 stale，其他错误按失败预演并非零退出）。
- `status --json` 附 `cli_version` / `lock_pid` / `lock_stale`；`clean --dry-run` 返回 `would_remove` 路径列表而不删除。
- 全局 `--timeout <ms>` 调整网络超时（默认 60000）；`--` 之后全部视为位置参数。信封只增字段不删字段。

仓库内 `skill/getskill/SKILL.md` 提供了可直接发布到注册表的 getskill 工作流技能包，Agent 安装后即可按上述契约自主搜索/安装/更新技能。

### 查看路径与配置

```bash
getskill path      # Agent、技能目录、缓存目录、配置文件、状态文件、站点地址
getskill agents    # 内置 Agent 预设与当前生效项
getskill config get
```

### 清理缓存

```bash
getskill clean
```

清理 ZIP 下载与解压缓存以及技能索引缓存 `skills-index.json`（不影响技能目录中的文件），同时清理旧版本遗留的 `~/.openclaw/skills-cache`。下次搜索会重新下载索引。

```bash
getskill clean --keep-index   # 保留索引缓存，只清理技能包缓存
getskill clean --dry-run      # 预演：列出将删除的路径（--json 返回 would_remove），不执行删除
```

### 帮助与版本

```bash
getskill --help
getskill --version
```

## 安全边界

getskill 会下载并解压远程内容、删除本地目录，因此内置以下防护（3.2.1 起）：

- **同源下载策略**：技能包地址必须与索引源（`base-url`）同源；索引中指向其他域名的包默认拒绝下载（`NETWORK_ERROR`）。确认信任该来源时设置 `GETSKILL_ALLOW_CROSS_ORIGIN=1` 放行。`search`/`show` 仅展示 URL，不受影响。
- **传输安全**：拒绝 HTTPS→HTTP 的降级重定向；非本机回环地址的明文 HTTP 下载会给出告警。响应体积上限：索引等文本 10MB，技能包下载 100MB。
- **解压防护**：zip 单文件解压上限 20MB、总量 200MB（防解压炸弹，`inflateRawSync` 带 `maxOutputLength`）；逐条目 CRC32 校验；拒绝符号链接条目；条目路径段拒绝绝对路径、`..`、盘符/NTFS 备用数据流字符（`:`）、Windows 保留设备名（CON/NUL/COM1-9/LPT1-9）、控制字符与结尾点/空格。
- **技能名校验**：install/update/uninstall/inspect 入口即拒绝不安全名称（`..`、`.`、`CON` 等，`INVALID_ARGS`）；安装/卸载目标路径必须严格位于技能目录下一层（纵深防御）。
- **删除保护**：卸载无安装记录的手工技能目录默认拒绝（`UNMANAGED_SKILL`，需 `--force`）；state 记录中的解压路径（`repoPath`）只有位于缓存根目录或 `~/.getskill` 之内才允许删除。
- **状态文件健壮性**：`state.json` 原子写（tmp+rename）；损坏时告警并备份为 `state.json.corrupt-<时间戳>` 后按空状态继续；残留锁通过 rename 认领回收，避免并发互删。
- **并发安全**：同技能并发安装使用唯一临时 zip/解压目录名，互不覆盖；「复制文件+写 state」整体持锁。
- **重载命令**：仅执行用户显式配置的重载命令（Agent 预设或 `GETSKILL_RESTART_CMD`），默认 60 秒超时（`GETSKILL_RESTART_TIMEOUT_MS` 可调），输出捕获上限 1MB。

## 配置

配置项保存在 `~/.getskill/config.json`（可用 `GETSKILL_HOME` 改变该目录位置）。

```bash
getskill config get                 # 查看全部配置项及其来源
getskill config get <key>           # 查看单个配置项
getskill config set <key> <value>   # 保存配置项
getskill config unset <key>         # 删除配置项，恢复自动识别/默认值
getskill config path                # 显示配置文件路径
getskill config agents              # 列出支持的 Agent
```

可用配置项：

| key          | 说明                                 | 示例                                                  |
| ------------ | ------------------------------------ | ----------------------------------------------------- |
| `base-url`   | 技能索引站点地址                     | `getskill config set base-url https://your-index.com` |
| `agent`      | 目标 Agent（预设名或 `auto`）        | `getskill config set agent cursor`                    |
| `skills-dir` | 任意自定义技能目录（优先于 `agent`） | `getskill config set skills-dir ~/.my-agent/skills`   |
| `cache-dir`  | 下载/解压缓存目录                    | `getskill config set cache-dir ~/.cache/getskill`     |

兼容旧写法：`getskill config set <URL>` 等价于 `getskill config set base-url <URL>`。

`config get` 输出示例：

```
base-url: https://getskill.work
  来源: 默认值，未保存，使用默认站点
agent: claude (Claude Code)
  来源: 配置文件，已保存: claude
skills-dir: C:\Users\<用户名>\.claude\skills
  来源: 配置文件，未单独保存，由 agent 推导
cache-dir: C:\Users\<用户名>\.getskill\cache
  来源: 默认值，未保存，使用默认缓存目录
配置文件: C:\Users\<用户名>\.getskill\config.json
状态文件: C:\Users\<用户名>\.getskill\state.json
```

### 环境变量

| 变量                             | 作用                                              |
| -------------------------------- | ------------------------------------------------- |
| `GETSKILL_BASE_URL`              | 覆盖索引站点地址                                  |
| `GETSKILL_AGENT`                 | 覆盖目标 Agent（预设名或 `auto`）                 |
| `GETSKILL_SKILLS_DIR`            | 覆盖技能目录（任意 Agent）                        |
| `GETSKILL_CACHE_DIR`             | 覆盖缓存目录                                      |
| `GETSKILL_HOME`                  | 覆盖 `~/.getskill`（配置/状态/缓存的根目录）      |
| `GETSKILL_STATE_FILE`            | 覆盖安装记录文件路径                              |
| `GETSKILL_RESTART_CMD`           | 安装/更新后执行的重载命令（任意 Agent 均可用）    |
| `GETSKILL_LOG_LEVEL`             | 日志级别：`silent`/`error`/`warn`/`info`/`debug`  |
| `GETSKILL_STATE_LOCK_TIMEOUT_MS` | 状态文件锁等待超时（默认 5000 毫秒）              |
| `GETSKILL_ALLOW_CROSS_ORIGIN`    | 设为 `1` 允许下载与索引不同源的技能包（默认拒绝） |
| `GETSKILL_RESTART_TIMEOUT_MS`    | 重载命令执行超时（默认 60000 毫秒）               |

Bash / zsh：

```bash
GETSKILL_SKILLS_DIR=~/.my-agent/skills getskill install pdf-toolkit
```

Windows PowerShell：

```powershell
$env:GETSKILL_SKILLS_DIR = "$HOME\.my-agent\skills"; getskill install pdf-toolkit
```

### 优先级

命令行参数（`--agent` / `--skills-dir` / `--cache-dir` / `--base-url`） > 环境变量 > 配置文件 > 自动识别 / 默认值。

## 目录结构

```
~/.getskill/
├── config.json          # 持久化配置
├── state.json           # 安装记录（技能名、版本、安装目录）
└── cache/
    ├── skills-index.json # 技能索引缓存（TTL 1 天）
    └── pdf-toolkit/      # ZIP 解压后的技能包内容

~/.claude/skills/        # 当前 Agent 的技能目录（随 agent/skills-dir 配置变化）
└── pdf-toolkit/
    └── SKILL.md
```
