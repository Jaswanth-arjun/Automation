#!/usr/bin/env pwsh
# LinkedIn Session Setup Helper

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  LinkedIn Session Setup" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Checking LinkedIn session..." -ForegroundColor Yellow

# Check if Chrome profile exists
if (Test-Path ".chrome-data\Default") {
    Write-Host "✅ Chrome profile exists" -ForegroundColor Green
    
    # Check for cookies (sign of login)
    if (Test-Path ".chrome-data\Default\Cookies") {
        Write-Host "✅ LinkedIn session likely active" -ForegroundColor Green
        Write-Host "`nYou should be ready to run campaigns!`n" -ForegroundColor Green
    } else {
        Write-Host "⚠️  No cookies found - LinkedIn not logged in" -ForegroundColor Red
        Write-Host "`nYou need to login to LinkedIn first.`n" -ForegroundColor Yellow
    }
} else {
    Write-Host "❌ No Chrome profile found" -ForegroundColor Red
    Write-Host "`nYou need to setup LinkedIn session first.`n" -ForegroundColor Yellow
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  How to Setup LinkedIn Session" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Method 1: Use Campaign Launcher (Recommended)" -ForegroundColor Green
Write-Host "  1. Go to dashboard: http://localhost:5173" -ForegroundColor Gray
Write-Host "  2. Click 'Job Tracker' or 'Post Jobs'" -ForegroundColor Gray
Write-Host "  3. Start any campaign" -ForegroundColor Gray
Write-Host "  4. Chrome will open - LOGIN TO LINKEDIN" -ForegroundColor Yellow
Write-Host "  5. After login, stop the campaign" -ForegroundColor Gray
Write-Host "  6. Session is now saved!" -ForegroundColor Green

Write-Host "`nMethod 2: Manual Setup" -ForegroundColor Green
Write-Host "  1. Open Chrome with automation profile:" -ForegroundColor Gray
Write-Host "     chrome.exe --user-data-dir=`"$PWD\.chrome-data`"" -ForegroundColor Cyan
Write-Host "  2. Navigate to https://linkedin.com" -ForegroundColor Gray
Write-Host "  3. Login to your account" -ForegroundColor Gray
Write-Host "  4. Close Chrome" -ForegroundColor Gray
Write-Host "  5. Session is saved!" -ForegroundColor Green

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  After Login" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

Write-Host "Run this script again to verify:" -ForegroundColor Gray
Write-Host "  .\setup-linkedin-session.ps1`n" -ForegroundColor Cyan

Write-Host "Then resume your campaign!`n" -ForegroundColor Green

Write-Host "Press any key to continue..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
