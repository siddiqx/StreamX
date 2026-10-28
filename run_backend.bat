@echo off
title StreamX Local Backend API Server
echo ===================================================
echo          STREAMX LOCAL BACKEND SERVER
echo ===================================================
echo.
echo Running FastAPI backend on http://localhost:8000
echo.

cd /d "%~dp0backend"
call ".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
pause
