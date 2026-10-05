@echo off
chcp 949 >nul
setlocal
cd /d "%~dp0"
title 코인 시그널 봇 - 창 없이 켜기
set "QUIET=%~1"
set "BOTDIR=%~dp0"

curl.exe -s -f -o nul -m 3 http://127.0.0.1:8787/api/health && goto :already

echo ==============================================
echo   코인 시그널 봇 - 창 없이(백그라운드) 켜기
echo   - 준비가 끝나면 이 창은 저절로 닫혀요
echo   - 상황 보기 / 끄기: bot-control.bat
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
if errorlevel 1 goto :build_fail

echo 봇을 백그라운드에서 켜는 중...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath (Get-Command node).Source -ArgumentList 'scripts\start.mjs' -WorkingDirectory $env:BOTDIR -WindowStyle Hidden"

set /a TRIES=0
:wait_up
timeout /t 2 /nobreak >nul
curl.exe -s -f -o nul -m 3 http://127.0.0.1:8787/api/health && goto :started
set /a TRIES+=1
if %TRIES% LSS 30 goto :wait_up
echo [!] 1분이 지나도 켜지지 않았어요. bot-control.bat 의 [4] 최근 기록 보기로 확인해 주세요.
pause
exit /b 1

:started
echo.
echo 켜졌어요! 이제 창이 없어도 24시간 돌아가요.
echo 상황 보기 / 끄기는 bot-control.bat 을 실행하세요.
if /i "%QUIET%"=="quiet" exit /b 0
start "" http://127.0.0.1:8787
timeout /t 5 >nul
exit /b 0

:already
if /i "%QUIET%"=="quiet" exit /b 0
echo 봇이 이미 켜져 있어요. 화면을 열게요. (끄기: bot-control.bat)
start "" http://127.0.0.1:8787
timeout /t 3 >nul
exit /b 0

:build_fail
echo [!] 빌드 실패
pause
exit /b 1
