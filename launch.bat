@echo off
REM Chrome launcher for Windows
setlocal

set "DIR=%~dp0"
REM Shells hosted by Electron apps (VS Code etc.) may export this, which makes
REM Electron run main.js as plain Node and exit immediately.
set "ELECTRON_RUN_AS_NODE="
pushd "%DIR%" >nul

set "PACKAGED_EXE=%DIR%dist\win-unpacked\Chrome.exe"
set "ELECTRON_BIN=%DIR%node_modules\electron\dist\electron.exe"

if exist "%PACKAGED_EXE%" (
    start "" "%PACKAGED_EXE%"
    popd >nul
    exit /b 0
)

if not exist "%ELECTRON_BIN%" (
    echo Installing Chrome dependencies. This can take a few minutes...
    call npm install
    if errorlevel 1 (
        echo.
        echo Failed to install dependencies. Check your internet connection and Node.js install.
        pause
        popd >nul
        exit /b 1
    )
)

start "" /d "%DIR%" "%ELECTRON_BIN%" "%DIR%"
popd >nul
