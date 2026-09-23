"""Deterministic regression tests for the city simulation model.

The tests use only Python's standard library and the editable JSON model, so
they can be run on Windows through test.bat without Node.js or an API key.
"""

from __future__ import annotations

import copy
import json
import math
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = json.loads((ROOT / "data" / "model-data.json").read_text(encoding="utf-8"))


def round2(value: float) -> float:
    """Match the browser's two-decimal display rounding for model results."""
    return math.floor(value * 100 + 0.5) / 100


class ModelEngine:
    def __init__(self, data: dict) -> None:
        self.data = data
        self.model = data["model"]
        self.criteria = data["criteria"]
        self.districts = data["districts"]
        self.district_names = list(self.districts)
        self.measures = {measure["id"]: measure for measure in data["measures"]}

    def validate(self, selections: list[tuple[str, str | None]]) -> str:
        if len(selections) > self.model["requiredDecisions"]:
            return f"Можно выбрать ровно {self.model['requiredDecisions']} мероприятий."
        items = [(self.measures[measure_id], district) for measure_id, district in selections]
        if sum(measure["price"] for measure, _ in items) > self.model["budget"]:
            return f"Превышен бюджет {self.model['budget']} {self.model['budgetUnit']}"

        direction_counts: dict[str, int] = {}
        selected = {}
        for measure, district in items:
            if measure["type"] == "district" and not district:
                return "Для районной меры нужно выбрать район."
            direction_counts[measure["direction"]] = direction_counts.get(measure["direction"], 0) + 1
            selected[measure["id"]] = district
        if any(count > self.model["maxMeasuresPerDirection"] for count in direction_counts.values()):
            return f"В одном направлении допускается не более {self.model['maxMeasuresPerDirection']} мер."

        for constraint in self.data["constraints"]:
            first, second = constraint["measures"]
            if first not in selected or second not in selected:
                continue
            if constraint["scope"] == "global" or selected[first] == selected[second]:
                return constraint["message"]
        return ""

    def simulate(self, selections: list[tuple[str, str | None]]) -> dict:
        before_values = {name: copy.deepcopy(district["values"]) for name, district in self.districts.items()}
        after_values = copy.deepcopy(before_values)

        for measure_id, district in selections:
            measure = self.measures[measure_id]
            targets = self.district_names if measure["type"] == "city" else [district]
            factor = (self.model["horizonQuarters"] - measure["lag"]) / self.model["horizonQuarters"]
            for target in targets:
                for criterion, effect in measure["effects"].items():
                    after_values[target][criterion] = max(0, min(100, after_values[target][criterion] + effect * factor))

        selected_districts = dict(selections)
        synergies = []
        for synergy in self.data["synergies"]:
            first, second = synergy["measures"]
            if first not in selected_districts or second not in selected_districts:
                continue
            target = selected_districts[first]
            after_values[target][synergy["criterion"]] = min(100, after_values[target][synergy["criterion"]] + synergy["amount"])
            synergies.append(synergy)

        before = self.summarize(before_values)
        after = self.summarize(after_values)
        deltas = {name: round2(after["districtScores"][name] - before["districtScores"][name]) for name in self.district_names}
        return {"before": before, "after": after, "delta": round2(after["score"] - before["score"]), "districtDeltas": deltas, "synergies": synergies}

    def summarize(self, values: dict) -> dict:
        district_scores = {
            name: sum(values[name][criterion] * config["weight"] for criterion, config in self.criteria.items())
            for name in self.district_names
        }
        average = sum(self.districts[name]["population"] * district_scores[name] for name in self.district_names)
        minimum = min(district_scores.values())
        critical = sum(
            value < self.model["criticalThreshold"]
            for district in values.values()
            for value in district.values()
        )
        weights = self.model["scoreWeights"]
        score = weights["average"] * average + weights["minimum"] * minimum - weights["criticalPenalty"] * critical
        return {"districtScores": district_scores, "average": round2(average), "minimum": round2(minimum), "critical": critical, "score": round2(score)}


class ModelTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = ModelEngine(DATA)

    def test_complete_model_and_baseline_score(self) -> None:
        self.assertEqual(len(self.engine.districts), 5)
        self.assertEqual(len(self.engine.measures), 14)
        self.assertEqual(self.engine.model["budget"], 100)
        self.assertEqual(self.engine.summarize({name: district["values"] for name, district in self.engine.districts.items()})["score"], 52.56)

    def test_documented_control_scenario(self) -> None:
        selections = [("M7", "Нура"), ("M8", "Нура"), ("M10", "Нура"), ("M12", None), ("M5", "Сарыарка")]
        result = self.engine.simulate(selections)
        self.assertEqual(sum(self.engine.measures[item]["price"] for item, _ in selections), 95)
        self.assertEqual(self.engine.validate(selections), "")
        self.assertEqual(result["after"]["score"], 56.54)
        self.assertEqual(result["delta"], 3.98)
        self.assertEqual(result["after"]["critical"], 0)
        self.assertEqual(len(result["synergies"]), 1)

    def test_exceeding_budget_is_rejected(self) -> None:
        selections = [("M3", "Есиль"), ("M13", "Алматы"), ("M7", "Нура"), ("M2", None), ("M10", "Байконур")]
        self.assertEqual(self.engine.validate(selections), "Превышен бюджет 100 усл. ед.")

    def test_direction_limit_and_incompatibility(self) -> None:
        self.assertEqual(
            self.engine.validate([("M1", "Есиль"), ("M2", None), ("M3", "Алматы")]),
            "В одном направлении допускается не более 2 мер.",
        )
        self.assertEqual(
            self.engine.validate([("M1", "Есиль"), ("M3", "Алматы")]),
            "M1 и M3 несовместимы: выберите BRT или ЛРТ.",
        )

    def test_city_measure_changes_every_district(self) -> None:
        result = self.engine.simulate([("M12", None)])
        self.assertEqual(result["districtDeltas"], {name: 0.44 for name in self.engine.district_names})


if __name__ == "__main__":
    unittest.main(verbosity=2)
