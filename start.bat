@echo off
chcp 949 >nul
setlocal
cd /d "%~dp0"
title 코인 시그널 봇 (테스트 실행)

echo ==============================================
echo   코인 시그널 봇 - 테스트 실행
echo   창을 닫으면 봇도 멈춥니다. (상태는 저장됨)
echo ==============================================
echo.

rem -- Node.js 찾기 (설치된 Node -> 이 PC의 포터블 Node) --
set "NODE_DIR="
where node >nul 2>nul && goto :node_ok
if exist "%LOCALAPPDATA%\node-portable\node-v24.21.0-win-x64\node.exe" (
  set "NODE_DIR=%LOCALAPPDATA%\node-portable\node-v24.21.0-win-x64"
  set "PATH=%LOCALAPPDATA%\node-portable\node-v24.21.0-win-x64;%PATH%"
  goto :node_ok
)
echo [!] Node.js가 없습니다. 열리는 페이지에서 "LTS" 버전을 설치한 뒤 이 파일을 다시 실행하세요.
start "" https://nodejs.org/ko
pause
exit /b 1

:node_ok
for /f "delims=" %%v in ('node -v') do echo Node.js %%v 확인

rem -- 처음 한 번: 패키지 설치 --
if not exist "node_modules\" (
  echo.
  echo 처음 실행이라 필요한 파일을 설치합니다. 몇 분 걸릴 수 있어요...
  call npm install
  if errorlevel 1 (
    echo [!] 설치 실패. 인터넷 연결을 확인하세요.
    pause
    exit /b 1
  )
)

rem -- 처음 한 번: 설정 파일 만들기 (.env 는 git에 올라가지 않음) --
if not exist ".env" (
  copy ".env.example" ".env" >nul
  echo 설정 파일 .env 를 만들었어요. 기본값은 모의투자 전용입니다.
)

echo.
echo 서버를 켜는 중... 잠시 후 브라우저가 자동으로 열립니다.
echo 주소: http://localhost:5173
echo.

rem 6초 뒤 브라우저 열기(서버가 뜨는 동안 기다림)
start "" /min cmd /c "timeout /t 6 >nul & start "" http://localhost:5173"

node scripts\dev.mjs

echo.
echo 봇이 종료되었습니다.
pause
