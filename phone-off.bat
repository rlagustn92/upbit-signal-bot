@echo off
chcp 949 >nul
setlocal
title 코인 시그널 봇 - 폰에서 열기 끄기

set "TS=tailscale"
where tailscale >nul 2>nul && goto :ts_ok
if exist "%ProgramFiles%\Tailscale\tailscale.exe" (
  set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
  goto :ts_ok
)
echo Tailscale이 설치되어 있지 않아요. 끌 것이 없어요.
pause
exit /b 0

:ts_ok
"%TS%" serve reset
echo 폰에서 열기를 껐어요. 봇은 이 PC에서 계속 돌아가요.
pause
