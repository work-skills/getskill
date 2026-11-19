# GetSkill 构建脚本：打包 skills/<id>/ 为 zip 并生成 data/skills.json
# 用法: powershell -ExecutionPolicy Bypass -File tools/build.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# 技能元数据（新增技能时在此登记）
$meta = @(
  @{ id='pdf-toolkit';    name='PDF 工具箱';   category='文档处理'; version='1.0.0'; author='GetSkill';
     description='PDF 文本提取、合并拆分、页面旋转与加水印，基于 pypdf 的常用操作集合。';
     tags=@('pdf','pypdf','文档') },
  @{ id='excel-report';   name='Excel 报表';   category='数据分析'; version='1.0.0'; author='GetSkill';
     description='读取 CSV/JSON 数据，分组汇总并生成带表头样式、冻结首行的 xlsx 报表。';
     tags=@('excel','pandas','openpyxl','报表') },
  @{ id='web-scraper';    name='网页抓取';     category='网络工具'; version='1.0.0'; author='GetSkill';
     description='抓取静态页面并用 CSS 选择器提取结构化数据，导出 CSV/JSON，内置限速与重试。';
     tags=@('爬虫','requests','bs4') },
  @{ id='image-compress'; name='图片压缩';     category='媒体处理'; version='1.0.0'; author='GetSkill';
     description='批量压缩 PNG/JPG、转换 WebP/AVIF、生成缩略图，基于 Pillow。';
     tags=@('图片','webp','pillow','压缩') }
)

$today = Get-Date -Format 'yyyy-MM-dd'
$skills = @()
foreach ($m in $meta) {
  $dir = Join-Path $root ("skills/" + $m.id)
  if (-not (Test-Path (Join-Path $dir 'SKILL.md'))) { throw "缺少 $dir/SKILL.md" }
  $zip = Join-Path $root ("skills/" + $m.id + ".zip")
  if (Test-Path $zip) { Remove-Item -LiteralPath $zip }
  Compress-Archive -Path $dir -DestinationPath $zip
  $skills += [ordered]@{
    id          = $m.id
    name        = $m.name
    description = $m.description
    category    = $m.category
    tags        = $m.tags
    version     = $m.version
    author      = $m.author
    updated     = $today
    file        = "skills/$($m.id).zip"
    size        = (Get-Item -LiteralPath $zip).Length
    readme      = (Get-Content -LiteralPath (Join-Path $dir 'SKILL.md') -Raw -Encoding UTF8).Trim()
  }
}

$dataDir = Join-Path $root 'data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
$json = ConvertTo-Json -InputObject @{ skills = @($skills) } -Depth 5
[System.IO.File]::WriteAllText((Join-Path $dataDir 'skills.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "已生成 data/skills.json，共 $($skills.Count) 个技能："
$skills | ForEach-Object { Write-Host ("  {0}  {1} bytes" -f $_.file, $_.size) }