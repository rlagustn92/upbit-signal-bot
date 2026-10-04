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

rem -- Node.js 찾기: PC에 설치된 Node -> 이 폴더의 runtime\node -> 예전 포터블 위치 --
where node >nul 2>nul && goto :node_ok
if exist "%~dp0runtime\node\node.exe" goto :use_local_node
if exist "%LOCALAPPDATA%\node-portable\node-v24.21.0-win-x64\node.exe" goto :use_portable_node
echo [!] Node.js를 찾지 못했어요.
echo     열리는 페이지에서 LTS 버전을 내려받아 설치한 뒤 이 파일을 다시 실행하세요. 회원가입은 필요 없어요.
start "" https://nodejs.org/ko/download
pause
exit /b 1

:use_local_node
set "PATH=%~dp0runtime\node;%PATH%"
goto :node_ok

:use_portable_node
set "PATH=%LOCALAPPDATA%\node-portable\node-v24.21.0-win-x64;%PATH%"

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
