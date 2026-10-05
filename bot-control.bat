@echo off
chcp 949 >nul
setlocal
cd /d "%~dp0"
title 코인 시그널 봇 - 상황 보기 / 끄기

:menu
cls
echo ==============================================
echo   코인 시그널 봇 - 상황 보기 / 끄기
echo ==============================================
curl.exe -s -f -o nul -m 3 http://127.0.0.1:8787/api/health && goto :menu_on
echo   지금 상태:  꺼져 있음
goto :menu_list
:menu_on
echo   지금 상태:  실행 중  (http://127.0.0.1:8787)
:menu_list
echo.
echo   [1] 화면 열기 (현재 상황 보기)
echo   [2] 봇 끄기
echo   [3] 봇 켜기 (창 없이)
echo   [4] 최근 기록 보기
echo   [0] 나가기
echo.
choice /c 12340 /n /m "번호를 누르세요: "
if errorlevel 5 exit /b 0
if errorlevel 4 goto :logs
if errorlevel 3 goto :start
if errorlevel 2 goto :stop
goto :open

:open
start "" http://127.0.0.1:8787
goto :menu

:start
call "%~dp0bot-start-background.bat"
goto :menu

:logs
echo.
echo ---- 최근 기록 30줄 ----
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f = Get-ChildItem 'data\logs\bot-*.log' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1; if ($f) { Get-Content $f.FullName -Tail 30 -Encoding UTF8 } else { '기록이 아직 없어요' }"
echo.
pause
goto :menu

:stop
curl.exe -s -f -o nul -m 3 http://127.0.0.1:8787/api/health || goto :stop_already
echo.
echo 봇을 끄는 중... (가진 코인은 팔지 않아요. 다시 켜면 이어서 감시해요)
if not exist "data\run\" mkdir "data\run"
type nul > "data\run\stop.request"
set /a TRIES=0
:stop_wait
timeout /t 1 /nobreak >nul
curl.exe -s -f -o nul -m 2 http://127.0.0.1:8787/api/health || goto :stop_done
set /a TRIES+=1
if %TRIES% LSS 20 goto :stop_wait
echo 정상 종료가 늦어서 강제로 끕니다...
if exist "data\run\supervisor.pid" set /p PID=<"data\run\supervisor.pid"
if defined PID taskkill /PID %PID% /T /F >nul 2>nul
del "data\run\stop.request" >nul 2>nul
timeout /t 2 /nobreak >nul
curl.exe -s -f -o nul -m 2 http://127.0.0.1:8787/api/health || goto :stop_done
echo [!] 끄지 못했어요. 다른 창(start.bat 등)에서 켠 경우 그 창을 닫아 주세요.
pause
goto :menu
:stop_done
echo 꺼졌어요.
pause
goto :menu

:stop_already
echo.
echo 이미 꺼져 있어요.
pause
goto :menu
