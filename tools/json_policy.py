from __future__ import annotations

import json
from pathlib import Path
from typing import NoReturn


class JsonPolicyError(ValueError):
    pass


def strict_json_loads(text: str) -> object:
    try:
        return json.loads(text, parse_constant=reject_json_constant)
    except json.JSONDecodeError as error:
        raise JsonPolicyError(str(error)) from error


def read_strict_json(path: Path) -> object:
    return strict_json_loads(path.read_text(encoding="utf-8"))


def reject_json_constant(value: str) -> NoReturn:
    raise JsonPolicyError(f"non-standard JSON constant is not allowed: {value}")
