"""Local server for the Akim city-simulation prototype."""

from __future__ import annotations

import json
import os
import re
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
    simulation = payload.get("simulation", {})
    before = simulation.get("before", {})
    after = simulation.get("after", {})
    formatted = "\n".join(
        f"- {item.get('direction')}: {item.get('title')} | {item.get('price')} условных единиц | "
        f"районы: {item.get('districts')} | лаг: {item.get('lag')} кв. | МАИ-приоритет: {item.get('ahpPriority')}"
        for item in selections
    )
    direction_scores = ", ".join(
        f"{name}: {value}/100" for name, value in simulation.get("directionScores", {}).items()
    )
    district_deltas = ", ".join(
        f"{name}: {value:+}" for name, value in simulation.get("districtDeltas", {}).items()
    )
    criterion_deltas = json.dumps(simulation.get("criterionDeltas", {}), ensure_ascii=False)
    contributions = json.dumps(simulation.get("contributions", []), ensure_ascii=False)
    synergies = json.dumps(simulation.get("synergies", []), ensure_ascii=False)
    synergy_text = "; ".join(
        f"{item.get('pair')}: {item.get('criterion')} +{item.get('amount')} в районе {item.get('district')}"
        for item in simulation.get("synergies", [])
    ) or "нет"
    return f"""Ты аналитик городского развития в учебном AI-симуляторе «Аким на 5 часов».
Все значения ниже присутствуют и уже рассчитаны детерминированной математической моделью.
Не пересчитывай, не меняй и не выдумывай числа: твоя роль — объяснить уже рассчитанный сценарий.
Запрещено писать, что Score, эффекты или результаты отсутствуют либо не возвращены.

Метод: МАИ (AHP), 10 частных критериев. Веса: T1=0.10, T2=0.10, E1=0.09,
E2=0.11, S1=0.11, S2=0.11, B1=0.09, B2=0.09, C1=0.10, C2=0.10.
Горизонт модели: {simulation.get('horizonQuarters', 8)} кварталов; эффекты мер уменьшены на их лаг.
Формула: {simulation.get('formula')}.
Score до: {before.get('score')}; после: {after.get('score')}; изменение: {simulation.get('delta')}.
D_avg после: {after.get('average')}; D_min после: {after.get('minimum')};
критические показатели (<40): {before.get('critical')} → {after.get('critical')}.
Использовано бюджета: {payload.get('spent')} из {payload.get('budget')} условных единиц.
Синергии: {synergy_text}.
Оценки направлений: {direction_scores}.
Изменение районных индексов: {district_deltas}.
Изменения частных показателей по районам: {criterion_deltas}.
Вклад каждой выбранной меры с учётом лага: {contributions}.
Синергии: {synergies}.
Решения:
{formatted}

Ответ предназначен для городского управленца, а не для технического специалиста. Ответь
по-русски, до 150 слов, с четырьмя короткими абзацами и простыми заголовками:
«Итог», «Что сработало», «Риски», «Что улучшить».

Покажи Score до, после и изменение, но не показывай формулы, коэффициенты, D_avg, D_min,
N_crit, коды T1–C2, МАИ-приоритеты или JSON. Вместо них говори понятными словами:
«средний уровень города», «самый слабый район», «критические проблемы».
Называй меры человеческими названиями, а не только кодами M1–M14.

Единственная валюта этой модели — «условные единицы». Никогда не упоминай тенге, ₸,
миллионы или «млн» — даже в примерах расхода.
Не называй остаток бюджета резервом, гибкостью или ограничением для дополнительных мер:
правила допускают ровно пять решений, шестую меру добавить нельзя, а остаток не влияет на Score.
Если сценарий можно улучшить, рекомендуй заменить одну из уже выбранных мер на другую или
перенести районную меру в более нуждающийся район.
"""


def normalize_analysis_units(text: str) -> str:
    """Prevent an LLM from changing the synthetic model's unit into tenge."""
    return re.sub(
        r"(?:млн\.?|миллион(?:а|ов)?)\s*(?:₸|тенге)",
        "условных единиц",
        text,
        flags=re.IGNORECASE,
    )


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
    return normalize_analysis_units(text)


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
            if not payload.get("simulation"):
                raise ValueError("Сначала необходимо рассчитать математическую модель.")
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
    port = int(os.environ.get("APP_PORT", "8081"))
    print(f"The simulator is available at http://localhost:{port}")
    ThreadingHTTPServer(("", port), AppHandler).serve_forever()
