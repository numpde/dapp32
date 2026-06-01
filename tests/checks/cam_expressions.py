from __future__ import annotations


def expression_references(path: str, value: object, root: str) -> list[tuple[str, str]]:
    root_expression = f"${root}"
    if isinstance(value, str):
        if value.startswith("$$"):
            return []
        if value == root_expression or value.startswith(f"{root_expression}."):
            return [(path, value)]
        return []

    if isinstance(value, list):
        references: list[tuple[str, str]] = []
        for index, item in enumerate(value):
            references.extend(expression_references(f"{path}.{index}", item, root))
        return references

    if isinstance(value, dict):
        references = []
        for key, item in value.items():
            references.extend(expression_references(f"{path}.{key}", item, root))
        return references

    return []


def expression_first_segment(reference: str, root: str) -> str | None:
    root_expression = f"${root}"
    if reference == root_expression:
        return None
    if not reference.startswith(f"{root_expression}."):
        return None

    segment = reference.removeprefix(f"{root_expression}.").split(".", 1)[0]
    if segment == "":
        return None

    return segment
