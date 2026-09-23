"""Local server for the Akim city-simulation prototype."""

from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent


def load_dotenv() -> None:
    """Load local development variables without adding a dependency."""
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        # In local development .env is the explicit project configuration.
        # It must take precedence over a stale system-level variable.
        os.environ[key.strip()] = value.strip().strip('"').strip("'")


def create_prompt(payload: dict) -> str:
    selections = payload.get("selections", [])
    formatted = "\n".join(
        f"- {item.get('direction')}: {item.get('title')} | {item.get('price')} млн ₸ | "
        f"районы: {item.get('districts')} | эффект: +{item.get('impact')}"
        for item in selections
    )
    return f"""Ты аналитик городского развития в учебном AI-симуляторе «Аким на 5 часов».
Проанализируй только переданные синтетические данные. Не выдумывай фактов, статистики или эффектов.

Итоговый Astana Quality of Life Score: {payload.get('score')} / 100.
Использовано бюджета: {payload.get('spent')} из {payload.get('budget')} млн ₸.
Суммарное моделируемое улучшение: +{payload.get('impact')} пунктов.
Решения:
{formatted}

Ответь по-русски, до 180 слов, с четырьмя короткими абзацами:
1) вывод о сценарии и счёте;
2) сильные стороны;
3) риски и компромиссы;
4) одна конкретная рекомендация.
"""


def analyze(payload: dict) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY не найден. Добавьте ключ в .env и перезапустите run.bat.")

    request_body = json.dumps({
        "model": os.environ.get("OPENAI_MODEL", "gpt-5-mini"),
        "input": create_prompt(payload),
    }).encode("utf-8")
    request = Request(
        "https://api.openai.com/v1/responses",
        data=request_body,
        method="POST",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=30) as response:
            result = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        print(f"OpenAI API error: HTTP {error.code}")
        if error.code == HTTPStatus.UNAUTHORIZED:
            raise RuntimeError(
                "OpenAI отклонил API-ключ. Проверьте новый OPENAI_API_KEY в .env и перезапустите run.bat."
            ) from error
        if error.code == HTTPStatus.TOO_MANY_REQUESTS:
            raise RuntimeError("Превышен лимит запросов OpenAI. Повторите попытку позже.") from error
        raise RuntimeError(f"OpenAI API вернул ошибку {error.code}.") from error
    except URLError as error:
        print(f"OpenAI connection error: {error.reason}")
        raise RuntimeError("Не удалось подключиться к OpenAI API.") from error

    text = result.get("output_text", "").strip()
    if not text:
        # The SDK exposes output_text as a convenience property. The raw
        # Responses API JSON contains generated text inside output messages.
        text_parts = []
        for output_item in result.get("output", []):
            if output_item.get("type") != "message":
                continue
            for content_item in output_item.get("content", []):
                if content_item.get("type") == "output_text":
                    text_parts.append(content_item.get("text", ""))
        text = "".join(text_parts).strip()
    if not text:
        raise RuntimeError("AI не вернул текстовый анализ.")
    return text


class AppHandler(SimpleHTTPRequestHandler):
    def do_POST(self) -> None:
        if self.path != "/api/analyze":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            if len(payload.get("selections", [])) != 5:
                raise ValueError("Для анализа нужно выбрать 5 инициатив.")
            response, status = {"analysis": analyze(payload)}, HTTPStatus.OK
        except (ValueError, json.JSONDecodeError) as error:
            response, status = {"error": str(error)}, HTTPStatus.BAD_REQUEST
        except RuntimeError as error:
            response, status = {"error": str(error)}, HTTPStatus.SERVICE_UNAVAILABLE

        data = json.dumps(response, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    load_dotenv()
    os.chdir(ROOT)
    port = int(os.environ.get("APP_PORT", "8080"))
    print(f"The simulator is available at http://localhost:{port}")
    ThreadingHTTPServer(("", port), AppHandler).serve_forever()
