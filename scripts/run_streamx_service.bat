@echo off
setlocal
title StreamX Background Service Engine
set "ROOT=%~dp0.."
cd /d "%ROOT%"

if not exist "logs" mkdir "logs"

:: Non-interactive wait on boot for Wi-Fi and network adapters
ping -n 6 127.0.0.1 >nul

:service_loop
echo [%date% %time%] [INFO] Starting StreamX Ingestion and Streaming Engine... >> "logs\backend.log"
cd /d "%ROOT%\backend"
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 >> "..\logs\backend.log" 2>&1
echo [%date% %time%] [WARN] StreamX Backend process terminated with code %errorlevel%. Auto-restarting in 5s... >> "..\logs\backend.log"
ping -n 6 127.0.0.1 >nul
goto service_loop
