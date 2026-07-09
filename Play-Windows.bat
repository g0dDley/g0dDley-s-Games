@echo off
title Zombies From Mars
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo  ============================================================
    echo   Zombies From Mars needs Node.js to run, and it isn't
    echo   installed on this computer yet.
    echo.
    echo   1. A download page will open in your browser.
    echo   2. Download and run the installer ^(pick the "LTS" version^).
    echo   3. Come back here and double-click Play-Windows.bat again.
    echo  ============================================================
    echo.
    start https://nodejs.org
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Setting up the game the first time you play - this takes a few seconds...
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo Setup failed. Scroll up to see the error above.
        pause
        exit /b 1
    )
)

echo.
echo Starting Zombies From Mars...
echo Your browser will open automatically. Close this window to stop the game.
echo.
call npm start
pause
