"""Strict JSON helpers shared by repository tooling.

Python's `json.loads` accepts non-standard constants such as `NaN` and
`Infinity` unless told otherwise. Repository checks and planning tools use this
module when reading protocol or dependency metadata so local validation matches
the stricter JSON shape expected by runtime parsers.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import NoReturn


class JsonPolicyError(ValueError):
    pass


def strict_json_loads(text: str) -> object:
    try:
        return json.loads(
            text,
            object_pairs_hook=reject_duplicate_keys,
            parse_constant=reject_json_constant,
        )
    except json.JSONDecodeError as error:
        raise JsonPolicyError(str(error)) from error


def read_strict_json(path: Path) -> object:
    return strict_json_loads(path.read_text(encoding="utf-8"))


def reject_duplicate_keys(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise JsonPolicyError(f"duplicate JSON object key is not allowed: {key}")
        result[key] = value
    return result


def reject_json_constant(value: str) -> NoReturn:
    raise JsonPolicyError(f"non-standard JSON constant is not allowed: {value}")
