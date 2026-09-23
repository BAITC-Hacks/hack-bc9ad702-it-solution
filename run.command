#!/bin/bash

set -u
cd "$(dirname "$0")" || exit 1

if command -v python3 >/dev/null 2>&1; then
  SYSTEM_PYTHON="python3"
elif command -v python >/dev/null 2>&1; then
  SYSTEM_PYTHON="python"
else
  echo "Python 3 was not found. Install it from https://www.python.org/downloads/macos/"
  read -r -p "Press Enter to close..."
  exit 1
fi

if [[ ! -x ".venv/bin/python" ]]; then
  echo "Creating Python virtual environment..."
  "$SYSTEM_PYTHON" -m venv .venv || {
    echo "Failed to create .venv. Check the Python installation and try again."
    read -r -p "Press Enter to close..."
    exit 1
  }
fi

VENV_PYTHON=".venv/bin/python"
APP_OPENAI_KEY=""

if [[ -f ".env" ]]; then
  APP_OPENAI_KEY="$(grep -m 1 '^OPENAI_API_KEY=' .env 2>/dev/null | cut -d '=' -f 2-)"
fi

if [[ "$APP_OPENAI_KEY" == "your_openai_api_key_here" ]]; then
  APP_OPENAI_KEY=""
fi

if [[ -z "$APP_OPENAI_KEY" ]]; then
  echo
  echo "OpenAI API key was not found."
  read -r -p "Paste your OpenAI API key (or press Enter for fallback analysis): " APP_OPENAI_KEY

  if [[ -z "$APP_OPENAI_KEY" ]]; then
    printf 'OPENAI_MODEL=gpt-5-mini\n' > .env
    echo "API key was not entered. Starting with deterministic analysis."
  else
    printf 'OPENAI_API_KEY=%s\nOPENAI_MODEL=gpt-5-mini\n' "$APP_OPENAI_KEY" > .env
    echo ".env created successfully."
  fi
fi

APP_PORT=8081

while (( APP_PORT <= 8090 )); do
  if "$VENV_PYTHON" -c "import socket,sys; sock=socket.socket(); sock.settimeout(0.25); sys.exit(1 if sock.connect_ex(('127.0.0.1', int(sys.argv[1]))) == 0 else 0)" "$APP_PORT"; then
    break
  fi

  echo "Port $APP_PORT is already in use. Trying the next port..."
  ((APP_PORT += 1))
done

if (( APP_PORT > 8090 )); then
  echo "No free port was found in the range 8081-8090."
  echo "Close an old AstanaSIM AI server and run this file again."
  read -r -p "Press Enter to close..."
  exit 1
fi

export APP_PORT
export OPEN_BROWSER=1

echo
echo "The simulator is available at http://localhost:$APP_PORT"
echo "Press Control+C to stop the local server."
echo

"$VENV_PYTHON" server.py
EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 && $EXIT_CODE -ne 130 ]]; then
  echo
  echo "The server stopped with exit code $EXIT_CODE."
  read -r -p "Press Enter to close..."
fi

exit "$EXIT_CODE"
