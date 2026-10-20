#!/usr/bin/env python3
"""Exercise the real Escrow release launcher through its operator terminal."""

from __future__ import annotations

import json
import os
from pathlib import Path
import fcntl
import pty
import re
import select
import struct
import subprocess
import termios
import time
import tty


PROMPT = "Type start and press Enter to open the approval socket."
SERVICE_LABEL = "com.docker.compose.service"
PROJECT_LABEL = "com.docker.compose.project"
IDENTITY = re.compile(r"^sha256:[0-9a-f]{64}$")


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"PTY rehearsal requires {name}")
    return value


def docker(*arguments: str) -> str:
    result = subprocess.run(
        ["docker", *arguments], capture_output=True, text=True, check=False, timeout=20
    )
    if result.returncode != 0:
        raise RuntimeError(f"docker {' '.join(arguments)} failed: {result.stderr.strip()}")
    return result.stdout.strip()


def containers(service: str, project: str | None = None) -> set[str]:
    arguments = ["ps", "--all", "--quiet", "--filter", f"label={SERVICE_LABEL}={service}"]
    if project is not None:
        arguments.extend(["--filter", f"label={PROJECT_LABEL}={project}"])
    output = docker(*arguments)
    return set(output.splitlines()) if output else set()


def state(identity: str) -> str:
    return docker("inspect", "--format", "{{.State.Status}}", identity)


def compose_project(identity: str) -> str:
    return docker("inspect", "--format", f"{{{{index .Config.Labels \"{PROJECT_LABEL}\"}}}}", identity)


def wait_for_new_container(service: str, before: set[str], deadline: float) -> str:
    while time.monotonic() < deadline:
        new = containers(service) - before
        if len(new) == 1:
            return new.pop()
        if len(new) > 1:
            raise RuntimeError(f"Expected one new {service} container; found {len(new)}")
        time.sleep(0.1)
    raise RuntimeError(f"Timed out waiting for the {service} container")


def approval_socket_source(identity: str) -> Path:
    mounts = json.loads(docker("inspect", "--format", "{{json .Mounts}}", identity))
    matches = [mount["Source"] for mount in mounts if mount.get("Destination") == "/run/approval"]
    if len(matches) != 1:
        raise RuntimeError("Approval container must have one /run/approval mount")
    return Path(matches[0]) / "rpc.sock"


def read_until(master: int, process: subprocess.Popen[bytes], transcript: bytearray,
               predicate, deadline: float, explanation: str) -> None:
    while time.monotonic() < deadline:
        if predicate():
            return
        if process.poll() is not None:
            raise RuntimeError(f"Release command exited before {explanation} (status {process.returncode})")
        ready, _, _ = select.select([master], [], [], min(0.2, max(0.0, deadline - time.monotonic())))
        if not ready:
            continue
        try:
            chunk = os.read(master, 65536)
        except OSError:
            if process.poll() is not None:
                break
            raise
        if not chunk:
            break
        transcript.extend(chunk)
    raise RuntimeError(f"Timed out waiting for {explanation}")


def fixture_nonce(project: str, address: str) -> int:
    matches = containers("release-anvil", project)
    if len(matches) != 1:
        raise RuntimeError("Expected one disposable release-anvil container")
    output = docker("exec", next(iter(matches)), "cast", "nonce", address,
                    "--rpc-url", "http://127.0.0.1:8545")
    if not output.isdecimal():
        raise RuntimeError("Anvil returned a malformed deployer nonce")
    return int(output)


def wait_for_exit(process: subprocess.Popen[bytes], master: int, transcript: bytearray,
                  deadline: float) -> int:
    while time.monotonic() < deadline:
        if process.poll() is not None:
            return process.returncode if process.returncode is not None else process.wait()
        ready, _, _ = select.select([master], [], [], 0.2)
        if ready:
            try:
                transcript.extend(os.read(master, 65536))
            except OSError:
                if process.poll() is not None:
                    break
                raise
    raise RuntimeError("Release command did not finish after the operator rejected the first transaction")


def main() -> None:
    image = required("RELEASE_APPROVAL_IMAGE")
    output = Path(required("ESCROW_RELEASE_OUTPUT_DIR"))
    deployer = required("ESCROW_RELEASE_EXPECTED_DEPLOYER_ADDRESS")
    source_commit = required("ESCROW_RELEASE_SOURCE_COMMIT")
    rehearsal_dir = Path(required("RELEASE_REHEARSAL_DIR"))
    rehearsal_network = required("RELEASE_REHEARSAL_NETWORK")
    if IDENTITY.fullmatch(image) is None:
        raise RuntimeError("RELEASE_APPROVAL_IMAGE must be an admitted local sha256 image ID")
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", deployer):
        raise RuntimeError("Fixture deployer address is malformed")
    if not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise RuntimeError("Rehearsal source commit is malformed")
    if not rehearsal_dir.is_dir() or output.exists():
        raise RuntimeError("Rehearsal or new release output directory is missing/used")
    if "CONFIG" in os.environ:
        raise RuntimeError("PTY rehearsal must not inherit an operator release CONFIG")

    rehearsal_project = rehearsal_network.removesuffix("-rehearsal")
    nonce_before = fixture_nonce(rehearsal_project, deployer)
    old_gates = containers("release-approval")
    old_signers = containers("deploy-release")
    master, slave = pty.openpty()
    tty.setraw(slave)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    env = os.environ.copy()
    process = subprocess.Popen(
        ["make", "escrow/release/deploy"],
        cwd=Path(__file__).resolve().parents[1], env=env,
        stdin=slave, stdout=slave, stderr=slave, close_fds=True, start_new_session=True,
    )
    os.close(slave)
    transcript = bytearray()
    approval_id = ""
    project = ""
    socket_path: Path | None = None
    log_path = rehearsal_dir / "approval-pty.log"
    try:
        read_until(
            master, process, transcript,
            lambda: PROMPT in transcript.decode("utf-8", errors="replace"),
            time.monotonic() + 900, "the displayed release identity and start prompt",
        )
        display = transcript.decode("utf-8", errors="replace")
        required_display = (
            "Release approval", "  App: escrow", "  Chain ID: 31338",
            f"  Deployer: {deployer}", f"  Source commit: {source_commit}", PROMPT,
        )
        if any(value not in display for value in required_display):
            raise RuntimeError("Approval terminal did not display the selected Escrow release identity")
        if re.search(r"  Reference SHA-256: 0x[0-9a-f]{64}\r?\n", display) is None:
            raise RuntimeError("Approval terminal did not display a full reference SHA-256")

        approval_id = wait_for_new_container("release-approval", old_gates, time.monotonic() + 30)
        if state(approval_id) != "running":
            raise RuntimeError("Approval service must be running at the start prompt")
        project = compose_project(approval_id)
        socket_path = approval_socket_source(approval_id)
        if socket_path.exists() or socket_path.is_symlink():
            raise RuntimeError("Approval socket existed before the operator entered start")
        if containers("deploy-release", project):
            raise RuntimeError("Forge container existed before the operator entered start")
        if containers("deploy-release") - old_signers:
            raise RuntimeError("A new Forge container started before the operator entered start")

        os.write(master, b"start\n")
        read_until(master, process, transcript,
                   lambda: socket_path is not None and socket_path.is_socket(),
                   time.monotonic() + 30, "the approval socket to open")
        read_until(master, process, transcript,
                   lambda: len(containers("deploy-release", project)) == 1
                   and state(next(iter(containers("deploy-release", project)))) == "running",
                   time.monotonic() + 30, "Forge to start after the approval socket opened")
        signer_ids = containers("deploy-release", project)
        if len(signer_ids) != 1:
            raise RuntimeError("Starting approval must start exactly one Forge container")

        def first_review_shown() -> bool:
            text = transcript.decode("utf-8", errors="replace")
            return "Review transaction 1" in text and re.search(r"Reject with: reject ([A-Za-z0-9-]+)", text) is not None

        read_until(master, process, transcript, first_review_shown,
                   time.monotonic() + 180, "the first signed transaction review")
        display = transcript.decode("utf-8", errors="replace")
        challenge_match = re.search(r"Reject with: reject ([A-Za-z0-9-]+)", display)
        if challenge_match is None:
            raise RuntimeError("First transaction review did not display a rejection challenge")
        os.write(master, f"reject {challenge_match.group(1)}\n".encode("ascii"))
        status = wait_for_exit(process, master, transcript, time.monotonic() + 180)
        if status == 0:
            raise RuntimeError("Rejecting the first transaction must fail the release command")

        audit_path = output / "approval-audit" / "approval.jsonl"
        if audit_path.is_symlink() or not audit_path.is_file():
            raise RuntimeError("Rejected release did not retain its approval audit")
        events = [json.loads(line) for line in audit_path.read_text(encoding="utf-8").splitlines()]
        kinds = []
        closed_reasons = []
        for event in events:
            kind = event.get("kind")
            if not isinstance(kind, str):
                raise RuntimeError("Approval audit event is missing its kind")
            kinds.append(kind)
            if kind == "closed":
                reason = event.get("reason")
                if not isinstance(reason, str):
                    raise RuntimeError("Approval closure audit is missing its reason")
                closed_reasons.append(reason)
        if "pending" not in kinds or "closed" not in kinds or any(kind in kinds for kind in ("approved", "transmitting", "accepted")):
            raise RuntimeError("Audit must show the candidate and rejection without approval or transmission")
        if not any("reject" in reason.lower() for reason in closed_reasons):
            raise RuntimeError("Audit did not preserve the operator rejection reason")
        broadcast = output / "broadcast"
        if broadcast.is_symlink() or not broadcast.is_dir() or any(broadcast.iterdir()):
            raise RuntimeError("Rejected transaction left broadcast files")
        if (output / "artifact" / "deployment.json").exists():
            raise RuntimeError("Rejected release must not publish a deployment artifact")
        if fixture_nonce(rehearsal_project, deployer) != nonce_before:
            raise RuntimeError("Deployer nonce changed; a transaction was broadcast despite rejection")
        if containers("release-approval", project) or containers("deploy-release", project):
            raise RuntimeError("Release containers remained after the launcher reported completion")
        if "Review broadcast and approval audit for possible earlier effects." not in transcript.decode("utf-8", errors="replace"):
            raise RuntimeError("Launcher failure did not explain that earlier release effects may exist")
        print("PTY approval launch check passed: identity shown before start, Forge waited, rejection sent nothing, audit retained, services cleaned.")
    finally:
        if process.poll() is None:
            import signal
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
        os.close(master)
        log_path.write_bytes(transcript)
        log_path.chmod(0o600)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"Release approval PTY check failed: {error}", file=__import__("sys").stderr)
        raise SystemExit(1)
