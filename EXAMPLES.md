# GetSkill 使用示例

## 场景 1: 首次使用（未安装 Git）

### Windows 用户

```bash
# 第一次运行安装命令
$ getskill install commit-helper

检测到系统未安装 Git，正在准备安装...

Windows 系统检测到未安装 Git
正在下载 Git 安装程序...

下载进度: 100%
下载完成！

Git 安装程序已下载到: C:\Users\...\AppData\Local\Temp\git-installer.exe

正在启动安装程序，请按照提示完成安装...
安装完成后，请重新运行此命令。

# Git 安装完成后，再次运行
$ getskill install commit-helper

下载技能: commit-helper...
克隆仓库: https://getskill.work/skills/commit-helper.git...
仓库克隆成功: C:\Users\...\\.openclaw\skills-cache\commit-helper

技能已安装到 skills 目录:
  - C:\Users\...\.openclaw\skills\commit-helper

Git 仓库缓存: C:\Users\...\.openclaw\skills-cache\commit-helper
```

### macOS 用户

```bash
$ getskill install commit-helper

检测到系统未安装 Git，正在准备安装...

macOS 系统检测到未安装 Git
请使用以下命令安装 Git:

  brew install git

如果未安装 Homebrew，请访问: https://brew.sh/

# 安装 Git
$ brew install git

# 再次运行
$ getskill install commit-helper
✓ 安装成功
```

### Linux 用户

```bash
$ getskill install commit-helper

检测到系统未安装 Git，正在准备安装...

Linux 系统检测到未安装 Git
请使用系统包管理器安装 Git:

  Ubuntu/Debian: sudo apt-get install git
  CentOS/RHEL:   sudo yum install git
  Fedora:        sudo dnf install git
  Arch:          sudo pacman -S git

# Ubuntu/Debian 用户
$ sudo apt-get install git

# 再次运行
$ getskill install commit-helper
✓ 安装成功
```

## 场景 2: 已安装 Git（正常使用）

```bash
# 搜索技能
$ getskill search commit

找到 3 个技能:

1. commit-helper
   描述: 帮助生成规范的 git commit 信息
  Git: https://getskill.work/skills/commit-helper.git

2. commit-lint
   描述: 检查 commit 信息是否符合规范
  Git: https://getskill.work/skills/commit-lint.git

# 安装技能
$ getskill install commit-helper

下载技能: commit-helper...
克隆仓库: https://getskill.work/skills/commit-helper.git...
仓库克隆成功: ~/.openclaw/skills-cache/commit-helper
已复制技能目录: ~/.openclaw/skills-cache/commit-helper -> ~/.openclaw/skills/commit-helper

技能已安装到 skills 目录:
  - ~/.openclaw/skills/commit-helper

Git 仓库缓存: ~/.openclaw/skills-cache/commit-helper

# 列出已安装的技能
$ getskill list

本地已安装的技能 (1):
1. commit-helper

# 更新技能
$ getskill update commit-helper

正在更新技能: commit-helper...
Git 仓库已更新
Already up to date.
已复制技能目录: ~/.openclaw/skills-cache/commit-helper -> ~/.openclaw/skills/commit-helper

技能已更新到 skills 目录:
  - ~/.openclaw/skills/commit-helper

# 查看目录路径
$ getskill path

技能目录: ~/.openclaw/skills
缓存目录: ~/.openclaw/skills-cache

# 清理缓存
$ getskill clean

已清理缓存目录: ~/.openclaw/skills-cache
```

## 场景 3: 编程接口使用

```javascript
const getskill = require('@workskills/getskill');

(async () => {
    try {
        // 设置自定义 API 地址（可选）
        getskill.setBaseUrl('https://getskill.work');

        // 查看当前 API 地址
        console.log('当前 API:', getskill.getBaseUrl());

        // 检查 Git 是否已安装
        const isGitInstalled = await getskill.checkGitInstalled();
        console.log('Git 已安装:', isGitInstalled);

        if (!isGitInstalled) {
            console.log('正在引导安装 Git...');
            await getskill.ensureGitInstalled();
        }

        // 搜索技能
        const results = await getskill.searchSkills('commit');
        console.log('搜索结果:', results);

        // 安装技能
        const result = await getskill.downloadSkill('skills/commit-helper');
        console.log('安装成功:', result.files);

        // 更新技能
        await getskill.updateSkill('commit-helper');
        console.log('更新成功');

        // 列出本地技能
        const localSkills = getskill.listLocalSkills();
        console.log('本地技能:', localSkills);
    } catch (error) {
        console.error('错误:', error.message);
    }
})();
```

## 场景 4: 批量安装技能

```bash
# 创建脚本 install-skills.sh
#!/bin/bash

skills=(
    "commit-helper"
    "code-review"
    "test-generator"
    "doc-writer"
)

for skill in "${skills[@]}"; do
    echo "正在安装: $skill"
    getskill install "$skill"
    echo "---"
done

# 运行脚本
$ chmod +x install-skills.sh
$ ./install-skills.sh
```

## 场景 5: 错误处理

```bash
# 技能不存在
$ getskill install non-existent-skill
下载技能: non-existent-skill...
下载技能失败: 技能不存在: non-existent-skill
执行命令时出错: 技能不存在: non-existent-skill

# Git URL 无效
$ getskill install invalid-git-skill
下载技能: invalid-git-skill...
克隆仓库: https://getskill.work/skills/invalid-git-skill.git...
克隆失败: fatal: repository 'https://getskill.work/skills/invalid-git-skill.git/' not found
下载技能失败: Command failed: git clone...
执行命令时出错: Command failed: git clone...

# 网络问题
$ getskill search commit
搜索失败: 请求超时，请稍后重试
未找到相关技能
提示: 尝试使用不同的关键词，或访问 https://getskill.work 查看所有可用技能
```

## 场景 6: 配置自定义 API 地址

```bash
# 查看当前 API 地址
$ getskill config get
当前 BASE_URL: https://getskill.work

# 设置自定义 API 地址
$ getskill config set https://custom-api.example.com
BASE_URL 已设置为: https://custom-api.example.com

# 通过环境变量设置
$ GETSKILL_BASE_URL=https://another-api.com getskill search commit
找到 2 个技能:
...

# 验证配置
$ getskill config get
当前 BASE_URL: https://custom-api.example.com
```

## 场景 7: 目录结构查看

```bash
# 安装几个技能后查看目录结构
$ tree ~/.openclaw

~/.openclaw/
├── skills/
│   ├── commit-helper/
│   ├── code-review/
│   └── test-generator/
└── skills-cache/
    ├── commit-helper/
    │   ├── commit-helper.md
    │   ├── README.md
    │   └── .git/
    ├── code-review/
    │   ├── code-review.md
    │   ├── README.md
    │   └── .git/
    └── test-generator/
        ├── test-generator.md
        ├── README.md
        └── .git/
```

## 常见问题

### Q: Git 安装后仍提示未安装？

A: Windows 用户需要重启终端或系统，以便环境变量生效。

### Q: 如何卸载技能？

A: 直接删除 `~/.openclaw/skills/` 目录下的对应技能目录即可。

### Q: 缓存目录可以删除吗？

A: 可以使用 `getskill clean` 清理缓存，下次更新技能时会重新克隆。

### Q: 如何手动指定 Git 路径？

A: 确保 `git` 命令在系统 PATH 中，或修改 `~/.bashrc` / `~/.zshrc` 添加 Git 路径。
