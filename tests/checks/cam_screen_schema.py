from __future__ import annotations

import re
from pathlib import Path


SCREEN_EXPRESSION_RE = re.compile(
    r"^\$(host|account|params|state|values)(\.(?:[A-Za-z][A-Za-z0-9_]*|0|[1-9][0-9]*))*$"
)
SCREEN_VERSION = "1.0.0"
SCREEN_TOP_LEVEL_KEYS = frozenset({"screen", "title", "elements"})
SCREEN_COMMON_ELEMENT_KEYS = frozenset({"type", "visibleWhen"})
SCREEN_ELEMENT_KEYS = {
    "text": SCREEN_COMMON_ELEMENT_KEYS | {"text"},
    "input": SCREEN_COMMON_ELEMENT_KEYS | {"name", "label", "value"},
    "address": SCREEN_COMMON_ELEMENT_KEYS | {"label", "address"},
    "button": SCREEN_COMMON_ELEMENT_KEYS | {"label", "action"},
    "status": SCREEN_COMMON_ELEMENT_KEYS | {"label", "value"},
    "nft": SCREEN_COMMON_ELEMENT_KEYS | {"contractAddress", "tokenId"},
    "group": SCREEN_COMMON_ELEMENT_KEYS | {"elements"},
}
SCREEN_ELEMENT_FIELD_RULES = {
    "text": (("text", "expression_string"),),
    "input": (("name", "string"), ("label", "expression_string"), ("value", "expression_payload?")),
    "address": (("label", "expression_string?"), ("address", "expression_string")),
    "button": (("label", "expression_string"),),
    "status": (("label", "expression_string?"), ("value", "expression_payload")),
    "nft": (("contractAddress", "expression_string"), ("tokenId", "expression_payload")),
}
NAVIGATE_ACTION_KEYS = frozenset({"route", "params"})
CONTRACT_CALL_ACTION_KEYS = frozenset({"contract", "function", "args", "onSuccess"})


class CamScreenSchemaValidator:
    def validate_screen_document(self, screen_path: Path, screen: dict[str, object]) -> list[str]:
        failures = self.validate_known_fields(screen_path, "", screen, SCREEN_TOP_LEVEL_KEYS)

        version = screen.get("screen")
        if version != SCREEN_VERSION:
            failures.append(f"{screen_path}: screen must equal {SCREEN_VERSION!r}")

        if "title" in screen:
            failures.extend(self.validate_expression_string(screen_path, "title", screen.get("title")))

        elements = screen.get("elements")
        if not isinstance(elements, list):
            failures.append(f"{screen_path}: elements must be an array")
            return failures

        failures.extend(self.validate_screen_elements(screen_path, "elements", elements))
        return failures

    def validate_screen_elements(self, screen_path: Path, path: str, elements: list[object]) -> list[str]:
        failures: list[str] = []
        for index, element in enumerate(elements):
            failures.extend(self.validate_screen_element(screen_path, f"{path}.{index}", element))

        return failures

    def validate_screen_element(self, screen_path: Path, path: str, element: object) -> list[str]:
        if not isinstance(element, dict):
            return [f"{screen_path}: {path} must be an object"]

        element_type = element.get("type")
        if not isinstance(element_type, str) or element_type == "":
            return [f"{screen_path}: {path}.type must be a non-empty string"]

        allowed_keys = SCREEN_ELEMENT_KEYS.get(element_type)
        if allowed_keys is None:
            return [f"{screen_path}: {path}.type is not a known screen element type: {element_type}"]

        failures = self.validate_known_fields(screen_path, path, element, allowed_keys)
        if "visibleWhen" in element:
            failures.extend(self.validate_expression_payload(screen_path, f"{path}.visibleWhen", element.get("visibleWhen")))

        for field, rule in SCREEN_ELEMENT_FIELD_RULES.get(element_type, ()):
            failures.extend(self.validate_screen_field(screen_path, f"{path}.{field}", element, field, rule))

        if element_type == "button":
            failures.extend(self.validate_screen_action(screen_path, f"{path}.action", element.get("action")))

        if element_type == "group":
            children = element.get("elements")
            if isinstance(children, list):
                failures.extend(self.validate_screen_elements(screen_path, f"{path}.elements", children))
            else:
                failures.append(f"{screen_path}: {path}.elements must be an array")

        return failures

    def validate_screen_field(
        self,
        screen_path: Path,
        path: str,
        source: dict[object, object],
        field: str,
        rule: str,
    ) -> list[str]:
        optional = rule.endswith("?")
        if optional and field not in source:
            return []

        value = source.get(field)
        match rule.removesuffix("?"):
            case "string":
                return self.validate_non_empty_string(screen_path, path, value)
            case "expression_string":
                return self.validate_expression_string(screen_path, path, value)
            case "expression_payload":
                return self.validate_expression_payload(screen_path, path, value)
            case _:
                raise AssertionError(f"unknown screen field rule: {rule}")

    def validate_screen_action(self, screen_path: Path, path: str, action: object) -> list[str]:
        if not isinstance(action, dict):
            return [f"{screen_path}: {path} must be an object"]

        has_route = "route" in action
        has_contract = "contract" in action or "function" in action
        if has_route == has_contract:
            return [f"{screen_path}: {path} must be either navigation or contract call action"]

        return (
            self.validate_navigation_action(screen_path, path, action)
            if has_route
            else self.validate_contract_call_action(screen_path, path, action)
        )

    def validate_navigation_action(self, screen_path: Path, path: str, action: dict[object, object]) -> list[str]:
        failures = self.validate_known_fields(screen_path, path, action, NAVIGATE_ACTION_KEYS)
        failures.extend(self.validate_non_empty_string(screen_path, f"{path}.route", action.get("route")))

        params = action.get("params")
        if not isinstance(params, dict):
            failures.append(f"{screen_path}: {path}.params must be an object")
            return failures

        for name, value in params.items():
            if not isinstance(name, str) or name == "":
                failures.append(f"{screen_path}: {path}.params parameter names must be non-empty strings")
                continue
            failures.extend(self.validate_expression_payload(screen_path, f"{path}.params.{name}", value))

        return failures

    def validate_contract_call_action(self, screen_path: Path, path: str, action: dict[object, object]) -> list[str]:
        failures = self.validate_known_fields(screen_path, path, action, CONTRACT_CALL_ACTION_KEYS)
        failures.extend(self.validate_non_empty_string(screen_path, f"{path}.contract", action.get("contract")))
        failures.extend(self.validate_non_empty_string(screen_path, f"{path}.function", action.get("function")))

        args = action.get("args")
        if isinstance(args, list):
            for index, arg in enumerate(args):
                failures.extend(self.validate_expression_payload(screen_path, f"{path}.args.{index}", arg))
        else:
            failures.append(f"{screen_path}: {path}.args must be an array")

        if "onSuccess" in action:
            on_success = action.get("onSuccess")
            if not isinstance(on_success, dict) or "route" not in on_success or "contract" in on_success or "function" in on_success:
                failures.append(f"{screen_path}: {path}.onSuccess must be a navigation action")
            else:
                failures.extend(self.validate_navigation_action(screen_path, f"{path}.onSuccess", on_success))

        return failures

    def validate_known_fields(
        self,
        source_path: Path,
        path: str,
        source: dict[object, object],
        allowed: frozenset[str],
    ) -> list[str]:
        failures: list[str] = []
        for key in source:
            if not isinstance(key, str) or key not in allowed:
                location = f"{path}.{key}" if path and isinstance(key, str) else path
                failures.append(f"{source_path}: {location} field is not allowed in screen {SCREEN_VERSION}: {key}")

        return failures

    def validate_non_empty_string(self, source_path: Path, path: str, value: object) -> list[str]:
        return [] if isinstance(value, str) and value != "" else [f"{source_path}: {path} must be a non-empty string"]

    def validate_expression_string(self, source_path: Path, path: str, value: object) -> list[str]:
        failures = self.validate_non_empty_string(source_path, path, value)
        if not failures and isinstance(value, str):
            failures.extend(self.validate_expression_syntax(source_path, path, value))

        return failures

    def validate_expression_payload(self, source_path: Path, path: str, value: object) -> list[str]:
        if isinstance(value, str):
            return self.validate_expression_syntax(source_path, path, value)
        if isinstance(value, list):
            failures: list[str] = []
            for index, item in enumerate(value):
                failures.extend(self.validate_expression_payload(source_path, f"{path}.{index}", item))
            return failures
        if isinstance(value, dict):
            failures = []
            for key, item in value.items():
                if not isinstance(key, str) or key == "":
                    failures.append(f"{source_path}: {path} object keys must be non-empty strings")
                    continue
                failures.extend(self.validate_expression_payload(source_path, f"{path}.{key}", item))
            return failures
        if value is None or isinstance(value, (bool, int, float)):
            return []

        return [f"{source_path}: {path} must be a JSON value"]

    def validate_expression_syntax(self, source_path: Path, path: str, value: str) -> list[str]:
        if not value.startswith("$") or SCREEN_EXPRESSION_RE.match(value):
            return []

        return [f"{source_path}: {path} has invalid screen expression: {value}"]
