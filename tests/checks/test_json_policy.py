from __future__ import annotations

import unittest

from tools.json_policy import JsonPolicyError, strict_json_loads


class JsonPolicyTest(unittest.TestCase):
    def test_strict_json_rejects_duplicate_object_keys(self) -> None:
        with self.assertRaisesRegex(JsonPolicyError, "duplicate JSON object key"):
            strict_json_loads('{"cam":"1.0.0","cam":"2.0.0"}')

    def test_strict_json_rejects_non_standard_constants(self) -> None:
        for value in ("NaN", "Infinity", "-Infinity"):
            with self.subTest(value=value), self.assertRaisesRegex(JsonPolicyError, "non-standard JSON constant"):
                strict_json_loads(value)

    def test_strict_json_rejects_nested_exponents_outside_finite_float_range(self) -> None:
        for value in ("1e400", "-1e400"):
            with self.subTest(value=value), self.assertRaisesRegex(JsonPolicyError, "outside the finite number range"):
                strict_json_loads(f'{{"nested":[{value}]}}')

    def test_strict_json_accepts_finite_exponents(self) -> None:
        self.assertEqual({"nested": [1e300, -1e-300]}, strict_json_loads('{"nested":[1e300,-1e-300]}'))


if __name__ == "__main__":
    unittest.main()
