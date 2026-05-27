from __future__ import annotations

import unittest

from tools.json_policy import JsonPolicyError, strict_json_loads


class JsonPolicyTest(unittest.TestCase):
    def test_strict_json_rejects_non_standard_constants(self) -> None:
        for value in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(value=value):
                with self.assertRaisesRegex(JsonPolicyError, "non-standard JSON constant"):
                    strict_json_loads(f'{{"value": {value}}}')

    def test_strict_json_still_accepts_standard_json(self) -> None:
        self.assertEqual({"value": None}, strict_json_loads('{"value": null}'))


if __name__ == "__main__":
    unittest.main()
