from __future__ import annotations

import unittest

from .cam_screen_schema import CamScreenSchemaValidator
from .common import repo_path


class CamScreenSchemaTest(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = CamScreenSchemaValidator()

    def test_cam_screen_schema_checker_self_check(self) -> None:
        screen_path = repo_path("dapps/example/cam/screens/entry.json")

        self.assertEqual(
            self.validator.validate_screen_document(
                screen_path,
                {
                    "screen": "1.0.0",
                    "title": "$params.serialNumber",
                    "elements": [
                        {"type": "text", "text": "Component"},
                        {
                            "type": "input",
                            "name": "serialNumber",
                            "label": "Serial number",
                            "value": "$state.serialNumber",
                        },
                        {
                            "type": "button",
                            "label": "Look up",
                            "action": {"route": "component", "params": {"serialNumber": "$state.serialNumber"}},
                        },
                    ],
                },
            ),
            [],
        )

        self.assertEqual(
            len(
                self.validator.validate_screen_document(
                    screen_path,
                    {
                        "screen": "1.0.0",
                        "layout": {},
                        "elements": [
                            {"type": "html", "html": "<b>unsafe</b>"},
                            {"type": "button", "label": "Bad", "action": {"route": "x", "contract": "Y"}},
                            {"type": "status", "value": "$bad.root"},
                        ],
                    },
                )
            ),
            4,
        )

    def test_screen_schema_rejects_non_finite_numbers(self) -> None:
        screen_path = repo_path("dapps/example/cam/screens/entry.json")

        for value in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(value=value):
                failures = self.validator.validate_screen_document(
                    screen_path,
                    {
                        "screen": "1.0.0",
                        "elements": [
                            {"type": "status", "label": "Bad number", "value": value},
                        ],
                    },
                )

                self.assertEqual(failures, [f"{screen_path}: elements.0.value must be a JSON value"])
