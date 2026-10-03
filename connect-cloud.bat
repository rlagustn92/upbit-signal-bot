@echo off
chcp 949 >nul
setlocal
cd /d "%~dp0"
title 코인 시그널 봇 - 클라우드 서버 화면 열기

rem 클라우드 서버의 봇 화면을 SSH 터널로 안전하게 엽니다(서버 포트를 인터넷에 열지 않음).
rem 처음 한 번 서버 IP와 SSH 키 파일 위치를 물어보고 cloud-connect.cfg 에 저장합니다(git 제외).

if exist "cloud-connect.cfg" (
  for /f "usebackq tokens=1,* delims==" %%a in ("cloud-connect.cfg") do set "%%a=%%b"
)
if "%CLOUD_IP%"=="" set /p CLOUD_IP=클라우드 서버 공인 IP:
if "%CLOUD_USER%"=="" set CLOUD_USER=ubuntu
if "%CLOUD_KEY%"=="" set /p CLOUD_KEY=SSH 개인키 파일 경로 - 예 C:\keys\oracle.key :
> "cloud-connect.cfg" echo CLOUD_IP=%CLOUD_IP%
>> "cloud-connect.cfg" echo CLOUD_USER=%CLOUD_USER%
>> "cloud-connect.cfg" echo CLOUD_KEY=%CLOUD_KEY%

echo.
echo 서버 %CLOUD_IP% 에 연결합니다. 이 창을 열어 두는 동안 화면을 볼 수 있어요.
echo 화면 주소: http://127.0.0.1:8787   (봇은 창을 닫아도 서버에서 계속 돌아가요)
echo.
start "" /min cmd /c "timeout /t 4 >nul & start "" http://127.0.0.1:8787"
ssh -i "%CLOUD_KEY%" -N -L 8787:127.0.0.1:8787 %CLOUD_USER%@%CLOUD_IP%
echo.
echo 연결이 끊겼어요. IP/키 경로가 틀렸다면 cloud-connect.cfg 를 지우고 다시 실행하세요.
pause
