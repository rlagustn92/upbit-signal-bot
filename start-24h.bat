@echo off
chcp 949 >nul
setlocal
cd /d "%~dp0"
title 코인 시그널 봇 (24시간 운영)

echo ==============================================
echo   코인 시그널 봇 - 24시간 운영 모드
echo   - 서버가 예기치 않게 죽으면 자동으로 다시 켭니다
echo   - 화면: http://127.0.0.1:8787
echo   - 이 창을 닫으면 멈춥니다
echo   - PC 절전 모드가 켜져 있으면 봇이 멈춰요 (README 참고)
echo ==============================================
echo.

where node >nul 2>nul && goto :node_ok
if exist "%LOCALAPPDATA%\node-portable\node-v24.21.0-win-x64\node.exe" (
  set "PATH=%LOCALAPPDATA%\node-portable\node-v24.21.0-win-x64;%PATH%"
  goto :node_ok
)
echo [!] Node.js가 없습니다. https://nodejs.org/ko 에서 LTS 버전을 설치하세요.
start "" https://nodejs.org/ko
pause
exit /b 1

:node_ok
if not exist "node_modules\" call npm install
if not exist ".env" copy ".env.example" ".env" >nul

echo 화면 파일을 만드는 중...
call npm run build
if errorlevel 1 (
  echo [!] 빌드 실패
  pause
  exit /b 1
)

start "" /min cmd /c "timeout /t 8 >nul & start "" http://127.0.0.1:8787"
node scripts\start.mjs
pause
