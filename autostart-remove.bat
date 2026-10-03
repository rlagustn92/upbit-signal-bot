@echo off
chcp 949 >nul
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CoinSignalBot.lnk"
if exist "%LINK%" (
  del "%LINK%"
  echo 자동 시작을 해제했어요.
) else (
  echo 자동 시작이 설정되어 있지 않아요.
)
pause
