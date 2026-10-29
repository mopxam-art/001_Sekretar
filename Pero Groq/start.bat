@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================================
echo  Запуск Pero Blitz PRO (Режим разработки)
echo ========================================================

echo [1/3] Завершение зависших процессов и хуков клавиатуры...
taskkill /F /IM WinKeyServer.exe >nul 2>&1
powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*Pero Groq*' -or $_.Path -like '*electron*' } | Stop-Process -Force" >nul 2>&1

echo [2/3] Освобождение порта 5174...
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 5174 -ErrorAction SilentlyContinue; if ($c) { foreach ($p in $c.OwningProcess) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } }" >nul 2>&1

set NO_PROXY=localhost,127.0.0.1,::1
set GROQ_PROXY=http://100.86.75.16:8888
set GROQ_BASE_URL=https://api.groq.com

IF NOT EXIST "node_modules\" (
    echo [3/3] Установка зависимостей npm...
    call npm install
)

echo [3/3] Запуск сервера Vite и приложения Electron...
call npm run dev
pause
