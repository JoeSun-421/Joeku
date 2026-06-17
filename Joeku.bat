@echo off
title Joeku
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo [Joeku] Virtual environment not found.
  echo Please run:
  echo   python -m venv .venv
  echo   .venv\Scripts\pip install -e .
  pause
  exit /b 1
)

".venv\Scripts\python.exe" "%~dp0scripts\build_icon.py" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcut.ps1" 2>nul

powershell -NoProfile -Command "try { $r = Invoke-WebRequest 'http://127.0.0.1:8000/api/health' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL%==0 (
  echo [Joeku] Server is running. Opening browser...
  start "" "http://127.0.0.1:8000/?fresh=1"
  exit /b 0
)

echo [Joeku] Starting server...
start /B "" powershell -NoProfile -Command "$u='http://127.0.0.1:8000/?fresh=1'; for($i=0;$i -lt 60;$i++){ try { $r=Invoke-WebRequest 'http://127.0.0.1:8000/api/health' -UseBasicParsing -TimeoutSec 2; if($r.StatusCode -eq 200){ Start-Process $u; exit 0 } } catch {}; Start-Sleep -Seconds 1 }"

".venv\Scripts\python.exe" -m academic_agent.cli web --port 8000
pause