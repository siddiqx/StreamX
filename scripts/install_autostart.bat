@echo off
setlocal
title StreamX Autostart Installer
set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo =========================================================
echo      StreamX — Windows Autostart Setup
echo =========================================================
echo.
echo Installing background service to start automatically on Windows logon...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup_autostart.ps1"

echo.
echo Starting StreamX background service now...
wscript.exe "%ROOT%\scripts\start_streamx_silent.vbs"

echo.
echo =========================================================
echo [SUCCESS] StreamX is now configured to start automatically
echo whenever you turn on or log in to your PC!
echo.
echo Useful utility scripts:
echo  • scripts\status_service.bat   - Check background status and logs
echo  • scripts\stop_service.bat     - Stop background service
echo  • scripts\uninstall_autostart.bat - Disable automatic startup
echo =========================================================
pause
