@echo off
chcp 949 >nul
setlocal
cd /d "%~dp0"
title 코인 시그널 봇 - 폰에서 열기 켜기

echo ==============================================
echo   폰에서 봇 화면 열기 - Tailscale 사설망 사용
echo   내 기기끼리만 연결되고 인터넷에 공개되지 않아요.
echo ==============================================
echo.

rem -- Tailscale 찾기 --
set "TS=tailscale"
where tailscale >nul 2>nul && goto :ts_ok
if exist "%ProgramFiles%\Tailscale\tailscale.exe" (
  set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
  goto :ts_ok
)
echo [!] Tailscale이 설치되어 있지 않아요.
echo     1. 열리는 페이지에서 Windows용 Tailscale을 설치하고 로그인하세요.
echo     2. 폰에도 Tailscale 앱을 설치하고 같은 계정으로 로그인하세요.
echo     3. 그다음 이 파일을 다시 실행하세요.
start "" https://tailscale.com/download/windows
pause
exit /b 1

:ts_ok
"%TS%" status >nul 2>nul
if errorlevel 1 goto :ts_login
goto :find_port

:ts_login
echo Tailscale 로그인이 필요해요. 브라우저에서 로그인하세요...
"%TS%" up
"%TS%" status >nul 2>nul
if errorlevel 1 (
  echo [!] 로그인이 끝나지 않았어요. 작업표시줄의 Tailscale 아이콘에서 로그인한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

:find_port
rem -- 봇 화면 포트 찾기: 테스트 실행 5173 우선, 24시간 운영 8787 --
set "PORT="
netstat -ano | findstr /r /c:"127.0.0.1:5173 .*LISTENING" >nul && set "PORT=5173"
if not defined PORT netstat -ano | findstr /r /c:"127.0.0.1:8787 .*LISTENING" >nul && set "PORT=8787"
if not defined PORT (
  echo [!] 봇이 꺼져 있어요. start.bat 또는 start-24h.bat 으로 봇을 먼저 켠 뒤 다시 실행하세요.
  pause
  exit /b 1
)

echo 봇 화면 포트: %PORT%
echo.
"%TS%" serve reset >nul 2>nul
"%TS%" serve --bg %PORT%
if errorlevel 1 (
  echo.
  echo [!] 연결 설정에 실패했어요. 위에 나온 안내 링크가 있으면 열어서 HTTPS 사용을 허용한 뒤 다시 실행하세요.
  pause
  exit /b 1
)

echo.
echo ==============================================
echo   아래 https://....ts.net 주소를 폰에서 여세요.
echo   폰의 Tailscale 앱이 켜져 있어야 열려요. LTE도 가능.
echo ==============================================
"%TS%" serve status
echo.
echo 끄려면 phone-off.bat 을 실행하세요. PC가 켜져 있고 봇이 실행 중이어야 열려요.
pause
