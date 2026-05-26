from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shlex
import subprocess
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DOCKER_COMPOSE_DEFAULT_RE = re.compile(r"^DOCKER_COMPOSE \?= (?P<command>.+)$", re.MULTILINE)

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


def rendered_compose_config(compose_file: str, *, env: dict[str, str] | None = None) -> dict[str, Any]:
    render_env = os.environ.copy()
    render_env.update(
        {
            "LOCAL_UID": "1000",
            "LOCAL_GID": "1000",
            "COMPOSE_PROJECT_NAME": "dapps-check",
        }
    )
    if env is not None:
        render_env.update(env)

    command = docker_compose_command(render_env)
    command.extend(["-f", str(repo_path(compose_file)), "config", "--format", "json"])

    result = subprocess.run(
        command,
        cwd=ROOT,
        env=render_env,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return json.loads(result.stdout)


def docker_compose_command(env: dict[str, str]) -> list[str]:
    configured = env.get("DOCKER_COMPOSE")
    return shlex.split(configured if configured is not None else makefile_docker_compose_default())


def makefile_docker_compose_default() -> str:
    match = DOCKER_COMPOSE_DEFAULT_RE.search(read_text(repo_path("Makefile")))
    if match is None:
        raise AssertionError("Makefile must declare DOCKER_COMPOSE ?=")

    return match.group("command")
