@echo off
setlocal
title StreamX Autostart Uninstaller
echo =========================================================
echo      StreamX — Disable Windows Autostart
echo =========================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$StartupFolder = [Environment]::GetFolderPath('Startup'); " ^
  "$Path = Join-Path $StartupFolder 'StreamX_Background_Engine.lnk'; " ^
  "if (Test-Path $Path) { Remove-Item $Path -Force; Write-Host '[OK] Removed shortcut from Startup folder.' } else { Write-Host '[INFO] No Startup shortcut found.' }"

echo.
echo Stopping any running StreamX background instances...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$conns = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue; " ^
  "if ($conns) { " ^
  "  $pids = $conns.OwningProcess | Select-Object -Unique; " ^
  "  foreach ($p in $pids) { " ^
  "    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; " ^
  "    Write-Host '[OK] Stopped process PID:' $p; " ^
  "  } " ^
  "} else { Write-Host '[INFO] No process listening on port 8000.' }"

echo.
echo =========================================================
echo [SUCCESS] StreamX autostart has been disabled.
echo =========================================================
pause
