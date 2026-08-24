@echo off
setlocal
cd /d "%~dp0"
echo.
echo ==============================================
echo   DPO Digital Dak - Local Development Server
echo ==============================================
echo.
where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js is not installed or is not available in PATH.
  echo Install Node.js 20 LTS or newer from https://nodejs.org/
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies for first run...
  call npm install
  if errorlevel 1 (
    echo ERROR: npm install failed. Check your internet connection.
    pause
    exit /b 1
  )
)
echo Starting server at http://localhost:3000
echo Press Ctrl+C to stop the server.
echo.
call npm run dev
pause
