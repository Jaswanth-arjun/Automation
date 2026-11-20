#!/usr/bin/env pwsh
# Pre-Campaign Health Check - PowerShell Version

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Pre-Campaign Health Check" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$issues = 0

Write-Host "[1/5] Checking Chrome processes..." -ForegroundColor Yellow
$chromeRunning = Get-Process chrome -ErrorAction SilentlyContinue
if ($chromeRunning) {
    Write-Host "    ⚠️  WARNING: Chrome is running" -ForegroundColor Red
    Write-Host "    Recommendation: Close Chrome before starting campaign" -ForegroundColor Gray
    $issues++
} else {
    Write-Host "    ✅ No Chrome processes found" -ForegroundColor Green
}

Write-Host "`n[2/5] Checking profile locks..." -ForegroundColor Yellow
if (Test-Path ".chrome-data\SingletonLock") {
    Write-Host "    ⚠️  WARNING: Profile lock detected" -ForegroundColor Red
    Write-Host "    Run: .\fix-chrome-profile.ps1" -ForegroundColor Gray
    $issues++
} else {
    Write-Host "    ✅ No profile locks" -ForegroundColor Green
}

Write-Host "`n[3/5] Checking backend server..." -ForegroundColor Yellow
$backendRunning = Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue
if ($backendRunning) {
    Write-Host "    ✅ Backend is running on port 3000" -ForegroundColor Green
} else {
    Write-Host "    ⚠️  WARNING: Backend not running" -ForegroundColor Red
    Write-Host "    Start with: npm start" -ForegroundColor Gray
    $issues++
}

Write-Host "`n[4/5] Checking frontend server..." -ForegroundColor Yellow
$frontendRunning = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
if ($frontendRunning) {
    Write-Host "    ✅ Frontend is running on port 5173" -ForegroundColor Green
} else {
    Write-Host "    ℹ️  INFO: Frontend not running (optional)" -ForegroundColor Gray
    Write-Host "    Start with: cd landing-page; npm run dev" -ForegroundColor Gray
}

Write-Host "`n[5/5] Checking system resources..." -ForegroundColor Yellow
$memory = Get-CimInstance Win32_OperatingSystem
$freeMemoryGB = [math]::Round($memory.FreePhysicalMemory / 1MB, 2)
if ($freeMemoryGB -gt 2) {
    Write-Host "    ✅ Free memory: $freeMemoryGB GB" -ForegroundColor Green
} else {
    Write-Host "    ⚠️  WARNING: Low memory: $freeMemoryGB GB" -ForegroundColor Red
    Write-Host "    Recommendation: Close unnecessary applications" -ForegroundColor Gray
    $issues++
}

Write-Host "`n========================================" -ForegroundColor Cyan
if ($issues -eq 0) {
    Write-Host "  ✅ ALL CHECKS PASSED" -ForegroundColor Green
    Write-Host "  System is ready for campaign!" -ForegroundColor Green
} else {
    Write-Host "  ⚠️  FOUND $issues ISSUE(S)" -ForegroundColor Red
    Write-Host "  Fix warnings before starting campaign" -ForegroundColor Yellow
}
Write-Host "========================================`n" -ForegroundColor Cyan

if ($issues -gt 0) {
    Write-Host "Press any key to exit and fix issues..." -ForegroundColor Yellow
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit 1
}

Write-Host "Press any key to continue..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
exit 0
