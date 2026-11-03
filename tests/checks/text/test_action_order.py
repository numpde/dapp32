"""Flag adjacent quiet-then-prominent JSX buttons in app source.

This text check covers literal class names and directly adjacent button elements.
It cannot infer computed styles, conditional rendering, or arbitrary JSX; browser
checks own actual visual and keyboard order.
"""

from __future__ import annotations

import re
import unittest

from ..common import ROOT


BUTTON_PAIRS = re.compile(
    r"(?=(<button\b(?:(?!</button>).)*?</button>)\s*(<button\b(?:(?!</button>).)*?</button>))",
    re.DOTALL,
)
CLASS = re.compile(r'''\bclassName\s*=\s*(["'])(.*?)\1''', re.DOTALL)
DYNAMIC_CLASS = re.compile(r"\bclassName\s*=\s*\{")


def opening_tag(button: str) -> str:
    depth = 0
    quote = ""
    escaped = False
    for index, char in enumerate(button):
        if quote:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote:
                quote = ""
        elif char in "\"'`":
            quote = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
        elif char == ">" and depth == 0:
            return button[: index + 1]
    return button


def reversed_action_lines(source: str) -> list[int]:
    lines = []
    for pair in BUTTON_PAIRS.finditer(source):
        first, second = opening_tag(pair.group(1)), opening_tag(pair.group(2))
        first_class = CLASS.search(first)
        second_class = CLASS.search(second)
        if first_class is None or "button-quiet" not in first_class.group(2).split():
            continue
        if DYNAMIC_CLASS.search(second):
            continue
        if second_class is not None and "button-quiet" in second_class.group(2).split():
            continue
        lines.append(source.count("\n", 0, pair.start()) + 1)
    return lines


class ActionOrderTest(unittest.TestCase):
    def test_secondary_precedes_primary_is_flagged(self) -> None:
        for source in (
            '<button className="button-quiet" onClick={() => cancel()}>Back</button><button>Continue</button>',
            "<button className='button-quiet other'>Dismiss</button>\n<button className='send-button'>Send</button>",
            '<button className="button-quiet">One</button><button className="button-quiet">Two</button><button>Save</button>',
        ):
            with self.subTest(source=source):
                self.assertTrue(reversed_action_lines(source))

    def test_primary_first_and_ambiguous_pairs_are_not_flagged(self) -> None:
        for source in (
            '<button>Save</button><button className="button-quiet">Cancel</button>',
            '<button className="button-quiet">One</button><button className="button-quiet">Two</button>',
            '<button className="button-quiet">Cancel</button><button className={kind}>Save</button>',
            '<button><span className="button-quiet">Text</span></button><button>Save</button>',
            '<button className="button-quiet">Cancel</button></div><div><button>Save</button>',
        ):
            with self.subTest(source=source):
                self.assertEqual([], reversed_action_lines(source))

    def test_app_actions_put_prominent_button_before_quiet_button(self) -> None:
        findings = []
        for path in sorted((ROOT / "js/apps").glob("*/src/**/*.tsx")):
            for line in reversed_action_lines(path.read_text(encoding="utf-8")):
                findings.append(f"{path.relative_to(ROOT)}:{line}")
        self.assertEqual([], findings, "Put the prominent action before the quiet action in JSX source order.")
