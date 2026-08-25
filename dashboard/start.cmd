@echo off
setlocal
set "ROOT=F:\MCP-CLEAN"
set "URL=http://127.0.0.1:3210"
set "NODE=%ProgramFiles%\nodejs\node.exe"
set "SERVER=%ROOT%\dashboard\server.mjs"
set "PIDFILE=%ROOT%\dashboard\dashboard.pid"

powershell.exe -NoProfile -Command "try { (Invoke-WebRequest -Uri '%URL%/api/status' -UseBasicParsing -TimeoutSec 2).StatusCode | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 goto open

start "" /b "%NODE%" "%SERVER%"

:wait
powershell.exe -NoProfile -Command "try { (Invoke-WebRequest -Uri '%URL%/api/status' -UseBasicParsing -TimeoutSec 2).StatusCode | Out-Null; exit 0 } catch { exit 1 }"
if not %errorlevel%==0 (
  timeout /t 1 /nobreak >nul
  goto wait
)

:open
powershell.exe -NoProfile -Command "Start-Process msedge.exe '%URL%'"
endlocal

