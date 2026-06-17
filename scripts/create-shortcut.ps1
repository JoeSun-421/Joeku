# Desktop shortcut — Joeku.vbs + root Joeku.ico (icon cache friendly)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$python = Join-Path $root ".venv\Scripts\python.exe"
$iconIco = Join-Path $root "Joeku.ico"
$launcher = Join-Path $root "Joeku.vbs"
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Joeku.lnk"

if (-not (Test-Path $python)) {
    throw "Python venv not found: $python"
}

& $python (Join-Path $root "scripts\build_icon.py")
if (-not (Test-Path $iconIco)) {
    throw "Icon build failed: $iconIco"
}

Get-ChildItem $desktop -Filter "Joeku*.lnk" -ErrorAction SilentlyContinue | Remove-Item -Force

$wsh = New-Object -ComObject WScript.Shell
$sc = $wsh.CreateShortcut($shortcutPath)
$sc.TargetPath = "$env:SystemRoot\System32\wscript.exe"
$sc.Arguments = "`"$launcher`""
$sc.WorkingDirectory = $root
$sc.WindowStyle = 1
$sc.IconLocation = "$iconIco,0"
$sc.Description = "Joeku - Local academic writing agent"
$sc.Save()

Write-Host "Shortcut: $shortcutPath"
Write-Host "Launcher: $launcher"
Write-Host "Icon: $iconIco"