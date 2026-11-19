# 轻量导入 K-Dense-AI/scientific-agent-skills：仅下载各技能的 SKILL.md（纯文本）
# 用法: powershell -ExecutionPolicy Bypass -File tools/import-scientific.ps1
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$skillsRoot = Join-Path $root 'skills'
$repo = 'K-Dense-AI/scientific-agent-skills'
$sourceUrl = "https://github.com/$repo"

Write-Host 'fetching repo tree...'
$tree = Invoke-RestMethod "https://api.github.com/repos/$repo/git/trees/main?recursive=1" -Headers @{ 'User-Agent' = 'getskill-import' }
$mdPaths = $tree.tree | Where-Object { $_.type -eq 'blob' -and $_.path -match '(^|/)SKILL\.md$' } | ForEach-Object { $_.path }
Write-Host ("found {0} SKILL.md files" -f $mdPaths.Count)

$imported = 0; $skipped = 0; $failed = 0
foreach ($p in $mdPaths) {
  $parts = $p -split '/'
  $id = ($parts[-2]).ToLower()
  $dest = Join-Path $skillsRoot $id
  if (Test-Path $dest) { $skipped++; continue }
  try {
    $raw = Invoke-WebRequest "https://cdn.jsdelivr.net/gh/$repo@main/$p" -UseBasicParsing -TimeoutSec 30
    New-Item -ItemType Directory -Path $dest | Out-Null
    [IO.File]::WriteAllText((Join-Path $dest 'SKILL.md'), $raw.Content, (New-Object Text.UTF8Encoding($false)))
    $meta = [ordered]@{ category='科研工具'; author='K-Dense AI'; source=$sourceUrl; tags=@('科研','科学计算') }
    [IO.File]::WriteAllText((Join-Path $dest 'meta.json'), (ConvertTo-Json $meta -Depth 3), (New-Object Text.UTF8Encoding($false)))
    $imported++
    if ($imported % 25 -eq 0) { Write-Host "imported $imported ..." }
  } catch {
    $failed++
    Write-Host "failed: $p - $($_.Exception.Message)"
    if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }
  }
}
Write-Host ("done: imported={0} skipped={1} failed={2}" -f $imported, $skipped, $failed)