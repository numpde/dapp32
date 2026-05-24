from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

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
    "node_modules",
    "old-src",
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
