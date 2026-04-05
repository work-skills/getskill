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

- `main.ts`：CLI 入口
- `lib/config.ts`：基础配置与目录路径
- `lib/network.ts`：API 请求与搜索过滤
- `lib/state.ts`：本地状态、文件复制、安装目录管理
- `lib/skill-manager.ts`：安装、更新、卸载等高层流程
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
