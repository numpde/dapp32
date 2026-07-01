from __future__ import annotations

import re
import shlex
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
ALLOWED_MAKE_DEFAULTS = {
    "ALLOW_UPDATE": "0",
    "ANVIL_COMPOSE_PROJECT_NAME": "$(COMPOSE_PROJECT_NAME)-anvil",
    "ANVIL_HOST_PORT": "8545",
    "BIKE_NFT_CAM_HASH": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "BIKE_NFT_GUI_BIND_HOST": "127.0.0.1",
    "BIKE_NFT_GUI_ORIGIN": "http://127.0.0.1:$(BIKE_NFT_GUI_PORT)",
    "BIKE_NFT_GUI_PORT": "5173",
    "BIKE_NFT_LOCAL_COMPOSE_PROJECT_NAME": "$(COMPOSE_PROJECT_NAME)-bike-nft-local",
    "BIKE_NFT_VIEWER_GUI_COMPOSE_PROJECT_NAME": "$(COMPOSE_PROJECT_NAME)-bike-nft-viewer-gui",
    "BIKE_NFT_VIEWER_TERMINAL_COMPOSE_PROJECT_NAME": "$(COMPOSE_PROJECT_NAME)-bike-nft-viewer-terminal",
    "CAM_INTEGRATION_RUNS": "1",
    "CAM_INTEGRATION_SEED": "cam-integration-fuzz",
    "CAM_INTEGRATION_STEPS": "16",
    "CAM_URI": "",
    "COMPOSE_DIR": "compose",
    "COMPOSE_PROJECT_NAME": "dapps",
    "DOCKER_COMPOSE": "docker compose",
    "LIVE_CHECK_COMPOSE_PROJECT_NAME": "$(COMPOSE_PROJECT_NAME)-check-live",
    "LOCAL_GID": "$(shell id -g)",
    "LOCAL_UID": "$(shell id -u)",
    "RPC_COMPOSE_PROJECT_NAME": "$(COMPOSE_PROJECT_NAME)-cast-rpc",
    "TEST_INTEGRATION_FUZZ_BIKE_NFT_COMPOSE_PROJECT_NAME": "$(COMPOSE_PROJECT_NAME)-test-integration-fuzz-bike-nft",
    "TEST_INTEGRATION_FUZZ_COMPOSE_PROJECT_NAME": "$(COMPOSE_PROJECT_NAME)-test-integration-fuzz",
    "TEST_INTEGRATION_FUZZ_WITH_WRITES_BIKE_NFT_COMPOSE_PROJECT_NAME": "$(COMPOSE_PROJECT_NAME)-test-integration-fuzz-with-writes-bike-nft",
    "VIEWER_TERMINAL_COMPOSE_PROJECT_NAME": "$(COMPOSE_PROJECT_NAME)-viewer-terminal",
    "VIEWER_TERMINAL_CONTAINER_NAME": "$(VIEWER_TERMINAL_COMPOSE_PROJECT_NAME)-session",
    "VIEWER_TERMINAL_MOCK": "bike-nft",
}
# Docker defaults are path-specific inventory entries. A known variable name in
# one Dockerfile should not silently authorize the same default somewhere else.
ALLOWED_DOCKER_DEFAULTS = {
    ("ARG", "containers/foundry/Dockerfile", "SOLC_VERSION", "0.8.35"),
    ("ENV", "containers/foundry/Dockerfile", "XDG_DATA_HOME", "/usr/local/share"),
}
ALLOWED_SHELL_DEFAULTS = {
    # Compose must render cast-offline without an RPC secret. The Make
    # cast-rpc entrypoint still requires RPC_URL/RPC_URL_FILE before runtime.
    ("compose/cast.yml", "RPC_URL_FILE", ":-", "/dev/null"),
}


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
        self.assertEqual(
            ["Makefile:1: unreviewed Make default assignment: PROFILE ?= demo"],
            make_default_assignment_findings_for_source("PROFILE ?= demo\n", "Makefile"),
        )
        self.assertEqual(
            ["Makefile:1: changed Make default assignment: ANVIL_HOST_PORT ?= 9545"],
            make_default_assignment_findings_for_source("ANVIL_HOST_PORT ?= 9545\n", "Makefile"),
        )
        self.assertEqual(
            ["Dockerfile:1: changed Docker ARG default: ARG SOLC_VERSION=0.8.34"],
            docker_default_findings_for_source(
                "ARG SOLC_VERSION=0.8.34\n",
                "Dockerfile",
                {("ARG", "Dockerfile", "SOLC_VERSION", "0.8.35")},
            ),
        )
        self.assertEqual(
            ["Dockerfile:1: unreviewed Docker ENV default: ENV CACHE_DIR=/tmp/cache"],
            docker_default_findings_for_source(
                "ENV CACHE_DIR=/tmp/cache\n",
                "Dockerfile",
                {("ENV", "Dockerfile", "XDG_DATA_HOME", "/usr/local/share")},
            ),
        )

    def test_ops_files_do_not_publish_silent_defaults(self) -> None:
        files = ops_files()
        findings: list[str] = []
        findings.extend(make_default_assignment_findings(files))
        findings.extend(docker_default_findings(files))
        findings.extend(line_findings(files, MAKE_FUNCTION_DEFAULT_RE, "make function fallback"))
        findings.extend(shell_default_findings(files))
        findings.extend(self.shell_silent_success_findings(files))
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

    def test_allowed_make_defaults_match_exact_values(self) -> None:
        defaults = make_defaults(ROOT / "Makefile")

        self.assertEqual(ALLOWED_MAKE_DEFAULTS, defaults)

    def test_allowed_docker_defaults_match_exact_values(self) -> None:
        defaults = docker_defaults(ops_files())

        self.assertEqual(ALLOWED_DOCKER_DEFAULTS, defaults)

    def test_allowed_shell_defaults_are_present_with_exact_values(self) -> None:
        defaults = shell_defaults(ops_files())

        self.assertEqual(ALLOWED_SHELL_DEFAULTS, defaults)

    def shell_silent_success_findings(self, files: list[Path]) -> list[str]:
        findings: list[str] = []
        for path in files:
            for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                if line.lstrip().startswith("#"):
                    continue
                if not SHELL_SILENT_SUCCESS_RE.search(line):
                    continue
                if path.relative_to(ROOT).as_posix() == "Makefile" and line.startswith("COMPOSE_DOWN_CLEANUP :="):
                    continue
                findings.append(f"{path.relative_to(ROOT)}:{line_number}: shell silent success fallback: {line.strip()}")
        return findings


def make_default_assignment_findings(files: list[Path]) -> list[str]:
    findings: list[str] = []
    for path in files:
        findings.extend(make_default_assignment_findings_for_source(path.read_text(encoding="utf-8"), str(path.relative_to(ROOT))))
    return findings


def make_default_assignment_findings_for_source(source: str, label: str) -> list[str]:
    findings: list[str] = []
    for line_number, line in enumerate(source.splitlines(), start=1):
        if line.lstrip().startswith("#"):
            continue
        match = MAKE_DEFAULT_ASSIGNMENT_RE.match(line)
        if match is None:
            continue
        name = match.group("name")
        value = match.group("value")
        if name not in ALLOWED_MAKE_DEFAULTS:
            findings.append(f"{label}:{line_number}: unreviewed Make default assignment: {line.strip()}")
        elif ALLOWED_MAKE_DEFAULTS[name] != value:
            findings.append(f"{label}:{line_number}: changed Make default assignment: {line.strip()}")
    return findings


def make_defaults(path: Path) -> dict[str, str]:
    defaults: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = MAKE_DEFAULT_ASSIGNMENT_RE.match(line)
        if match is not None:
            defaults[match.group("name")] = match.group("value")
    return defaults


def shell_default_findings(files: list[Path]) -> list[str]:
    findings: list[str] = []
    for path in files:
        label = path.relative_to(ROOT).as_posix()
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if line.lstrip().startswith("#"):
                continue
            for match in SHELL_DEFAULT_EXPANSION_RE.finditer(line):
                default = (label, match.group("name"), match.group("operator"), match.group("value"))
                if default not in ALLOWED_SHELL_DEFAULTS:
                    findings.append(
                        f"{label}:{line_number}: shell/compose interpolation default: {match.group(0).strip()}"
                    )
    return findings


def shell_defaults(files: list[Path]) -> set[tuple[str, str, str, str]]:
    defaults: set[tuple[str, str, str, str]] = set()
    for path in files:
        label = path.relative_to(ROOT).as_posix()
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.lstrip().startswith("#"):
                continue
            for match in SHELL_DEFAULT_EXPANSION_RE.finditer(line):
                defaults.add((label, match.group("name"), match.group("operator"), match.group("value")))

    return defaults


def docker_default_findings(files: list[Path]) -> list[str]:
    findings: list[str] = []
    for path in files:
        findings.extend(docker_default_findings_for_source(
            path.read_text(encoding="utf-8"),
            str(path.relative_to(ROOT)),
            ALLOWED_DOCKER_DEFAULTS,
        ))
    return findings


def docker_default_findings_for_source(
    source: str,
    label: str,
    allowed_defaults: set[tuple[str, str, str, str]],
) -> list[str]:
    findings: list[str] = []
    for line_number, line in enumerate(source.splitlines(), start=1):
        stripped = line.strip()
        if stripped.startswith("#"):
            continue

        arg_match = DOCKER_ARG_DEFAULT_RE.match(line)
        if arg_match is not None and arg_match.group("value") is not None:
            name = arg_match.group("name")
            value = arg_match.group("value")
            allowed_value = docker_allowed_default_value(allowed_defaults, "ARG", label, name)
            if allowed_value is None:
                findings.append(f"{label}:{line_number}: unreviewed Docker ARG default: {stripped}")
            elif allowed_value != value:
                findings.append(f"{label}:{line_number}: changed Docker ARG default: {stripped}")

        env_match = DOCKER_ENV_ASSIGNMENT_RE.match(line)
        if env_match is not None:
            for name, value in docker_env_defaults(env_match.group("body"), label, line_number):
                allowed_value = docker_allowed_default_value(allowed_defaults, "ENV", label, name)
                if allowed_value is None:
                    findings.append(f"{label}:{line_number}: unreviewed Docker ENV default: {stripped}")
                elif allowed_value != value:
                    findings.append(f"{label}:{line_number}: changed Docker ENV default: {stripped}")

    return findings


def docker_allowed_default_value(
    allowed_defaults: set[tuple[str, str, str, str]],
    kind: str,
    label: str,
    name: str,
) -> str | None:
    matches: list[str] = []
    for allowed_kind, allowed_label, allowed_name, value in allowed_defaults:
        if (allowed_kind, allowed_label, allowed_name) == (kind, label, name):
            matches.append(value)

    if len(matches) > 1:
        raise AssertionError(f"duplicate allowed Docker {kind} default inventory entry: {label} {name}")
    return matches[0] if matches else None


def docker_defaults(files: list[Path]) -> set[tuple[str, str, str, str]]:
    defaults: set[tuple[str, str, str, str]] = set()
    for path in files:
        label = str(path.relative_to(ROOT))
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if line.strip().startswith("#"):
                continue
            arg_match = DOCKER_ARG_DEFAULT_RE.match(line)
            if arg_match is not None and arg_match.group("value") is not None:
                defaults.add(("ARG", label, arg_match.group("name"), arg_match.group("value")))
                continue

            env_match = DOCKER_ENV_ASSIGNMENT_RE.match(line)
            if env_match is not None:
                for name, value in docker_env_defaults(
                    env_match.group("body"),
                    label,
                    line_number,
                ):
                    defaults.add(("ENV", label, name, value))

    return defaults


def docker_env_defaults(body: str, label: str, line_number: int) -> list[tuple[str, str]]:
    legacy_match = DOCKER_LEGACY_ENV_TOKEN_RE.match(body)
    if legacy_match is not None:
        return [(legacy_match.group("name"), legacy_match.group("value"))]

    defaults: list[tuple[str, str]] = []
    try:
        tokens = shlex.split(body)
    except ValueError as error:
        raise AssertionError(f"{label}:{line_number}: unparseable Docker ENV default: ENV {body}") from error

    for token in tokens:
        if DOCKER_KEY_VALUE_ENV_TOKEN_RE.match(token) is None:
            raise AssertionError(f"{label}:{line_number}: unparseable Docker ENV default: ENV {body}")
        name, value = token.split("=", 1)
        defaults.append((name, value))

    return defaults


if __name__ == "__main__":
    unittest.main()
