# Re-render docs/banner.png (2560x880) from banner.html with headless Edge. Local only.
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
$html = (Resolve-Path "$PSScriptRoot\banner.html").Path -replace '\', '/'
$profile = Join-Path $env:TEMP 'floatview-banner-edge'
& $edge --headless=new --disable-gpu --hide-scrollbars --user-data-dir=$profile --force-device-scale-factor=2 `
  --window-size=1280,440 --screenshot="$PSScriptRoot\..\banner.png" "file:///$html" | Out-Null
