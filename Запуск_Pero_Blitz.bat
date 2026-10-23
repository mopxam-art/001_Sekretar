@echo off
echo Starting Pero Blitz...
echo ========================

cd /d "%~dp0Pero Blitz"

echo Checking dependencies...
call npm install

echo Starting development server...
call npm run dev

pause
