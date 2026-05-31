from __future__ import annotations

import re
import unittest
from pathlib import Path

from ..common import ROOT
from .test_shared_scanner import line_findings, repo_files


MAKE_DEFAULT_ASSIGNMENT_RE = re.compile(
    r"^(?:export\s+|override\s+)?(?P<name>[A-Za-z0-9_./-]+)\s*\?=\s*(?P<value>.*)$"
)
MAKE_FUNCTION_DEFAULT_RE = re.compile(r"\$\((?:or|if)\b[^)]*\)")
SHELL_DEFAULT_EXPANSION_RE = re.compile(
    r"\$\{(?P<name>[A-Za-z_][A-Za-z0-9_]*|[0-9]+|[#$!?*@_-])(?P<operator>:?[-=])(?P<value>[^}]*)\}"
)
SHELL_SILENT_SUCCESS_RE = re.compile(r"\|\|\s*(?:true|:)\b")
DOCKER_ARG_DEFAULT_RE = re.compile(r"^\s*ARG\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)(?:=(?P<value>.*))?\s*$")
DOCKER_ENV_ASSIGNMENT_RE = re.compile(r"^\s*ENV\s+(?P<body>.+)$")
DOCKER_KEY_VALUE_ENV_TOKEN_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=(?P<value>.*)$")
DOCKER_LEGACY_ENV_TOKEN_RE = re.compile(r"^(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s+(?P<value>.+)$")
ENV_ASSIGNMENT_RE = re.compile(r"^(?:export\s+)?(?P<name>[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?P<value>.*)$")
YAML_ENV_LIST_ASSIGNMENT_RE = re.compile(r"^\s*-\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*)=(?P<value>.*)$")
YAML_ENV_MAPPING_BLANK_RE = re.compile(r"^\s+(?P<name>[A-Za-z_][A-Za-z0-9_]*):\s*(?:#.*)?$")
YAML_ENVIRONMENT_BLOCK_RE = re.compile(r"^(?P<indent>\s*)environment:\s*$")
WORKFLOW_DEFAULT_FIELD_RE = re.compile(r"^\s*default:\s*(?P<value>.*)$")


def ops_files() -> list[Path]:
    return repo_files(
        (
            "Makefile",
            "*.mk",
            "compose/**/*.yml",
            "compose/**/*.yaml",
            "containers/**/Dockerfile",
            "containers/**/*.sh",
            "tools/**/*.sh",
            ".github/workflows/*.yml",
            ".github/workflows/*.yaml",
            "*.env",
            "*.env.example",
            "**/*.env",
            "**/*.env.example",
        )
    )


class OpsSilentDefaultsTest(unittest.TestCase):
    maxDiff = None

    def test_matchers_flag_representative_ops_defaults(self) -> None:
        self.assertRegex("PROFILE ?= demo", MAKE_DEFAULT_ASSIGNMENT_RE)
        self.assertRegex("$(or $(PROFILE),demo)", MAKE_FUNCTION_DEFAULT_RE)
        self.assertRegex("${PROFILE:-demo}", SHELL_DEFAULT_EXPANSION_RE)
        self.assertRegex("make clean || true", SHELL_SILENT_SUCCESS_RE)
        self.assertRegex("ARG SOLC_VERSION=0.8.35", DOCKER_ARG_DEFAULT_RE)
        self.assertRegex("TOKEN=", DOCKER_KEY_VALUE_ENV_TOKEN_RE)
        self.assertRegex("ENV XDG_DATA_HOME /usr/local/share", DOCKER_ENV_ASSIGNMENT_RE)
        self.assertRegex("XDG_DATA_HOME /usr/local/share", DOCKER_LEGACY_ENV_TOKEN_RE)
        self.assertRegex("FOO=", ENV_ASSIGNMENT_RE)
        self.assertRegex("      - FOO=", YAML_ENV_LIST_ASSIGNMENT_RE)
        self.assertRegex("    environment:", YAML_ENVIRONMENT_BLOCK_RE)
        self.assertRegex("      FOO:", YAML_ENV_MAPPING_BLANK_RE)

    def test_ops_files_do_not_publish_silent_defaults(self) -> None:
        files = ops_files()
        findings: list[str] = []
        findings.extend(line_findings(files, MAKE_DEFAULT_ASSIGNMENT_RE, "make ?= default"))
        findings.extend(line_findings(files, MAKE_FUNCTION_DEFAULT_RE, "make function fallback"))
        findings.extend(line_findings(files, SHELL_DEFAULT_EXPANSION_RE, "shell/compose interpolation default"))
        findings.extend(line_findings(files, SHELL_SILENT_SUCCESS_RE, "shell silent success fallback"))
        findings.extend(line_findings(files, WORKFLOW_DEFAULT_FIELD_RE, "workflow dispatch default"))

        for path in files:
            environment_indent: int | None = None
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                if line.lstrip().startswith("#"):
                    continue
                block_match = YAML_ENVIRONMENT_BLOCK_RE.match(line)
                if block_match:
                    environment_indent = len(block_match.group("indent"))
                    continue
                if environment_indent is not None and line.strip():
                    current_indent = len(line) - len(line.lstrip())
                    if current_indent <= environment_indent:
                        environment_indent = None
                arg_match = DOCKER_ARG_DEFAULT_RE.match(line)
                if arg_match and arg_match.group("value") is not None:
                    findings.append(f"{path.relative_to(ROOT)}:{line_number}: Docker ARG default: {line.strip()}")
                env_match = DOCKER_ENV_ASSIGNMENT_RE.match(line)
                if env_match:
                    body = env_match.group("body").strip()
                    for token in body.split():
                        if DOCKER_KEY_VALUE_ENV_TOKEN_RE.match(token):
                            findings.append(f"{path.relative_to(ROOT)}:{line_number}: Docker ENV default: {token}")
                    legacy_match = DOCKER_LEGACY_ENV_TOKEN_RE.match(body)
                    if legacy_match:
                        findings.append(f"{path.relative_to(ROOT)}:{line_number}: Docker ENV default: {body}")
                assignment_match = ENV_ASSIGNMENT_RE.match(line.strip())
                if assignment_match and assignment_match.group("value").strip() in {"", '""', "''"}:
                    findings.append(
                        f"{path.relative_to(ROOT)}:{line_number}: blank env assignment: "
                        f"{assignment_match.group('name')}={assignment_match.group('value')}"
                    )
                yaml_list_match = YAML_ENV_LIST_ASSIGNMENT_RE.match(line)
                if yaml_list_match and yaml_list_match.group("value").strip() in {"", '""', "''"}:
                    findings.append(
                        f"{path.relative_to(ROOT)}:{line_number}: blank compose env assignment: "
                        f"{yaml_list_match.group('name')}="
                    )
                yaml_mapping_match = YAML_ENV_MAPPING_BLANK_RE.match(line) if environment_indent is not None else None
                if yaml_mapping_match:
                    findings.append(
                        f"{path.relative_to(ROOT)}:{line_number}: blank compose env mapping: "
                        f"{yaml_mapping_match.group('name')}:"
                    )

        self.assertEqual([], findings)


if __name__ == "__main__":
    unittest.main()
