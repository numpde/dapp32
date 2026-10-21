"""Change only the private, not-yet-committed PTY fixture snapshot.

This diagnostic must never change the operator checkout or become an implicit
fallback. The fixture subsequently commits these exact bytes, so its source
identity honestly records that simulation was skipped.
"""

from __future__ import annotations

import os
from pathlib import Path
import stat


NORMAL = "          --broadcast --slow " + "\\" + "\n"
SKIP = "          --broadcast --slow --skip-simulation " + "\\" + "\n"


def enable_skip(rehearsal_dir: Path, source: Path) -> None:
    if not rehearsal_dir.is_absolute() or rehearsal_dir.resolve(strict=True) != rehearsal_dir:
        raise ValueError("Rehearsal directory must be an absolute, real directory")
    if source != rehearsal_dir / "source" or source.resolve(strict=True) != source:
        raise ValueError("Simulation experiment may change only its private source snapshot")
    info = rehearsal_dir.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise ValueError("Simulation experiment requires an owner-only rehearsal directory")
    if (source / ".git").exists() or (source / ".git").is_symlink():
        raise ValueError("Simulation experiment refuses an existing Git checkout")
    candidate = source / "compose/release/deploy.yml"
    if candidate.resolve(strict=True) != candidate or not candidate.is_file():
        raise ValueError("Release Compose input must be a real regular file in the private snapshot")
    if candidate.stat().st_size > 128 * 1024:
        raise ValueError("Release Compose input exceeds the diagnostic size limit")
    text = candidate.read_text(encoding="utf-8")
    if text.count(NORMAL) != 1 or "--skip-simulation" in text:
        raise ValueError("Release signer command changed; refusing an ambiguous simulation experiment")
    if "--rpc-url file:///run/approval/rpc.sock" not in text:
        raise ValueError("Simulation experiment must retain the approval socket")
    candidate.write_text(text.replace(NORMAL, SKIP, 1), encoding="utf-8")


def main() -> None:
    if (os.environ.get("RELEASE_REHEARSAL") != "1" or
            os.environ.get("DAPP") != "escrow" or
            os.environ.get("RELEASE_APPROVAL_SIMULATION") != "skip"):
        raise SystemExit("Simulation skipping is restricted to the explicit Escrow PTY fixture experiment")
    directory = Path(os.environ["RELEASE_REHEARSAL_DIR"])
    source = Path.cwd()
    enable_skip(directory, source)
    print("Fixture diagnostic: skipping transaction replay; IPC, approval, rejection and nonce checks remain enabled", flush=True)


if __name__ == "__main__":
    main()
