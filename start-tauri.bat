@echo off
chcp 65001 >nul
title UniDoc

echo ============================================
echo   UniDoc - Tauri Desktop App
echo ============================================
echo.

cd /d "%~dp0"
set "PATH=C:\Users\乔一峰\.cargo\bin;%PATH%"

echo [1/2] Killing stale processes on port 5173...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5173.*LISTENING"') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

echo [2/2] Starting Tauri dev...
npx tauri dev

echo.
echo Tauri exited. Press any key to close.
pause >nul
