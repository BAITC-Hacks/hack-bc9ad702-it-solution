@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  echo Creating Python virtual environment...
  py -m venv .venv
)

echo.
echo The simulator is available at http://localhost:8000
echo Press Ctrl+C to stop the local server.
echo.
".venv\Scripts\python.exe" -m http.server 8000
