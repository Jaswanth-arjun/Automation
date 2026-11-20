@echo off
echo ========================================
echo   Chrome Profile Lock Fix Tool
echo ========================================
echo.

echo [1/3] Closing all Chrome processes...
taskkill /F /IM chrome.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo     ✅ Chrome processes closed
) else (
    echo     ℹ️ No Chrome processes found
)
timeout /t 2 /nobreak >nul

echo.
echo [2/3] Removing profile locks...
if exist ".chrome-data\Singleton*" (
    rmdir /s /q ".chrome-data\Singleton*" >nul 2>&1
    echo     ✅ Profile locks removed
) else (
    echo     ℹ️ No profile locks found
)

if exist ".chrome-data\lockfile" (
    del /f /q ".chrome-data\lockfile" >nul 2>&1
    echo     ✅ Lockfile removed
)

echo.
echo [3/3] Cleaning temp files...
if exist ".chrome-data\Default\GPUCache" (
    rmdir /s /q ".chrome-data\Default\GPUCache" >nul 2>&1
)
if exist ".chrome-data\ShaderCache" (
    rmdir /s /q ".chrome-data\ShaderCache" >nul 2>&1
)
echo     ✅ Temp files cleaned

echo.
echo ========================================
echo   ✅ Chrome profile is ready!
echo ========================================
echo.
echo You can now:
echo   1. Start the backend: npm start
echo   2. Resume your campaign
echo.
pause
