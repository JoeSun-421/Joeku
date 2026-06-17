# Joeku launcher - detect running service, avoid port 8000 conflict
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$python = Join-Path $root ".venv\Scripts\python.exe"
$port = 8000
$url = "http://127.0.0.1:$port"

function Test-JoekuHealth {
    try {
        $r = Invoke-WebRequest "$url/api/health" -UseBasicParsing -TimeoutSec 3
        return $r.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-PortListening {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

if (-not (Test-Path $python)) {
    Write-Host "[Joeku] venv not found: $python"
    Write-Host "[Joeku] Run: python -m venv .venv ; .venv\Scripts\pip install -e ."
    exit 1
}

if (Test-JoekuHealth) {
    Write-Host "[Joeku] Server already running. Opening browser."
    Start-Process "$url/?fresh=1"
    exit 0
}

if (Test-PortListening) {
    Write-Host "[Joeku] Port $port is in use but health check failed."
    Write-Host "[Joeku] Close other Joeku windows, then retry. Opening browser anyway."
    Start-Process "$url/?fresh=1"
    exit 2
}

Write-Host "[Joeku] Starting server..."
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $python
$psi.Arguments = "-m academic_agent.cli web --port $port"
$psi.WorkingDirectory = $root
$psi.UseShellExecute = $false
$proc = [System.Diagnostics.Process]::Start($psi)

for ($i = 0; $i -lt 45; $i++) {
    if (Test-JoekuHealth) {
        Write-Host "[Joeku] Server ready."
        Start-Process "$url/?fresh=1"
        $proc.WaitForExit()
        exit $proc.ExitCode
    }
    Start-Sleep -Seconds 1
}

Write-Host "[Joeku] Server start timed out."
$proc | Stop-Process -Force -ErrorAction SilentlyContinue
exit 1