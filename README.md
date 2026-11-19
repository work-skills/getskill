# GetSkill — AI 技能下载站

纯静态站点，部署于 Cloudflare Pages：https://getskill.work

## 目录结构

```
├─ index.html          # 首页（技能列表 + 搜索 + 分类筛选）
├─ skill.html          # 技能详情页（?id=xxx 前端渲染）
├─ css/style.css
├─ js/app.js           # 拉取 skills.json、搜索、渲染
├─ data/skills.json    # 技能元数据（由构建脚本生成）
├─ skills/             # 技能目录：<id>/SKILL.md 源文件 + <id>.zip 下载包
├─ tools/build.ps1     # 打包 zip 并生成 skills.json
├─ tools/serve.js      # 本地预览服务器
├─ _headers            # Cloudflare Pages 缓存/安全头
└─ _redirects          # 重定向规则（可选）
```

## 新增技能

1. 创建 `skills/<id>/SKILL.md`（含 YAML frontmatter：name、description）
2. 在 `tools/build.ps1` 的 `$meta` 中登记元数据
3. 运行 `powershell -ExecutionPolicy Bypass -File tools/build.ps1`
4. 提交并推送，Cloudflare Pages 自动部署

## 本地预览

```bash
node tools/serve.js   # http://localhost:8099
```

## Cloudflare Pages 部署设置

- Framework preset: **None**
- Build command: `exit 0`
- Build output directory: `.`
- Custom Domains: `getskill.work` / `www.getskill.work`（DNS 自动添加 CNAME，免费 SSL）