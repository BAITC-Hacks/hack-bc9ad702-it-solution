@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  py -m venv .venv
)

set "APP_OPENAI_KEY="
if exist ".env" (
  for /f "tokens=1,* delims==" %%A in ('findstr /B /C:"OPENAI_API_KEY=" ".env"') do set "APP_OPENAI_KEY=%%B"
)
if /I "%APP_OPENAI_KEY%"=="your_openai_api_key_here" set "APP_OPENAI_KEY="
if defined APP_OPENAI_KEY goto :start_server

echo.
echo OpenAI API key was not found.
set /p "APP_OPENAI_KEY=Paste your OpenAI API key: "
if not defined APP_OPENAI_KEY (
  echo OPENAI_MODEL=gpt-5-mini> ".env"
  echo API key was not entered. Starting with deterministic analysis.
  goto :start_server
)

(
  echo OPENAI_API_KEY=%APP_OPENAI_KEY%
  echo OPENAI_MODEL=gpt-5-mini
) > ".env"
echo .env created successfully.

:start_server
echo.
set "APP_PORT=8081"

:find_free_port
".venv\Scripts\python.exe" -c "import socket,sys; sock=socket.socket(); sock.settimeout(0.25); sys.exit(1 if sock.connect_ex(('127.0.0.1',int(sys.argv[1])))==0 else 0)" "!APP_PORT!"
if errorlevel 1 (
  echo Port !APP_PORT! is already in use. Trying the next port...
  set /a APP_PORT+=1
  if !APP_PORT! GTR 8090 goto :no_free_port
  goto :find_free_port
)

echo The simulator is available at http://localhost:!APP_PORT!
echo Press Ctrl+C to stop the local server.
echo.
".venv\Scripts\python.exe" server.py
exit /b %errorlevel%

:no_free_port
echo No free port was found in the range 8081-8090.
echo Close an old AstanaSIM AI server and run this file again.
pause
exit /b 1
