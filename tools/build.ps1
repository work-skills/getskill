# GetSkill 构建脚本：扫描 skills/<id>/SKILL.md，打包 zip 并生成 data/skills.json
# 每个技能目录可放 meta.json 覆盖元数据：{ name, category, tags, author, source, version, description }
# 用法: powershell -ExecutionPolicy Bypass -File tools/build.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$skillsRoot = Join-Path $root 'skills'
$today = Get-Date -Format 'yyyy-MM-dd'
$README_CAP = 3000

function Parse-Frontmatter([string]$text) {
  $fm = @{}
  if ($text -match '(?s)^\uFEFF?---\s*\r?\n(.*?)\r?\n---') {
    foreach ($line in ($Matches[1] -split "\r?\n")) {
      if ($line -match '^(name|description):\s*(.+)$') {
        $fm[$Matches[1]] = $Matches[2].Trim().Trim('"').Trim("'")
      } elseif ($line -match '^\s*version:\s*(.+)$') {
        $fm['version'] = $Matches[1].Trim().Trim('"').Trim("'")
      }
    }
  }
  return $fm
}

function Pick($a, $b, $c) { if ($a) { return $a }; if ($b) { return $b }; return $c }

$skills = @()
$dirs = Get-ChildItem $skillsRoot -Directory | Sort-Object Name
foreach ($d in $dirs) {
  $id = $d.Name
  $skillMd = Join-Path $d.FullName 'SKILL.md'
  if (-not (Test-Path $skillMd)) { Write-Host "skip (no SKILL.md): $id"; continue }

  $text = [IO.File]::ReadAllText($skillMd, [Text.Encoding]::UTF8)
  $fm = Parse-Frontmatter $text

  $meta = $null
  $metaFile = Join-Path $d.FullName 'meta.json'
  if (Test-Path $metaFile) {
    $meta = Get-Content $metaFile -Raw -Encoding UTF8 | ConvertFrom-Json
  }

  $name    = Pick ($meta.name) ($fm.name) $id
  $desc    = Pick ($meta.description) ($fm.description) ''
  $cat     = Pick ($meta.category) $null '综合技能'
  $author  = Pick ($meta.author) $null 'GetSkill'
  $version = Pick ($meta.version) ($fm.version) '1.0.0'
  $source  = if ($meta -and $meta.source) { $meta.source } else { $null }
  $tags    = @()
  if ($meta -and $meta.tags) { $tags = @($meta.tags) }

  # 打包 zip
  $zip = Join-Path $skillsRoot ($id + '.zip')
  if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }
  Compress-Archive -Path $d.FullName -DestinationPath $zip | Out-Null

  # readme 预览（截断过长内容，控制 skills.json 体积）
  $readme = $text.Trim()
  if ($readme.Length -gt $README_CAP) {
    $readme = $readme.Substring(0, $README_CAP) + "`n`n...(内容已截断，完整文档请下载技能包查看)"
  }

  $entry = [ordered]@{
    id = $id; name = $name; description = $desc; category = $cat
    tags = $tags; version = $version; author = $author; updated = $today
    file = "skills/$id.zip"; size = (Get-Item -LiteralPath $zip).Length
    readme = $readme
  }
  if ($source) { $entry['source'] = $source }
  $skills += $entry
}

$dataDir = Join-Path $root 'data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
$json = ConvertTo-Json -InputObject @{ skills = @($skills) } -Depth 5
[System.IO.File]::WriteAllText((Join-Path $dataDir 'skills.json'), $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ("已生成 data/skills.json，共 {0} 个技能" -f $skills.Count)