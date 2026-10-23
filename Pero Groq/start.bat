@echo off
cd /d "%~dp0"

:: Закрываем предыдущие зависшие копии Пера перед новым запуском
powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*Pero Groq*' } | Stop-Process -Force" >nul 2>&1

set NO_PROXY=localhost,127.0.0.1,::1
set GROQ_PROXY=http://100.86.75.16:8888
set GROQ_BASE_URL=https://api.groq.com

IF NOT EXIST "node_modules\" (
    echo Installing dependencies for the first time...
    npm install
)

echo Starting Pero Groq...
npm run dev
pause
