# GetSkill 导入脚本：把 _import/ 下解压的开源技能仓库复制进 skills/ 并生成 meta.json
# 用法: powershell -ExecutionPolicy Bypass -File tools/import.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$imp = Join-Path $root '_import'
$skillsRoot = Join-Path $root 'skills'

# anthropic 官方技能的分类映射
$anthropicCat = @{
  'pdf'='文档处理'; 'docx'='文档处理'; 'xlsx'='文档处理'; 'pptx'='文档处理'; 'doc-coauthoring'='文档处理'
  'canvas-design'='设计创意'; 'algorithmic-art'='设计创意'; 'theme-factory'='设计创意'
  'brand-guidelines'='设计创意'; 'slack-gif-creator'='设计创意'; 'frontend-design'='设计创意'
  'mcp-builder'='开发工具'; 'skill-creator'='开发工具'; 'claude-api'='开发工具'
  'web-artifacts-builder'='开发工具'; 'webapp-testing'='开发工具'
  'internal-comms'='办公协作'; 'academy-guide'='学习教育'; 'discernment-nudge'='效率工具'
}

function Write-Meta($dest, $category, $author, $source, $tags) {
  $meta = [ordered]@{ category = $category; author = $author; source = $source; tags = @($tags) }
  $json = ConvertTo-Json -InputObject $meta -Depth 3
  [IO.File]::WriteAllText((Join-Path $dest 'meta.json'), $json, (New-Object Text.UTF8Encoding($false)))
}

function Import-Dirs($srcParent, $category, $author, $source, $catMap) {
  if (-not (Test-Path $srcParent)) { Write-Host "missing source: $srcParent"; return }
  $count = 0
  foreach ($d in (Get-ChildItem $srcParent -Directory)) {
    if (-not (Test-Path (Join-Path $d.FullName 'SKILL.md'))) { continue }
    $id = $d.Name
    $dest = Join-Path $skillsRoot $id
    if (Test-Path $dest) {
      if (-not (Test-Path (Join-Path $dest 'meta.json'))) {
        $cat = $category
        if ($catMap -and $catMap.ContainsKey($id)) { $cat = $catMap[$id] }
        Write-Meta $dest $cat $author $source @()
        Write-Host "meta only: $id"
      } else { Write-Host "skip existing: $id" }
      continue
    }
    Copy-Item $d.FullName $dest -Recurse -Force
    $cat = $category
    if ($catMap -and $catMap.ContainsKey($id)) { $cat = $catMap[$id] }
    Write-Meta $dest $cat $author $source @()
    $count++
  }
  Write-Host ("imported {0} from {1}" -f $count, $srcParent)
}

# 1) Anthropic 官方技能
Import-Dirs (Join-Path $imp 'anthropic\skills-main\skills') '官方精选' 'Anthropic' 'https://github.com/anthropics/skills' $anthropicCat

# 2) Superpowers（obra）
Import-Dirs (Join-Path $imp 'superpowers\superpowers-main\skills') '开发效率' 'obra / Superpowers' 'https://github.com/obra/superpowers' $null

# 3) Marketing Skills（coreyhaines31）
Import-Dirs (Join-Path $imp 'marketing\marketingskills-main\skills') '营销增长' 'Corey Haines' 'https://github.com/coreyhaines31/marketingskills' $null

# 4) K-Dense 科研技能（递归找 SKILL.md，目录名可能嵌套）
$sci = Join-Path $imp 'scientific'
if (Test-Path $sci) {
  $count = 0
  foreach ($md in (Get-ChildItem $sci -Recurse -Filter SKILL.md)) {
    $srcDir = $md.Directory.FullName
    $id = $md.Directory.Name
    $dest = Join-Path $skillsRoot $id
    if (Test-Path $dest) {
      $id = ($md.Directory.Parent.Name + '-' + $id).ToLower()
      $dest = Join-Path $skillsRoot $id
      if (Test-Path $dest) { Write-Host "skip duplicate: $id"; continue }
    }
    Copy-Item $srcDir $dest -Recurse -Force
    Write-Meta $dest '科研工具' 'K-Dense AI' 'https://github.com/K-Dense-AI/scientific-agent-skills' @()
    $count++
  }
  Write-Host ("imported {0} scientific skills" -f $count)
}

# 5) MiniMax H3 视频技能（SKILL.md 在仓库根目录）
$mm = Join-Path $imp 'minimax\minimax-h3-video-skill-main'
$mmDest = Join-Path $skillsRoot 'minimax-h3-video'
if ((Test-Path $mm) -and (Test-Path $mmDest) -and -not (Test-Path (Join-Path $mmDest 'meta.json'))) {
  Write-Meta $mmDest '视频生成' 'ferguslindholm' 'https://github.com/ferguslindholm/minimax-h3-video-skill' @('视频','MiniMax','提示词')
  Write-Host 'meta only: minimax-h3-video'
}
if ((Test-Path $mm) -and -not (Test-Path $mmDest)) {
  New-Item -ItemType Directory -Path $mmDest | Out-Null
  Copy-Item (Join-Path $mm '*') $mmDest -Recurse -Force
  Write-Meta $mmDest '视频生成' 'ferguslindholm' 'https://github.com/ferguslindholm/minimax-h3-video-skill' @('视频','MiniMax','提示词')
  Write-Host 'imported minimax-h3-video'
}

# 6) 站内原创技能：补 meta.json（保留中文展示名与分类）
$own = @{
  'pdf-toolkit'    = @{ category='文档处理'; name='PDF 工具箱'; tags=@('pdf','pypdf','文档') }
  'excel-report'   = @{ category='数据分析'; name='Excel 报表'; tags=@('excel','pandas','openpyxl','报表') }
  'web-scraper'    = @{ category='网络工具'; name='网页抓取';   tags=@('爬虫','requests','bs4') }
  'image-compress' = @{ category='媒体处理'; name='图片压缩';   tags=@('图片','webp','pillow','压缩') }
}
foreach ($id in $own.Keys) {
  $dest = Join-Path $skillsRoot $id
  if (-not (Test-Path $dest)) { continue }
  $o = $own[$id]
  $meta = [ordered]@{ name=$o.name; category=$o.category; author='GetSkill'; tags=@($o.tags) }
  $json = ConvertTo-Json -InputObject $meta -Depth 3
  [IO.File]::WriteAllText((Join-Path $dest 'meta.json'), $json, (New-Object Text.UTF8Encoding($false)))
}
Write-Host 'done'