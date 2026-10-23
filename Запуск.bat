@echo off
echo Starting Sekretar app...
echo ========================

cd /d "%~dp0app"

echo Checking dependencies...
call npm install

echo Starting development server...
call npm run dev

pause
