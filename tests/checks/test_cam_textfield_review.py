"""Review first-party plain text fields without changing CAM conformance.

A declared format is checked by the UI parser. Plain fields must be recorded
here as intentional unrestricted input. This is an authoring check, not proof
that a format matches a route or contract.
"""

from __future__ import annotations

import unittest
from collections import Counter
from pathlib import Path

from .cam_manifest_resources import CamManifestResourceValidator
from .common import ROOT
from tools.cam_resource_integrity import local_resource_path


# Entries identify one occurrence whose contract deliberately accepts arbitrary
# text. The count check prevents silently extending an exception.
PLAIN_FIELDS: dict[tuple[str, str, str, str], str] = {
    ("bike-nft", "entry", "accountInfo", "Public profile text or link"): "intentional: arbitrary text is accepted and empty clears the profile",
}


def text_fields(value: object):
    if not isinstance(value, dict):
        return
    if value.get("element") == "TextField":
        yield value
    children = value.get("children")
    if isinstance(children, list):
        for child in children:
            yield from text_fields(child)


def declared_bound(value: object) -> bool:
    return isinstance(value, str) and (value.startswith("$") and len(value) > 1 or bool(value) and all(char in "0123456789" for char in value))


def review_ui(app: str, document: dict[str, object], reviewed: dict[tuple[str, str, str, str], str]) -> tuple[list[str], Counter]:
    failures: list[str] = []
    seen: Counter = Counter()
    nodes = document.get("nodes")
    if not isinstance(nodes, dict):
        return [f"{app}: UI nodes must be an object"], seen
    for node_name, node in nodes.items():
        for field in text_fields(node):
            props, state = field.get("props"), field.get("state")
            if not isinstance(props, dict) or not isinstance(state, dict):
                failures.append(f"{app}:{node_name}: TextField requires props and state")
                continue
            label, key = props.get("label"), state.get("key")
            if not isinstance(label, str) or not isinstance(key, str):
                failures.append(f"{app}:{node_name}: TextField label and state key must be strings for authoring review")
                continue
            identity = (app, node_name, key, label)
            seen[identity] += 1
            format_name = props.get("format")
            byte_length = props.get("byteLength")
            minimum, maximum = props.get("minBytes"), props.get("maxBytes")
            has_bounds = "minBytes" in props or "maxBytes" in props
            bounds_valid = all(bound is None or declared_bound(bound) for bound in (minimum, maximum))
            bounded = bounds_valid and any(isinstance(bound, str) and (bound.startswith("$") or any(char != "0" for char in bound)) for bound in (minimum, maximum))
            valid_address = format_name == "address" and "byteLength" not in props and not has_bounds
            valid_hex = format_name == "hex" and type(byte_length) is int and 1 <= byte_length <= 4503599627370495 and not has_bounds
            if valid_address or valid_hex or (format_name is None and "byteLength" not in props and bounded):
                if identity in reviewed:
                    failures.append(f"{app}:{node_name}:{key}: remove the plain-field decision after adding validation")
            elif format_name is not None or "byteLength" in props or minimum is not None or maximum is not None:
                failures.append(f"{app}:{node_name}:{key}: invalid or ineffective TextField validation")
            else:
                reason = reviewed.get(identity)
                if not isinstance(reason, str) or not reason.startswith("intentional: ") or len(reason.split()) < 3:
                    failures.append(f"{app}:{node_name}:{key}: plain TextField requires a documented validation or free-text decision")
    return failures, seen


class CamTextFieldReviewTest(unittest.TestCase):
    def test_review_rejects_new_plain_fields_and_unknown_formats(self) -> None:
        def field(props: dict[str, object]) -> dict[str, object]:
            return {"nodes": {"edit": {"element": "TextField", "props": props, "state": {"key": "value"}}}}

        self.assertTrue(review_ui("sample", field({"label": "Value"}), {})[0])
        self.assertTrue(review_ui("sample", field({"label": "Value", "format": "anything"}), {})[0])
        for props in ({"label": "Value", "format": "address"}, {"label": "Value", "format": "hex", "byteLength": 32}, {"label": "Value", "minBytes": "1"}, {"label": "Value", "maxBytes": "$view.limit"}):
            with self.subTest(props=props):
                self.assertEqual([], review_ui("sample", field(props), {})[0])
        for props in ({"label": "Value", "format": "hex"}, {"label": "Value", "minBytes": "0"}, {"label": "Value", "minBytes": "000"}, {"label": "Value", "maxBytes": "nonsense"}, {"label": "Value", "format": "bytes32"}, {"label": "Value", "format": "address", "minBytes": "1"}):
            with self.subTest(props=props):
                self.assertTrue(review_ui("sample", field(props), {})[0])
        decision = {("sample", "edit", "value", "Value"): "intentional: optional free text"}
        self.assertEqual([], review_ui("sample", field({"label": "Value"}), decision)[0])
        self.assertTrue(review_ui("sample", field({"label": "Changed"}), decision)[0])
        self.assertTrue(review_ui("sample", field({"label": "Value"}), {("sample", "edit", "value", "Value"): "unreviewed"})[0])
        self.assertTrue(review_ui("sample", field({"label": "Value"}), {("sample", "edit", "value", "Value"): "debt: validation not implemented"})[0])
        self.assertTrue(review_ui("sample", field({"label": "Value", "format": "address"}), decision)[0])

    def test_nested_fields_and_duplicate_decisions_are_accounted_for(self) -> None:
        field = {"element": "TextField", "props": {"label": "Value"}, "state": {"key": "value"}}
        decision = {("sample", "edit", "value", "Value"): "intentional: free text"}
        document = {"nodes": {"edit": {"element": "Fragment", "children": [field, field]}}}
        failures, seen = review_ui("sample", document, decision)
        self.assertEqual([], failures)
        self.assertEqual(2, seen[("sample", "edit", "value", "Value")])

    def test_first_party_fields_are_reviewed(self) -> None:
        validator = CamManifestResourceValidator()
        failures: list[str] = []
        seen: Counter = Counter()
        for manifest_path in validator.cam_manifests():
            manifest = validator.read_json_object(manifest_path)
            resources, problems = validator.manifest_resource_declarations(manifest_path, manifest)
            failures.extend(problems)
            paths: set[Path] = set()
            for _namespace, declaration, uri_key, _integrity, field_path in resources:
                if declaration.get("type") == "ui":
                    paths.add(local_resource_path(manifest_path, declaration[uri_key], field_path))
            app = manifest_path.parent.parent.name
            for path in sorted(paths):
                issues, counts = review_ui(app, validator.read_json_object(path), PLAIN_FIELDS)
                failures.extend(f"{path.relative_to(ROOT)}: {issue}" for issue in issues)
                seen.update(counts)
        for identity, reason in PLAIN_FIELDS.items():
            if seen[identity] != 1:
                failures.append(f"{identity}: reviewed field occurs {seen[identity]} times ({reason})")
        if failures:
            self.fail("\n".join(failures))
