@echo off
setlocal
cd /d "%~dp0"
title DPO Digital Dak System
color 0A

echo =====================================================
echo       DPO DIGITAL DAK AND FILE MANAGEMENT SYSTEM
echo =====================================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js install nahi hai.
  echo Node.js 20 LTS download karein: https://nodejs.org/
  echo Install ke baad is file ko dobara double-click karein.
  pause
  exit /b 1
)

if not exist node_modules\next\package.json (
  echo [FIRST RUN] Required packages install ho rahe hain...
  echo Internet connection zaroori hai. Is mein kuch minutes lag sakte hain.
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERROR] npm install fail ho gaya.
    echo Internet aur antivirus/firewall check karke dobara try karein.
    pause
    exit /b 1
  )
)

if exist .next (
  echo Previous temporary cache clean ki ja rahi hai...
  rmdir /s /q .next >nul 2>&1
)

echo.
echo System start ho raha hai...
echo Browser address: http://localhost:3000
echo Server ki black window ko system use karte waqt band na karein.
echo Server band karne ke liye server window mein Ctrl+C press karein.
echo.

start "DPO Digital Dak Server" cmd /k "cd /d ""%~dp0"" && npm run dev"
timeout /t 5 /nobreak >nul
start "" http://localhost:3000
exit /b 0
