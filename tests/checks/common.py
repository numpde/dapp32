from __future__ import annotations

import os
from os.path import abspath
from pathlib import Path
import re
import shlex
import subprocess
from typing import Any

from tools.json_policy import strict_json_loads


ROOT = Path(__file__).resolve().parents[2]
DOCKER_COMPOSE_DEFAULT_RE = re.compile(r"^DOCKER_COMPOSE \?= (?P<command>.+)$", re.MULTILINE)
# Rendered Compose posture tests need concrete values for required operator
# inputs before `docker compose config` can produce JSON. These values are test
# fixtures only: they make the positive render inspectable, but they do not
# prove that omitted operator inputs fail closed. Negative render checks should
# own that invariant instead of relying on this fixture map.
RENDERED_COMPOSE_FIXTURE_ENV = {
    "ABI_PLAN_DIR": "/tmp/abi-plan",
    "ALLOW_UPDATE": "0",
    "ANVIL_HOST_PORT": "8545",
    "BIKE_NFT_GUI_BIND_HOST": "127.0.0.1",
    "BIKE_NFT_GUI_PORT": "5173",
    "CAM_PREFLIGHT_ROOT_PATH": "/work/dapps/bike-nft/cam/main.json",
    "CAM_PREFLIGHT_ARGS": "",
    "CAM_URI": "https://example.test/bike-nft/cam/main.json",
    "COMPOSE_PROJECT_NAME": "dapps-check",
    "LOCAL_GID": "1000",
    "LOCAL_UID": "1000",
}

SKIP_DIRS = {
    ".agents",
    ".codex",
    ".git",
    ".idea",
    ".cache",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "broadcast",
    "cache",
    "dependencies",
    "dist",
    "node_modules",
    "out",
    "reports",
}

TEXT_SUFFIXES = {
    ".Dockerfile",
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".patch",
    ".py",
    ".sh",
    ".sol",
    ".ts",
    ".toml",
    ".txt",
    ".yaml",
    ".yml",
}

TEXT_FILENAMES = {
    ".dockerignore",
    ".gitignore",
    "AGENTS.md",
    "Dockerfile",
    "Makefile",
    "remappings.txt",
    "soldeer.lock",
}


def repo_path(path: str) -> Path:
    return ROOT / path


def is_skipped(path: Path) -> bool:
    return any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts)


def iter_files(*roots: str) -> list[Path]:
    paths: list[Path] = []
    for root in roots:
        base = repo_path(root)
        if not base.exists():
            continue
        for path in base.rglob("*"):
            if path.is_file() and not is_skipped(path):
                paths.append(path)
    return sorted(paths)


def iter_repo_text_files() -> list[Path]:
    paths: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file() or is_skipped(path):
            continue
        if path.name in TEXT_FILENAMES or path.suffix in TEXT_SUFFIXES:
            paths.append(path)
    return sorted(paths)


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def path_has_symlink(path: Path) -> bool:
    # Check the unresolved path. Path.resolve() is too late for posture checks:
    # it follows the link and hides the operator-written symlink component.
    absolute = Path(abspath(path))
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current /= part
        if current.is_symlink():
            return True

    return False


def ts_exported_string_constants(source: str) -> dict[str, str]:
    return {
        match.group("name"): match.group("value")
        for match in re.finditer(
            r'^export const (?P<name>[A-Z][A-Z0-9_]*) = "(?P<value>[^"]+)"$',
            source,
            re.MULTILINE,
        )
    }


def protocol_document_version(name: str) -> str:
    # Python checks cannot import the TS package, but valid CAM/UI fixtures
    # should still track the protocol-owned document version constants.
    constants = ts_exported_string_constants(read_text(repo_path("js/packages/cam-protocol/src/versions.ts")))
    value = constants.get(name)
    if value is None:
        raise AssertionError(f"could not read {name} from protocol version owner")
    return value


def rendered_compose_config(compose_file: str | tuple[str, ...], *, env: dict[str, str] | None = None) -> dict[str, Any]:
    render_env = os.environ.copy()
    render_env.update(RENDERED_COMPOSE_FIXTURE_ENV)
    if env is not None:
        render_env.update(env)

    command = docker_compose_command(render_env)
    if isinstance(compose_file, str):
        compose_files = (compose_file,)
    else:
        compose_files = compose_file
    for file in compose_files:
        command.extend(["-f", str(repo_path(file))])
    command.extend(["config", "--format", "json"])

    result = subprocess.run(
        command,
        cwd=ROOT,
        env=render_env,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    config = strict_json_loads(result.stdout)
    if not isinstance(config, dict):
        raise AssertionError("rendered Compose config must be a JSON object")

    return config


def compose_service(config: dict[str, Any], name: str) -> dict[str, Any]:
    return config["services"][name]


def compose_mapping(config_service: dict[str, Any], field: str) -> dict[str, Any]:
    value = config_service[field]
    if not isinstance(value, dict):
        raise AssertionError(f"{field} must render as a mapping")
    return value


def compose_sequence(config_service: dict[str, Any], field: str) -> list[Any]:
    value = config_service[field]
    if not isinstance(value, list):
        raise AssertionError(f"{field} must render as a list")
    return value


def compose_sequence_or_empty(config_service: dict[str, Any], field: str) -> list[Any]:
    if field not in config_service:
        return []
    value = config_service[field]
    if not isinstance(value, list):
        raise AssertionError(f"{field} must render as a list")
    return value


def compose_command_text(config_service: dict[str, Any]) -> str:
    return " ".join(str(item) for item in compose_sequence(config_service, "command"))


def compose_volume(config_service: dict[str, Any], target: str) -> dict[str, Any]:
    for volume in compose_sequence(config_service, "volumes"):
        if volume["target"] == target:
            return volume
    raise AssertionError(f"missing volume target: {target}")


def docker_compose_command(env: dict[str, str]) -> list[str]:
    configured = env.get("DOCKER_COMPOSE")
    return shlex.split(configured if configured is not None else makefile_docker_compose_default())


def makefile_docker_compose_default() -> str:
    match = DOCKER_COMPOSE_DEFAULT_RE.search(read_text(repo_path("Makefile")))
    if match is None:
        raise AssertionError("Makefile must declare DOCKER_COMPOSE ?=")

    return match.group("command")
