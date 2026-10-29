$WshShell = New-Object -ComObject WScript.Shell
$StartupFolder = [Environment]::GetFolderPath('Startup')
$rootDir = (Get-Item -Path "$PSScriptRoot\..").FullName
$pythonwPath = Join-Path $rootDir "backend\.venv\Scripts\pythonw.exe"
$serviceScript = Join-Path $rootDir "scripts\run_background_service.py"
$ShortcutPath = Join-Path $StartupFolder "StreamX_Background_Engine.lnk"

$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $pythonwPath
$Shortcut.Arguments = "`"$serviceScript`""
$Shortcut.WorkingDirectory = $rootDir
$Shortcut.Description = "StreamX 24/7 Background Transfer & Ingestion Engine"
$Shortcut.Save()

# Ensure VLC protocol is registered in Windows registry
& $pythonwPath (Join-Path $rootDir "scripts\register_vlc_protocol.py")

Write-Host "[OK] Startup shortcut successfully installed at: $ShortcutPath"
