# StreamX Local Development Server (PC + Mobile LAN Access)
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "          STREAMX LOCAL DEV SERVER" -ForegroundColor Cyan
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

$nodePath = "C:\Users\skdre\AppData\Local\Microsoft\WinGet\Packages\OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe\node-v24.20.0-win-x64"
$env:Path = "$nodePath;" + $env:Path

$localIp = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi*", "Ethernet*" -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
if (-not $localIp) {
    $localIp = "192.168.1.5"
}

Write-Host "🟢 [On this PC]:      " -NoNewline -ForegroundColor Green
Write-Host "http://localhost:5173/" -ForegroundColor Yellow
Write-Host "📱 [On Mobile/Tablet]: " -NoNewline -ForegroundColor Green
Write-Host "http://${localIp}:5173/" -ForegroundColor Yellow
Write-Host ""
Write-Host "Ensure your phone is connected to the SAME Wi-Fi network as this PC." -ForegroundColor Gray
Write-Host "Press Ctrl+C to stop the dev server at any time." -ForegroundColor Gray
Write-Host "===================================================" -ForegroundColor Cyan
Write-Host ""

Set-Location (Join-Path $PSScriptRoot "frontend")
& "$nodePath\npm.cmd" run dev -- --host
