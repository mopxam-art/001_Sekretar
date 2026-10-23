@echo off
echo Starting Sekretar Lite app...
echo ========================

cd /d "%~dp0app_lite"

echo Checking dependencies...
call npm install

echo Starting development server...
call npm run dev

pause
