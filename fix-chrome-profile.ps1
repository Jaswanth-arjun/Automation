#!/usr/bin/env pwsh
# Chrome Profile Lock Fix Tool - PowerShell Version

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Chrome Profile Lock Fix Tool" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "[1/3] Closing all Chrome processes..." -ForegroundColor Yellow
$chromeProcesses = Get-Process chrome -ErrorAction SilentlyContinue
if ($chromeProcesses) {
    Stop-Process -Name chrome -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "    ✅ Chrome processes closed" -ForegroundColor Green
} else {
    Write-Host "    ℹ️  No Chrome processes found" -ForegroundColor Gray
}

Write-Host "`n[2/3] Removing profile locks..." -ForegroundColor Yellow
$locksRemoved = $false

if (Test-Path ".chrome-data\SingletonLock") {
    Remove-Item ".chrome-data\Singleton*" -Recurse -Force -ErrorAction SilentlyContinue
    $locksRemoved = $true
}

if (Test-Path ".chrome-data\lockfile") {
    Remove-Item ".chrome-data\lockfile" -Force -ErrorAction SilentlyContinue
    $locksRemoved = $true
}

if ($locksRemoved) {
    Write-Host "    ✅ Profile locks removed" -ForegroundColor Green
} else {
    Write-Host "    ℹ️  No profile locks found" -ForegroundColor Gray
}

Write-Host "`n[3/3] Cleaning temp files..." -ForegroundColor Yellow
if (Test-Path ".chrome-data\Default\GPUCache") {
    Remove-Item ".chrome-data\Default\GPUCache" -Recurse -Force -ErrorAction SilentlyContinue
}
if (Test-Path ".chrome-data\ShaderCache") {
    Remove-Item ".chrome-data\ShaderCache" -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Host "    ✅ Temp files cleaned" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  ✅ Chrome profile is ready!" -ForegroundColor Green
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "You can now:" -ForegroundColor White
Write-Host "  1. Start the backend: npm start" -ForegroundColor Gray
Write-Host "  2. Resume your campaign`n" -ForegroundColor Gray

Write-Host "Press any key to continue..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
