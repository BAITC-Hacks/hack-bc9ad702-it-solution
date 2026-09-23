"""Canonical deterministic engine for the city-management simulation.

The browser sends only measure identifiers and target districts. Prices,
effects, constraints and the final Score are always taken from the versioned
JSON configuration and recalculated on the server.
"""

from __future__ import annotations

import copy
import json
import math
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
MODEL_PATH = ROOT / "data" / "model-data.json"


class ModelValidationError(ValueError):
    """Raised when a scenario or model configuration is invalid."""


def round2(value: float) -> float:
    """Match JavaScript's positive-value display rounding."""
    return math.floor(value * 100 + 0.5) / 100


def load_model(path: Path = MODEL_PATH) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


class ModelEngine:
    def __init__(self, data: dict[str, Any]) -> None:
        self.data = data
        self.model = data["model"]
        self.criteria = data["criteria"]
        self.directions = data["directions"]
        self.districts = data["districts"]
        self.district_names = list(self.districts)
        self.measures = {measure["id"]: measure for measure in data["measures"]}
        self.direction_names = {item["id"]: item["name"] for item in self.directions}
        self._validate_configuration()

    def _validate_configuration(self) -> None:
        required = {"model", "criteria", "directions", "districts", "measures", "synergies", "constraints"}
        if not required.issubset(self.data):
            raise ModelValidationError("Файл модели неполный.")
        criteria_weight = sum(item["weight"] for item in self.criteria.values())
        population_weight = sum(item["population"] for item in self.districts.values())
        if abs(criteria_weight - 1) > 0.000001 or abs(population_weight - 1) > 0.000001:
            raise ModelValidationError("Веса критериев и районов должны в сумме давать 1.")
        if len(self.measures) != len(self.data["measures"]):
            raise ModelValidationError("Коды мероприятий должны быть уникальными.")

    def normalize_selections(self, raw_selections: Any) -> list[dict[str, str | None]]:
        if not isinstance(raw_selections, list):
            raise ModelValidationError("Список решений имеет неверный формат.")
        normalized: list[dict[str, str | None]] = []
        for item in raw_selections:
            if not isinstance(item, dict):
                raise ModelValidationError("Каждое решение должно содержать код мероприятия и район.")
            measure_id = item.get("id")
            if not isinstance(measure_id, str) or measure_id not in self.measures:
                raise ModelValidationError(f"Неизвестное мероприятие: {measure_id or '—'}.")
            district = item.get("district")
            if district == "город":
                district = None
            if district is not None and not isinstance(district, str):
                raise ModelValidationError("Район указан в неверном формате.")
            normalized.append({"id": measure_id, "district": district})
        return normalized

    def validate(self, raw_selections: Any, *, require_complete: bool = False) -> list[dict[str, str | None]]:
        selections = self.normalize_selections(raw_selections)
        required_count = self.model["requiredDecisions"]
        if require_complete and len(selections) != required_count:
            raise ModelValidationError(f"Нужно выбрать ровно {required_count} мероприятий.")
        if len(selections) > required_count:
            raise ModelValidationError(f"Можно выбрать не более {required_count} мероприятий.")

        ids = [item["id"] for item in selections]
        if len(ids) != len(set(ids)):
            raise ModelValidationError("Одно мероприятие нельзя выбрать несколько раз.")

        spent = sum(self.measures[item["id"]]["price"] for item in selections)
        if spent > self.model["budget"]:
            raise ModelValidationError(
                f"Превышен бюджет {self.model['budget']} {self.model['budgetUnit']}."
            )

        direction_counts: dict[str, int] = {}
        selected_by_id: dict[str, dict[str, str | None]] = {}
        for item in selections:
            measure = self.measures[item["id"]]
            district = item["district"]
            if measure["type"] == "district" and district not in self.districts:
                raise ModelValidationError(f"Для {item['id']} нужно выбрать существующий район.")
            if measure["type"] == "city" and district is not None:
                raise ModelValidationError(f"{item['id']} действует на весь город: район указывать нельзя.")
            direction = measure["direction"]
            direction_counts[direction] = direction_counts.get(direction, 0) + 1
            selected_by_id[item["id"]] = item

        if any(count > self.model["maxMeasuresPerDirection"] for count in direction_counts.values()):
            raise ModelValidationError(
                f"В одном направлении допускается не более {self.model['maxMeasuresPerDirection']} мер."
            )

        for constraint in self.data["constraints"]:
            first_id, second_id = constraint["measures"]
            first = selected_by_id.get(first_id)
            second = selected_by_id.get(second_id)
            if not first or not second:
                continue
            if constraint["scope"] == "global" or first["district"] == second["district"]:
                raise ModelValidationError(constraint["message"])
        return selections

    def spent(self, selections: list[dict[str, str | None]]) -> int:
        return sum(self.measures[item["id"]]["price"] for item in selections)

    def effective_effects(self, measure: dict[str, Any]) -> dict[str, float]:
        factor = (self.model["horizonQuarters"] - measure["lag"]) / self.model["horizonQuarters"]
        return {criterion: effect * factor for criterion, effect in measure["effects"].items()}

    def measure_priority(self, measure: dict[str, Any]) -> float:
        return round2(
            sum(self.criteria[criterion]["weight"] * value for criterion, value in self.effective_effects(measure).items())
        )

    def summarize(self, values: dict[str, dict[str, float]]) -> dict[str, Any]:
        district_scores = {
            name: sum(values[name][criterion] * config["weight"] for criterion, config in self.criteria.items())
            for name in self.district_names
        }
        average = sum(self.districts[name]["population"] * district_scores[name] for name in self.district_names)
        minimum = min(district_scores.values())
        critical = sum(
            value < self.model["criticalThreshold"]
            for district_values in values.values()
            for value in district_values.values()
        )
        weights = self.model["scoreWeights"]
        score = weights["average"] * average + weights["minimum"] * minimum - weights["criticalPenalty"] * critical
        return {
            "districtScores": district_scores,
            "average": round2(average),
            "minimum": round2(minimum),
            "critical": critical,
            "score": round2(score),
        }

    def direction_score(self, values: dict[str, dict[str, float]], direction: dict[str, Any]) -> float:
        direction_weight = sum(self.criteria[criterion]["weight"] for criterion in direction["criteria"])
        city_total = 0.0
        for district in self.district_names:
            district_score = sum(
                values[district][criterion] * self.criteria[criterion]["weight"]
                for criterion in direction["criteria"]
            ) / direction_weight
            city_total += self.districts[district]["population"] * district_score
        return city_total

    def describe_selections(self, selections: list[dict[str, str | None]]) -> list[dict[str, Any]]:
        return [
            {
                "id": item["id"],
                "direction": self.direction_names[self.measures[item["id"]]["direction"]],
                "title": self.measures[item["id"]]["name"],
                "price": self.measures[item["id"]]["price"],
                "districts": item["district"] or "город",
                "lag": self.measures[item["id"]]["lag"],
                "ahpPriority": self.measure_priority(self.measures[item["id"]]),
            }
            for item in selections
        ]

    def baseline(self) -> dict[str, Any]:
        values = {name: copy.deepcopy(district["values"]) for name, district in self.districts.items()}
        return {
            "summary": self.summarize(values),
            "directionScores": {
                direction["id"]: round2(self.direction_score(values, direction))
                for direction in self.directions
            },
        }

    def simulate(self, raw_selections: Any) -> dict[str, Any]:
        selections = self.validate(raw_selections, require_complete=True)
        before_values = {
            name: copy.deepcopy(district["values"])
            for name, district in self.districts.items()
        }
        after_values = copy.deepcopy(before_values)
        contributions = []

        for item in selections:
            measure = self.measures[item["id"]]
            targets = self.district_names if measure["type"] == "city" else [item["district"]]
            effects = self.effective_effects(measure)
            for district in targets:
                assert district is not None
                for criterion, effect in effects.items():
                    after_values[district][criterion] = min(
                        100, max(0, after_values[district][criterion] + effect)
                    )
            contributions.append(
                {
                    "id": measure["id"],
                    "name": measure["name"],
                    "district": item["district"] or "город",
                    "lag": measure["lag"],
                    "priority": self.measure_priority(measure),
                    "effects": {key: round2(value) for key, value in effects.items()},
                }
            )

        selected_by_id = {item["id"]: item for item in selections}
        synergies = []
        for rule in self.data["synergies"]:
            first_id, second_id = rule["measures"]
            if first_id not in selected_by_id or second_id not in selected_by_id:
                continue
            target = (
                selected_by_id[first_id]["district"]
                if rule["target"] == "firstMeasureDistrict"
                else self.district_names[0]
            )
            if target not in self.districts:
                raise ModelValidationError("Синергия не содержит корректный целевой район.")
            after_values[target][rule["criterion"]] = min(
                100, after_values[target][rule["criterion"]] + rule["amount"]
            )
            synergies.append(
                {
                    "pair": f"{first_id} + {second_id}",
                    "district": target,
                    "criterion": rule["criterion"],
                    "amount": rule["amount"],
                }
            )

        before = self.summarize(before_values)
        after = self.summarize(after_values)
        direction_scores = {
            direction["id"]: round2(self.direction_score(after_values, direction))
            for direction in self.directions
        }
        district_deltas = {
            name: round2(after["districtScores"][name] - before["districtScores"][name])
            for name in self.district_names
        }
        criterion_deltas = {
            name: {
                criterion: round2(after_values[name][criterion] - before_values[name][criterion])
                for criterion in self.criteria
            }
            for name in self.district_names
        }
        return {
            "formula": self.model["formula"],
            "horizonQuarters": self.model["horizonQuarters"],
            "before": before,
            "after": after,
            "delta": round2(after["score"] - before["score"]),
            "directionScores": direction_scores,
            "districtDeltas": district_deltas,
            "criterionDeltas": criterion_deltas,
            "contributions": contributions,
            "synergies": synergies,
        }


ENGINE = ModelEngine(load_model())

