@echo off
echo ========================================
echo   HAMZOOH Auto Apply - Quick Test
echo ========================================
echo.

REM Check if backend is running
curl -s http://localhost:3000/api/health >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Backend not running!
    echo.
    echo Starting backend...
    start "Hamzooh Backend" cmd /k "cd /d %~dp0 && npm start"
    timeout /t 5 >nul
)

REM Check if frontend is running
curl -s http://localhost:5173 >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Frontend not running!
    echo.
    echo Starting frontend...
    start "Hamzooh Frontend" cmd /k "cd /d %~dp0landing-page && npm run dev"
    timeout /t 5 >nul
)

echo.
echo [OK] Services are running
echo.
echo ========================================
echo   Testing Checklist:
echo ========================================
echo.
echo 1. Load extension:
echo    chrome://extensions
echo    - Enable Developer Mode
echo    - Load unpacked: %~dp0extension
echo.
echo 2. Open dashboard:
echo    http://localhost:5173/dashboard/jobs
echo.
echo 3. Check extension:
echo    - Open DevTools Console
echo    - Should see HAMZOOH_PONG messages
echo.
echo 4. Test Auto Apply:
echo    - Click any job
echo    - Go to Step 4: Direct Apply
echo    - Enable "Full Auto Mode" toggle
echo    - Click "Auto Apply with AI"
echo.
echo 5. Watch logs in:
echo    - Job tab console
echo    - Extension service worker console
echo    - Backend terminal
echo.
echo ========================================
echo   Quick Debug Commands:
echo ========================================
echo.
echo Check AI Engine:
echo   curl -X POST http://localhost:3000/api/vault/infer-answer-v2 ^
echo     -H "Content-Type: application/json" ^
echo     -d "{\"question\":\"test\"}"
echo.
echo Check Extension:
echo   Open job page console and run:
echo   window.postMessage({source:'hamzooh-app',type:'HAMZOOH_PING'},'*')
echo.
echo ========================================
echo.
echo Press any key to open browser...
pause >nul

start chrome http://localhost:5173/dashboard/jobs
start chrome chrome://extensions

echo.
echo Browser opened!
echo Check the terminal windows for backend/frontend logs.
echo.
pause
