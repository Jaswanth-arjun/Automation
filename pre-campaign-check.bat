@echo off
echo ========================================
echo   Pre-Campaign Health Check
echo ========================================
echo.

set "ISSUES=0"

echo [1/5] Checking Chrome processes...
tasklist /FI "IMAGENAME eq chrome.exe" 2>NUL | find /I /N "chrome.exe">NUL
if %errorlevel% equ 0 (
    echo     ⚠️  WARNING: Chrome is running
    echo     Recommendation: Close Chrome before starting campaign
    set /a ISSUES+=1
) else (
    echo     ✅ No Chrome processes found
)

echo.
echo [2/5] Checking profile locks...
if exist ".chrome-data\SingletonLock" (
    echo     ⚠️  WARNING: Profile lock detected
    echo     Run: fix-chrome-profile.bat
    set /a ISSUES+=1
) else (
    echo     ✅ No profile locks
)

echo.
echo [3/5] Checking backend server...
netstat -ano | findstr :3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo     ✅ Backend is running on port 3000
) else (
    echo     ⚠️  WARNING: Backend not running
    echo     Start with: npm start
    set /a ISSUES+=1
)

echo.
echo [4/5] Checking frontend server...
netstat -ano | findstr :5173 >nul 2>&1
if %errorlevel% equ 0 (
    echo     ✅ Frontend is running on port 5173
) else (
    echo     ℹ️  INFO: Frontend not running (optional)
    echo     Start with: cd landing-page ^&^& npm run dev
)

echo.
echo [5/5] Checking system resources...
wmic OS get FreePhysicalMemory /Value 2>nul | find "=" >nul
if %errorlevel% equ 0 (
    echo     ✅ System resources available
) else (
    echo     ⚠️  Cannot check system resources
)

echo.
echo ========================================
if %ISSUES% equ 0 (
    echo   ✅ ALL CHECKS PASSED
    echo   System is ready for campaign!
) else (
    echo   ⚠️  FOUND %ISSUES% ISSUE(S)
    echo   Fix warnings before starting campaign
)
echo ========================================
echo.

if %ISSUES% gtr 0 (
    echo Press any key to exit and fix issues...
    pause >nul
    exit /b 1
)

echo Press any key to continue...
pause >nul
exit /b 0
