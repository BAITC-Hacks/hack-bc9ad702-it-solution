"""Local server for the Akim city-simulation prototype."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
import webbrowser
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from model_engine import ENGINE, ModelValidationError

ROOT = Path(__file__).resolve().parent
MAX_REQUEST_BYTES = 64 * 1024
PUBLIC_PATHS = {"/", "/index.html", "/styles.css", "/app.js", "/data/model-data.json"}


def open_app_browser(app_url: str) -> None:
    """Open the simulator with the operating system's default browser."""
    try:
        if sys.platform == "darwin":
            subprocess.Popen(
                ["open", app_url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        elif os.name == "nt":
            os.startfile(app_url)  # type: ignore[attr-defined]
        elif not webbrowser.open(app_url, new=2):
            raise OSError("no default browser was found")
        print(f"Browser opened: {app_url}")
    except OSError as error:
        print(f"Could not open the browser automatically: {error}")
        print(f"Open this address manually: {app_url}")


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


def deterministic_analysis(payload: dict) -> str:
    """Explain a calculated scenario without relying on an external AI service."""
    simulation = payload.get("simulation", {})
    before = simulation.get("before", {})
    after = simulation.get("after", {})
    selections = payload.get("selections", [])
    district_deltas = simulation.get("districtDeltas", {})
    district_scores = after.get("districtScores", {})
    contributions = simulation.get("contributions", [])

    def number(value: object) -> str:
        try:
            return f"{float(value):.2f}"
        except (TypeError, ValueError):
            return "—"

    def signed_number(value: object) -> str:
        try:
            return f"{float(value):+.2f}"
        except (TypeError, ValueError):
            return "—"

    titles = [item.get("title", "инициатива") for item in selections]
    measures_text = ", ".join(titles)
    strongest_district = max(district_deltas, key=district_deltas.get, default=None)
    strongest_delta = district_deltas.get(strongest_district, 0)
    weakest_district = min(district_scores, key=district_scores.get, default=None)
    selected_districts = [item.get("districts") for item in selections if item.get("districts") not in (None, "город")]
    district_counts = {district: selected_districts.count(district) for district in set(selected_districts)}
    most_focused_district = max(district_counts, key=district_counts.get, default=None)
    has_tradeoff = any(
        value < 0
        for contribution in contributions
        for value in contribution.get("effects", {}).values()
    )

    strengths = f"Выбраны меры: {measures_text}."
    if strongest_district:
        strengths += f" Самый заметный прирост получает район {strongest_district}: {signed_number(strongest_delta)} пункта."
    if simulation.get("synergies"):
        strengths += " Совместный эффект выбранных мер дополнительно усиливает сценарий."

    risks = []
    critical_after = after.get("critical", 0)
    critical_before = before.get("critical", 0)
    if critical_after:
        risks.append(f"Критические проблемы остаются: {critical_before} → {critical_after}.")
    if most_focused_district and district_counts[most_focused_district] >= 3:
        risks.append(f"Большая часть районных вложений сосредоточена в районе {most_focused_district}.")
    if has_tradeoff:
        risks.append("Одна из мер улучшает безопасность ценой небольшого компромисса в транспорте.")
    if not risks:
        risks.append("Критические показатели устранены, а вложения распределены без выраженной концентрации.")

    if weakest_district:
        recommendation = f"Чтобы усилить сценарий, замените или перенесите одну из районных мер в {weakest_district} — это самый слабый район после расчёта."
    else:
        recommendation = "Чтобы усилить сценарий, замените одну из выбранных мер на инициативу для наиболее слабого направления."

    return (
        "Итог\n"
        f"Score изменился с {number(before.get('score'))} до {number(after.get('score'))} "
        f"({signed_number(simulation.get('delta'))}). Использовано {payload.get('spent')} из "
        f"{payload.get('budget')} условных единиц.\n\n"
        "Что сработало\n"
        f"{strengths}\n\n"
        "Риски\n"
        f"{' '.join(risks)}\n\n"
        "Что улучшить\n"
        f"{recommendation}"
    )


def build_verified_payload(raw_selections: object) -> dict:
    """Recalculate a client scenario from canonical JSON data on the server."""
    normalized = ENGINE.validate(raw_selections, require_complete=True)
    simulation = ENGINE.simulate(normalized)
    return {
        "selections": ENGINE.describe_selections(normalized),
        "selectionRequest": normalized,
        "budget": ENGINE.model["budget"],
        "spent": ENGINE.spent(normalized),
        "simulation": simulation,
    }


def analyze(payload: dict) -> str:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY не найден. Добавьте ключ в .env и перезапустите приложение.")

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
                "OpenAI отклонил API-ключ. Проверьте новый OPENAI_API_KEY в .env и перезапустите приложение."
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
    def send_json(self, response: dict, status: HTTPStatus = HTTPStatus.OK) -> None:
        data = json.dumps(response, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        request_path = self.path.split("?", 1)[0]
        if request_path == "/api/health":
            self.send_json({"status": "ok", "app": "AstanaSIM AI", "apiVersion": 2})
            return
        if request_path == "/api/model-summary":
            self.send_json(ENGINE.baseline())
            return
        if request_path not in PUBLIC_PATHS:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        super().do_GET()

    def do_POST(self) -> None:
        if self.path not in {"/api/simulate", "/api/analyze"}:
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
                raise ModelValidationError("Размер запроса недопустим.")
            request_payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            if not isinstance(request_payload, dict):
                raise ModelValidationError("Тело запроса должно быть JSON-объектом.")
            payload = build_verified_payload(request_payload.get("selections"))
            if self.path == "/api/simulate":
                response = payload
            else:
                response = {"analysis": analyze(payload), "fallback": False}
            status = HTTPStatus.OK
        except (ModelValidationError, ValueError, json.JSONDecodeError) as error:
            response, status = {"error": str(error)}, HTTPStatus.BAD_REQUEST
        except RuntimeError as error:
            print(f"Using deterministic analysis: {error}")
            response, status = {
                "analysis": deterministic_analysis(payload),
                "fallback": True,
            }, HTTPStatus.OK

        self.send_json(response, status)


if __name__ == "__main__":
    load_dotenv()
    os.chdir(ROOT)
    port = int(os.environ.get("APP_PORT", "8081"))
    app_url = f"http://localhost:{port}"
    server = ThreadingHTTPServer(("", port), AppHandler)
    print(f"The simulator is available at {app_url}")

    if os.environ.get("OPEN_BROWSER") == "1":
        browser_timer = threading.Timer(0.4, open_app_browser, args=(app_url,))
        browser_timer.daemon = True
        browser_timer.start()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()
