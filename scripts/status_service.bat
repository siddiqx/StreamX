@echo off
setlocal
title StreamX Background Service Status
set "ROOT=%~dp0.."
cd /d "%ROOT%"

echo =========================================================
echo         StreamX Service Diagnostics & Status
echo =========================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$StartupFolder = [Environment]::GetFolderPath('Startup'); " ^
  "$Path = Join-Path $StartupFolder 'StreamX_Background_Engine.lnk'; " ^
  "if (Test-Path $Path) { " ^
  "  Write-Host '[AUTOSTART] Enabled (Will run on PC boot)' -ForegroundColor Green; " ^
  "} else { " ^
  "  Write-Host '[AUTOSTART] Disabled (Run scripts\install_autostart.bat to enable)' -ForegroundColor Yellow; " ^
  "}"

echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$conns = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue; " ^
  "if ($conns) { " ^
  "  $pids = $conns.OwningProcess | Select-Object -Unique; " ^
  "  foreach ($p in $pids) { " ^
  "    $proc = Get-Process -Id $p -ErrorAction SilentlyContinue; " ^
  "    Write-Host ('[ENGINE] Running (PID: ' + $p + ', Memory: ' + [math]::Round($proc.WorkingSet64/1MB, 1) + ' MB)') -ForegroundColor Green; " ^
  "  } " ^
  "  try { " ^
  "    $res = Invoke-RestMethod -Uri 'http://localhost:8000/health' -TimeoutSec 3; " ^
  "    Write-Host ('[HEALTH] API Online: ' + ($res | ConvertTo-Json -Compress)) -ForegroundColor Cyan; " ^
  "  } catch { " ^
  "    Write-Host '[HEALTH] Port open, waiting for endpoint...' -ForegroundColor Yellow; " ^
  "  } " ^
  "} else { " ^
  "  Write-Host '[ENGINE] Not running (Offline)' -ForegroundColor Red; " ^
  "}"

echo.
if exist "logs\backend.log" (
  echo --- Latest Logs (logs\backend.log) ---
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Content logs\backend.log -Tail 15"
) else (
  echo [INFO] No log file created yet.
)

echo.
echo =========================================================
pause
