@echo off
chcp 949 >nul
setlocal
cd /d "%~dp0"
echo ==============================================
echo   윈도우를 켤 때 봇이 자동으로 시작되게 설정
echo   (시작프로그램 폴더에 바로가기를 만듭니다)
echo   - 창 없이 백그라운드로 켜져요. 상황 보기 / 끄기: bot-control.bat
echo   해제하려면 autostart-remove.bat 실행
echo ==============================================
set "TARGET=%~dp0bot-start-background.bat"
set "LINK=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\CoinSignalBot.lnk"
powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:LINK); $s.TargetPath=$env:TARGET; $s.Arguments='quiet'; $s.WorkingDirectory=(Split-Path $env:TARGET); $s.WindowStyle=7; $s.Save()"
if exist "%LINK%" (
  echo 완료! 다음 부팅부터 자동으로 켜집니다.
) else (
  echo [!] 바로가기를 만들지 못했어요.
)
pause
