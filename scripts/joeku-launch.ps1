# Joeku launcher - detect running service, avoid port 8000 conflict
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "[Joeku] venv not found: $python"
    Write-Host "[Joeku] Run: python -m venv .venv ; .venv\Scripts\pip install -e ."
    exit 1
}

Write-Host "[Joeku] Starting desktop app (recommended)..."
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $python
$psi.Arguments = "-m academic_agent.cli desktop"
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $false
$proc = [System.Diagnostics.Process]::Start($psi)
$proc.WaitForExit()
exit $proc.ExitCode