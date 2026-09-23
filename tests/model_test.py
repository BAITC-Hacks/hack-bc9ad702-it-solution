"""Regression and server-validation tests for the canonical model engine."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from model_engine import ENGINE, ModelValidationError  # noqa: E402
from server import build_verified_payload  # noqa: E402


def selection(measure_id: str, district: str | None = None) -> dict:
    return {"id": measure_id, "district": district}


CONTROL_SCENARIO = [
    selection("M7", "Нура"),
    selection("M8", "Нура"),
    selection("M10", "Нура"),
    selection("M12"),
    selection("M5", "Сарыарка"),
]


class ModelTests(unittest.TestCase):
    def test_complete_model_and_baseline_score(self) -> None:
        baseline = {name: district["values"] for name, district in ENGINE.districts.items()}
        self.assertEqual(len(ENGINE.districts), 5)
        self.assertEqual(len(ENGINE.measures), 14)
        self.assertEqual(ENGINE.model["budget"], 100)
        self.assertEqual(ENGINE.summarize(baseline)["score"], 52.56)

    def test_documented_control_scenario(self) -> None:
        result = ENGINE.simulate(CONTROL_SCENARIO)
        self.assertEqual(ENGINE.spent(ENGINE.validate(CONTROL_SCENARIO)), 95)
        self.assertEqual(result["after"]["score"], 56.54)
        self.assertEqual(result["delta"], 3.98)
        self.assertEqual(result["after"]["critical"], 0)
        self.assertEqual(len(result["synergies"]), 1)

    def test_exactly_five_unique_decisions_are_required(self) -> None:
        with self.assertRaisesRegex(ModelValidationError, "ровно 5"):
            ENGINE.simulate([selection("M12")])
        with self.assertRaisesRegex(ModelValidationError, "несколько раз"):
            ENGINE.simulate([selection("M12")] * 5)

    def test_exceeding_budget_is_rejected(self) -> None:
        scenario = [
            selection("M3", "Есиль"),
            selection("M13", "Алматы"),
            selection("M7", "Нура"),
            selection("M2"),
            selection("M10", "Байконур"),
        ]
        with self.assertRaisesRegex(ModelValidationError, "Превышен бюджет"):
            ENGINE.simulate(scenario)

    def test_direction_limit_and_incompatibility(self) -> None:
        with self.assertRaisesRegex(ModelValidationError, "не более 2"):
            ENGINE.validate([selection("M1", "Есиль"), selection("M2"), selection("M3", "Алматы")])
        with self.assertRaisesRegex(ModelValidationError, "несовместимы"):
            ENGINE.validate([selection("M1", "Есиль"), selection("M3", "Алматы")])

    def test_city_measure_changes_every_district(self) -> None:
        scenario = [
            selection("M1", "Есиль"),
            selection("M4", "Алматы"),
            selection("M9", "Нура"),
            selection("M10", "Байконур"),
            selection("M12"),
        ]
        result = ENGINE.simulate(scenario)
        for district in ENGINE.district_names:
            self.assertGreaterEqual(result["districtDeltas"][district], 0.44)

    def test_server_ignores_client_prices_and_scores(self) -> None:
        tampered = [
            {**item, "price": 0, "title": "Подмена", "simulation": {"after": {"score": 100}}}
            for item in CONTROL_SCENARIO
        ]
        payload = build_verified_payload(tampered)
        self.assertEqual(payload["spent"], 95)
        self.assertEqual(payload["simulation"]["after"]["score"], 56.54)
        self.assertNotEqual(payload["selections"][0]["title"], "Подмена")

    def test_all_demo_scenarios_are_valid(self) -> None:
        presets = [
            [selection("M2"), selection("M4", "Нура"), selection("M8", "Нура"), selection("M10", "Байконур"), selection("M12")],
            [selection("M1", "Нура"), selection("M5", "Сарыарка"), selection("M7", "Нура"), selection("M10", "Нура"), selection("M12")],
            [selection("M2"), selection("M6"), selection("M9", "Нура"), selection("M10", "Нура"), selection("M12")],
        ]
        results = [ENGINE.simulate(preset) for preset in presets]
        self.assertEqual([ENGINE.spent(ENGINE.validate(preset)) for preset in presets], [83, 93, 78])
        self.assertTrue(all(result["after"]["score"] > result["before"]["score"] for result in results))

    def test_unknown_measure_and_invalid_district_are_rejected(self) -> None:
        with self.assertRaisesRegex(ModelValidationError, "Неизвестное"):
            ENGINE.validate([selection("M999", "Нура")])
        with self.assertRaisesRegex(ModelValidationError, "существующий район"):
            ENGINE.validate([selection("M1", "Несуществующий")])


if __name__ == "__main__":
    unittest.main(verbosity=2)
