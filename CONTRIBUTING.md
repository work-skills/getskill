# Contributing to GetSkill

感谢你为 `getskill` 做贡献。

## 本地开发

### 前置条件

- Node.js 18+（用于 lint / Vitest / coverage）
- Git 命令行工具

### 安装依赖

```bash
npm install
```

### 常用命令

```bash
npm run lint        # ESLint + Prettier 检查
npm test            # 单元测试 + smoke verify
npm run test:flow   # 联机搜索/下载流程验证
npm run coverage    # 生成覆盖率报告
npm run format      # 自动格式化
```

## 项目结构

- `main.ts`：CLI 入口（含全局参数 `--agent` / `--skills-dir` / `--cache-dir` / `--base-url`）
- `lib/config.ts`：Agent 预设与自动识别、持久化配置（`~/.getskill/config.json`）、目录路径解析
- `lib/network.ts`：静态索引请求、搜索过滤、ZIP 包下载
- `lib/state.ts`：本地安装记录（含旧版状态文件迁移）、文件复制、目录管理与失效记录清理
- `lib/skill-manager.ts`：安装、更新、卸载等高层流程
- `lib/unzip.ts`：内置 ZIP 解析与解压
- `tests/`：Vitest TypeScript 单元测试

详细说明见 [`docs/architecture.md`](docs/architecture.md)。

## 提交流程建议

1. 新建分支并保持改动聚焦
2. 提交前运行：
    ```bash
    npm run lint
    npm test
    ```
3. 在 PR 描述中写清楚：
    - 改了什么
    - 为什么改
    - 如何验证

## 发布检查清单

```bash
npm run lint
npm test
npm pack
```

确认通过后再执行 `npm publish`。
