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
