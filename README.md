# GetSkill

OpenClaw 技能管理工具 - 从 getskill.work 搜索、下载和更新技能文件

## 功能特性

- 🔍 从 getskill.work API 搜索技能
- 📥 通过 Git 克隆技能仓库
- 🔄 通过 Git pull 更新已安装的技能
- 🛠️ 自动检测并引导安装 Git（如未安装）
- 📂 跨平台支持（Windows/macOS/Linux）
- 💾 自动管理技能文件到 OpenClaw skills 目录
- ⚙️ 支持自定义 API 地址

## 工作原理

1. **搜索**: 从 `getskill.work` API 获取技能列表，包含 Git 仓库地址
2. **安装**: 使用 `git clone` 克隆技能仓库到缓存目录
3. **复制**: 将仓库目录（排除 `.git`）复制到 OpenClaw skills 目录
4. **更新**: 使用 `git pull` 更新仓库，并重新复制技能目录

## 目录结构

```
~/.openclaw/
├── skills/          # OpenClaw 技能目录
│   ├── skill1/
│   └── skill2/
└── skills-cache/    # Git 仓库缓存
    ├── skill1/
    └── skill2/
```

### 平台路径

- **Windows**: `%USERPROFILE%\.openclaw\skills`
- **macOS**: `~/.openclaw/skills`
- **Linux**: `~/.openclaw/skills`

## 安装

### 全局安装（推荐）

```bash
npm install -g @workskills/getskill
```

安装后，可以在任何位置使用 `getskill` 命令。

### 本地安装

```bash
npm install @workskills/getskill
```

本地安装后，可以通过 npx 运行：

```bash
npx getskill search <关键词>
```

### 从源码安装

```bash
git clone https://github.com/work-skills/getskill.git
cd getskill
npm install
npm link
```

## 使用方法

### 搜索技能

```bash
getskill search <关键词>
```

示例输出：
```
找到 3 个技能:

1. commit-helper
   描述: 帮助生成规范的 git commit 信息
   Git: https://getskill.work/skills/commit-helper.git

2. code-review
   描述: AI 代码审查助手
   Git: https://getskill.work/skills/code-review.git
```

### 安装技能

```bash
getskill install <技能名称>
```

示例：
```bash
getskill install commit-helper
```

操作流程：
1. 执行 `git clone` 到 `~/.openclaw/skills-cache/commit-helper`
2. 将整个技能目录复制到 `~/.openclaw/skills/commit-helper`

### 更新技能

```bash
getskill update <技能名称>
```

示例：
```bash
getskill update commit-helper
```

操作流程：
1. 进入缓存目录 `~/.openclaw/skills-cache/commit-helper`
2. 执行 `git pull`
3. 重新复制最新的技能目录

### 列出本地技能

```bash
getskill list
```

返回 `~/.openclaw/skills` 下的技能目录名称列表。

### 查看目录路径

```bash
getskill path
```

### 清理缓存

```bash
getskill clean
```

清理所有 Git 仓库缓存（不影响 skills 目录中的文件）

### 配置 API 地址

查看当前 API 地址：
```bash
getskill config get
```

设置自定义 API 地址：
```bash
getskill config set https://your-custom-api.com
```

通过环境变量设置：
```bash
GETSKILL_BASE_URL=https://your-custom-api.com getskill search keyword
```

## API 接口规范

### 搜索 API

```
GET https://getskill.work/api/v1/repos/search?sort=updated&order=desc&q=<关键词>&page=1&limit=20
```

响应格式：
```json
{
  "ok": true,
  "data": [
    {
      "id": 1,
      "full_name": "skills/commit-helper",
      "description": "帮助生成规范的 git commit 信息",
      "html_url": "https://getskill.work/skills/commit-helper",
      "clone_url": "https://getskill.work/skills/commit-helper.git"
    }
  ]
}
```

## 编程接口

```javascript
const getskill = require('@workskills/getskill');

// 设置自定义 API 地址（可选）
getskill.setBaseUrl('https://your-custom-api.com');

// 搜索技能
const results = await getskill.searchSkills('commit');

// 安装技能
const result = await getskill.downloadSkill('skills/commit-helper');
console.log(result.files); // 已复制的技能目录列表

// 更新技能
await getskill.updateSkill('commit-helper');

// 列出本地技能
const skills = getskill.listLocalSkills();

// 获取目录
const skillsDir = getskill.getSkillsDirectory();
const cacheDir = getskill.getSkillsCacheDirectory();

// 获取当前 API 地址
const baseUrl = getskill.getBaseUrl();
```

## 技能仓库规范

技能 Git 仓库应包含：
- 一个或多个 `.md` 技能文件（非 README）
- 可选的 `README.md` 说明文档
- 可选的示例代码或配置文件

示例结构：
```
commit-helper/
├── commit-helper.md    # 技能文件（仓库目录会被整体复制）
├── README.md           # 说明文档（会随目录复制）
└── examples/           # 示例（会随目录复制）
```

## 依赖

- Node.js >= 12
- Git 命令行工具（如未安装，程序会自动引导安装）

## Git 自动检测与安装

首次运行 `install` 或 `update` 命令时，程序会自动检测系统是否已安装 Git：

### Windows
- **自动下载**: 自动下载 Git 安装程序并启动安装向导
- **手动安装**: 如果自动下载失败，会提示访问 https://git-scm.com/download/win

### macOS
- 提示使用 Homebrew 安装：`brew install git`
- 如未安装 Homebrew，会提示访问 https://brew.sh/

### Linux
- 提示使用系统包管理器安装：
  - Ubuntu/Debian: `sudo apt-get install git`
  - CentOS/RHEL: `sudo yum install git`
  - Fedora: `sudo dnf install git`
  - Arch: `sudo pacman -S git`

## 许可证

MIT

## 作者

workskills.store