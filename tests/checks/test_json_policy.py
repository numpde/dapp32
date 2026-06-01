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


if __name__ == "__main__":
    unittest.main()
