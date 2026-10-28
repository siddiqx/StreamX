@echo off
title StreamX Local Development Server
echo ===================================================
echo           STREAMX LOCAL DEV SERVER
echo ===================================================
echo.

set "NODE_DIR=C:\Users\skdre\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.20.0-win-x64"
set "PATH=%NODE_DIR%;%PATH%"

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address" /c:"IP Address"') do (
    set "LOCAL_IP=%%a"
    goto :found_ip
)

:found_ip
set "LOCAL_IP=%LOCAL_IP: =%"

echo [PC Browser]     http://localhost:5173/
if not "%LOCAL_IP%"=="" (
    echo [Phone/Tablet]   http://%LOCAL_IP%:5173/
)
echo.
echo Make sure your phone is connected to the SAME Wi-Fi network as this PC!
echo Press Ctrl+C in this terminal to stop the server anytime.
echo ===================================================
echo.

cd /d "%~dp0frontend"
call "%NODE_DIR%\npm.cmd" run dev -- --host
pause
