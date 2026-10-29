@echo off
setlocal
title Stop StreamX Background Service
echo =========================================================
echo         Stopping StreamX Background Service
echo =========================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$conns = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue; " ^
  "if ($conns) { " ^
  "  $pids = $conns.OwningProcess | Select-Object -Unique; " ^
  "  foreach ($p in $pids) { " ^
  "    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; " ^
  "    Write-Host '[OK] Stopped StreamX backend PID:' $p -ForegroundColor Green; " ^
  "  } " ^
  "} else { " ^
  "  Write-Host '[INFO] No StreamX backend process found on port 8000.' -ForegroundColor Yellow; " ^
  "}"

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Get-WmiObject Win32_Process | Where-Object { $_.CommandLine -like '*run_streamx_service.bat*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Host '[OK] Stopped runner loop PID:' $_.ProcessId }"

echo.
echo =========================================================
echo [DONE] StreamX background service stopped.
echo =========================================================
pause
