from __future__ import annotations

import unittest

from .cam_expressions import expression_first_segment, expression_references


class CamExpressionTest(unittest.TestCase):
    def test_expression_references_walk_nested_json_and_ignore_escaped_dollars(self) -> None:
        self.assertEqual(
            expression_references(
                "root",
                {
                    "literal": "$$view.title",
                    "match": "$view.title",
                    "nested": ["text", "$view.actions.0"],
                    "other": "$outputs.0",
                },
                "view",
            ),
            [
                ("root.match", "$view.title"),
                ("root.nested.1", "$view.actions.0"),
            ],
        )

    def test_expression_first_segment_requires_the_requested_root(self) -> None:
        self.assertEqual(expression_first_segment("$outputs.10.status", "outputs"), "10")
        self.assertIsNone(expression_first_segment("$outputs", "outputs"))
        self.assertIsNone(expression_first_segment("$outputs.0", "view"))


if __name__ == "__main__":
    unittest.main()
