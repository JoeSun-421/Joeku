@echo off
setlocal enabledelayedexpansion
title Joeku
cd /d "%~dp0"

set "PYTHON=python"
set "VENV_PY=.venv\Scripts\python.exe"
set "VENV_PY_W=.venv\Scripts\pythonw.exe"

echo [Joeku] Checking environment...

:: Try to find a working Python
where uv >nul 2>&1 && set "HAS_UV=1" || set "HAS_UV=0"

if not exist "%VENV_PY%" (
    echo [Joeku] Creating virtual environment (first time setup)...
    
    if "%HAS_UV%"=="1" (
        echo [Joeku] Using uv (recommended)...
        uv sync --quiet
        if errorlevel 1 (
            echo [Joeku] uv sync failed, falling back to venv...
            %PYTHON% -m venv .venv
            call .venv\Scripts\activate.bat
            pip install -e . --quiet
        )
    ) else (
        %PYTHON% -m venv .venv
        if errorlevel 1 (
            echo [Joeku] Failed to create venv. Please install Python 3.10+ and try again.
            pause
            exit /b 1
        )
        call .venv\Scripts\activate.bat
        echo [Joeku] Installing dependencies (this may take a minute on first run)...
        pip install -e . --quiet
    )
)

:: Refresh paths after possible creation
if exist "%VENV_PY%" (
    set "VENV_PY=.venv\Scripts\python.exe"
    set "VENV_PY_W=.venv\Scripts\pythonw.exe"
) else (
    echo [Joeku] Could not find venv python.
    pause
    exit /b 1
)

:: Build icon + shortcut (best effort)
"%VENV_PY%" "%~dp0scripts\build_icon.py" 2>nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-shortcut.ps1" 2>nul

echo [Joeku] Launching desktop app...

:: Prefer pythonw.exe to avoid showing a console window
if exist "%VENV_PY_W%" (
    start "" "%VENV_PY_W%" -m academic_agent.cli desktop
) else (
    "%VENV_PY%" -m academic_agent.cli desktop
)

:: Do not pause here when launched from shortcut / double-click
exit /b 0