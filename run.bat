@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  py -m venv .venv
)

echo.
set APP_PORT=8081
echo The simulator is available at http://localhost:8081
echo Press Ctrl+C to stop the local server.
echo.
".venv\Scripts\python.exe" server.py
