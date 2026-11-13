"""Acquire Dockerfile bases through native Buildx discovery and Docker pulls.

This host orchestration helper uses only the standard library so it can acquire
the container toolchain itself. Buildx owns Dockerfile parsing; this boundary
owns source selection and the requirement for literal SHA-256 image pins.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
PINNED_IMAGE = re.compile(r"[A-Za-z0-9][^\s@$]*@sha256:[0-9a-f]{64}")


def selected_dockerfiles(root: Path, selection: str | None) -> list[Path]:
    """Validate the whole source selection before asking Docker to read it.

    Discovery includes new Dockerfiles automatically. Explicit paths must stay
    inside containers/ without symlinks that could expose unrelated host files.
    """
    if selection is not None and any(ord(character) < 32 for character in selection):
        raise ValueError("DOCKERFILES must contain space-separated paths without control characters")
    if selection:
        paths = selection.split()
    else:
        paths = [str(path.relative_to(root)) for path in sorted((root / "containers").rglob("Dockerfile"))]
    if not paths:
        raise ValueError("No Dockerfiles selected under containers/")
    dockerfiles = []
    for name in paths:
        parts = name.split("/")
        if parts[0] != "containers" or parts[-1] != "Dockerfile" or any(part in ("", ".", "..") for part in parts):
            raise ValueError(f"Dockerfile must be a relative containers/.../Dockerfile path: {name!r}")
        path = root
        for component in parts:
            path /= component
            if path.is_symlink():
                raise ValueError(f"Dockerfile path passes through a symlink: {name!r}")
        if not path.is_file():
            raise ValueError(f"Dockerfile is not a regular file: {name!r}")
        # Buildx can acquire a Dockerfile syntax frontend during stage discovery,
        # before FROM-image pin checks. Use the built-in frontend instead.
        for line in path.read_text(encoding="utf-8").splitlines():
            if line.startswith("# syntax="):
                raise ValueError(f"External Dockerfile syntax frontend is prohibited: {name!r}")
            if line.strip() and not line.startswith("#"):
                break
        dockerfiles.append(Path(name))
    return dockerfiles


def declared_bases(root: Path, dockerfiles: list[Path]) -> dict[str, Path]:
    """Return each external base with the first Dockerfile that declares it.

    Docker lists stages without running build instructions, but may acquire a
    declared syntax frontend. Require literal pins across the whole selection
    before base pulls, so an unpinned base in a later file stops acquisition
    before any base image is downloaded.
    """
    images = {}
    for dockerfile in dockerfiles:
        result = subprocess.run(
            args=["docker", "--host", os.environ["CAM_DOCKER_ENDPOINT"], "buildx", "build", "--builder", "default",
                  "--call=targets,format=json", "--quiet", "--file", str(dockerfile), str(dockerfile.parent)],
            cwd=root,
            stdout=subprocess.PIPE,
            text=True,
            timeout=120,
            check=True,
        )
        try:
            targets = json.loads(result.stdout)["targets"]
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            raise ValueError(f"Cannot discover base images for {dockerfile}: Buildx returned no targets list") from error
        if not isinstance(targets, list) or not targets:
            raise ValueError(f"Cannot discover base images for {dockerfile}: Buildx returned no stages")
        stages = set()
        for target in targets:
            if not isinstance(target, dict) or not isinstance(target.get("base"), str) or not target["base"]:
                raise ValueError(f"Cannot discover base images for {dockerfile}: malformed Buildx stage")
            name = target.get("name")
            if "name" in target and not isinstance(name, str):
                raise ValueError(f"Cannot discover base images for {dockerfile}: malformed Buildx stage name")
            base = target["base"]
            if target.get("platform"):
                raise ValueError(f"Cannot acquire bases for {dockerfile}: explicit FROM platforms require a platform-aware acquisition lane")
            # Earlier stages are local build results. Pulling their names would
            # ask the registry for unrelated images; scratch has no image to pull.
            if base != "scratch" and base.lower() not in stages:
                if not PINNED_IMAGE.fullmatch(base):
                    raise ValueError(f"{dockerfile}: base must be a literal SHA-256-pinned image: {base!r}")
                if base not in images:
                    images[base] = dockerfile
            if name:
                stages.add(name.lower())
    return images


def main() -> int:
    """Acquire bases on Make's selected engine, leaving shared cached images intact."""
    endpoint = os.environ.get("CAM_DOCKER_ENDPOINT")
    if endpoint is None or not endpoint.startswith("unix:///"):
        raise ValueError("Docker endpoint must be a selected local Unix socket; use Make with DOCKER_CONTEXT")
    dockerfiles = selected_dockerfiles(ROOT, os.environ.get("DOCKERFILES"))
    images = declared_bases(ROOT, dockerfiles)
    # Other projects can use these same bases. Downloading them does not grant
    # ownership of the engine's old images, containers or build cache.
    for (image, dockerfile) in images.items():
        print(f"Pulling {image} (from {dockerfile})", flush=True)
        subprocess.run(["docker", "--host", os.environ["CAM_DOCKER_ENDPOINT"], "pull", image], timeout=120, check=True)
    print(f"Acquired {len(images)} distinct base image(s); no build or cleanup performed.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as error:
        print(f"Base-image acquisition failed (status {error.returncode}); earlier images may remain cached.", file=sys.stderr)
        sys.exit(error.returncode if error.returncode > 0 else 128 - error.returncode)
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(f"Cannot complete base-image acquisition: {error}", file=sys.stderr)
        sys.exit(2)
