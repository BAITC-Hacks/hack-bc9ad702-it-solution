@echo off
setlocal
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
  echo API key was not entered. The server was not started.
  pause
  exit /b 1
)

(
  echo OPENAI_API_KEY=%APP_OPENAI_KEY%
  echo OPENAI_MODEL=gpt-5-mini
) > ".env"
echo .env created successfully.

:start_server
echo.
set APP_PORT=8081
echo The simulator is available at http://localhost:8081
echo Press Ctrl+C to stop the local server.
echo.
".venv\Scripts\python.exe" server.py
