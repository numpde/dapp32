#!/usr/bin/env python3
"""Exercise the real Escrow release launcher through its operator terminal."""

from __future__ import annotations

from contextlib import contextmanager
import errno
import json
import os
from pathlib import Path
import fcntl
import pty
import re
import select
import signal
import struct
import subprocess
import sys
import termios
import time
import tty


PROMPT = "Type start and press Enter to open the approval socket."
SERVICE_LABEL = "com.docker.compose.service"
PROJECT_LABEL = "com.docker.compose.project"
IDENTITY = re.compile(r"^sha256:[0-9a-f]{64}$")
CLEANUP_TIMEOUT = 300
CANCEL_SIGNALS = (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)


class ReleaseCleanupError(RuntimeError):
    """The outer rehearsal must retain inputs when child cleanup is incomplete."""


def process_status(process: subprocess.Popen[bytes]) -> int | None:
    # WNOWAIT keeps our child PID reserved, even after its leader exits. No
    # poll()/wait() may reap it before the last signal to its process group.
    if process.returncode is not None:
        raise ReleaseCleanupError("Release child was reaped early; refusing to signal a reused process group")
    result = os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
    if result is None:
        return None
    return result.si_status if result.si_code == os.CLD_EXITED else -result.si_status


def drain_terminal(master: int, transcript: bytearray, timeout: float) -> bool:
    """Read available output; return true only when the slave terminal closes."""
    ready, _, _ = select.select([master], [], [], timeout)
    if not ready:
        return False
    try:
        chunk = os.read(master, 65536)
    except OSError as error:
        if error.errno == errno.EIO:
            return True
        raise
    transcript.extend(chunk)
    return not chunk


def stop_release(process: subprocess.Popen[bytes], master: int, transcript: bytearray) -> None:
    process_status(process)  # Verify that the child is still ours before signalling.
    try:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            wait_for_exit(process, master, transcript, time.monotonic() + CLEANUP_TIMEOUT)
        except TimeoutError as cause:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                wait_for_exit(process, master, transcript, time.monotonic() + 10)
            except TimeoutError:
                pass
            raise ReleaseCleanupError(
                f"Release cleanup exceeded {CLEANUP_TIMEOUT}s; its child group was forcibly stopped. "
                "Container cleanup is unconfirmed; retain rehearsal inputs and inspect the PTY log."
            ) from cause
    finally:
        # Only reap after every possible group signal, and never block on a
        # process which did not exit even after escalation.
        if process_status(process) is not None:
            process.wait()


@contextmanager
def release_terminal(log_path: Path):
    """Own the child session, cancellation, terminal descriptors and transcript."""
    master = slave = None
    process = None
    transcript = bytearray()
    previous_handlers = {}
    cancelled = None
    launching = True
    cleaning = False

    def cancel(signum, _frame):
        nonlocal cancelled
        if cancelled is not None:
            return
        cancelled = signum
        # A signal may arrive after Popen creates the child but before it
        # returns the handle. Finish acquiring ownership before unwinding.
        if not launching and not cleaning:
            raise SystemExit(128 + signum)

    try:
        for signum in CANCEL_SIGNALS:
            previous_handlers[signum] = signal.signal(signum, cancel)
        master, slave = pty.openpty()
        tty.setraw(slave)
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
        env = os.environ.copy()
        env["RELEASE_APPROVAL_TRACE_RPC"] = "1"
        if cancelled is not None:
            raise SystemExit(128 + cancelled)
        process = subprocess.Popen(
            ["make", "escrow/release/deploy"],
            cwd=Path(__file__).resolve().parents[1], env=env,
            stdin=slave, stdout=slave, stderr=slave, close_fds=True, start_new_session=True,
        )
        os.close(slave)
        slave = None
        launching = False
        if cancelled is not None:
            raise SystemExit(128 + cancelled)
        yield master, process, transcript
    finally:
        cleaning = True
        failures = []
        if slave is not None:
            try:
                os.close(slave)
            except OSError as error:
                failures.append(f"closing the PTY slave failed: {error}")
        try:
            if process is not None and master is not None:
                stop_release(process, master, transcript)
        except Exception as error:
            failures.append(str(error))
        finally:
            if master is not None:
                try:
                    os.close(master)
                except OSError as error:
                    failures.append(f"closing the PTY failed: {error}")
            try:
                with log_path.open("wb") as output:
                    os.fchmod(output.fileno(), 0o600)
                    output.write(transcript)
            except OSError as error:
                failures.append(f"saving the PTY log failed: {error}")
            finally:
                for signum, handler in previous_handlers.items():
                    signal.signal(signum, handler)
        if failures:
            raise ReleaseCleanupError("; ".join(failures))
        if cancelled is not None:
            raise SystemExit(128 + cancelled)


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


def save_container_tail(identity: str, path: Path) -> Path:
    container_state = docker(
        "inspect", "--format",
        "status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}",
        identity,
    )
    result = subprocess.run(
        ["docker", "logs", "--tail", "80", identity],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, errors="replace", check=False, timeout=20,
    )
    with path.open("w", encoding="utf-8") as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(f"container={identity} {container_state}\n")
        output.write(result.stdout)
    if result.returncode != 0:
        raise RuntimeError(
            f"docker logs failed (status {result.returncode}); diagnostic output saved to {path}"
        )
    return path


def save_signer_tail(project: str, rehearsal_dir: Path) -> Path | None:
    signers = containers("deploy-release", project)
    if len(signers) != 1:
        return None
    return save_container_tail(next(iter(signers)), rehearsal_dir / "signer-tail.log")


def read_until(master: int, process: subprocess.Popen[bytes], transcript: bytearray,
               predicate, deadline: float, explanation: str) -> None:
    while time.monotonic() < deadline:
        if predicate():
            return
        status = process_status(process)
        if status is not None:
            raise RuntimeError(f"Release command exited before {explanation} (status {status})")
        if drain_terminal(master, transcript, min(0.2, max(0.0, deadline - time.monotonic()))):
            break
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


def approval_chain_id(signer: str) -> str:
    """Verify Forge's RPC client can read through the live approval listener."""
    result = subprocess.run(
        ["docker", "exec", signer, "timeout", "8", "cast", "chain-id",
         "--rpc-url", "file:///run/approval/rpc.sock"],
        capture_output=True, text=True, check=False, timeout=12,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Forge could not read the chain ID through the live approval socket "
            f"(status {result.returncode}): {result.stderr.strip()}"
        )
    chain_id = result.stdout.strip()
    if chain_id != "31338":
        raise RuntimeError(f"Approval RPC returned chain ID {chain_id!r}, expected 31338")
    return chain_id


def signer_rpc_read(signer: str, operation: str, *arguments: str) -> None:
    result = subprocess.run(
        ["docker", "exec", signer, "timeout", "8", "cast", operation, *arguments,
         "--rpc-url", "file:///run/approval/rpc.sock"],
        capture_output=True, text=True, check=False, timeout=12,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"Forge RPC read {operation} failed through the approval socket "
            f"(status {result.returncode}): {result.stderr.strip()}"
        )


def backend_chain_id(gate: str) -> str:
    """Check the approval container's fixed HTTP backend independently of IPC."""
    script = (
        "const response=await fetch('http://release-rpc-proxy:8080',{method:'POST',"
        "headers:{'content-type':'application/json'},"
        "body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]}),"
        "signal:AbortSignal.timeout(5000)});"
        "if(!response.ok)throw Error('backend HTTP '+response.status);"
        "const body=await response.json();"
        "if(body.jsonrpc!=='2.0'||body.id!==1||body.result!=='0x7a6a')"
        "throw Error('unexpected backend JSON-RPC response');"
        "process.stdout.write(body.result);"
    )
    result = subprocess.run(
        ["docker", "exec", gate, "node", "--input-type=module", "-e", script],
        capture_output=True, text=True, check=False, timeout=8,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Approval container could not read chain ID from its fixed HTTP backend "
            f"(status {result.returncode}): {result.stderr.strip()}"
        )
    chain_id = result.stdout.strip()
    if chain_id != "0x7a6a":
        raise RuntimeError(f"Approval backend returned chain ID {chain_id!r}, expected 0x7a6a")
    return chain_id


def listener_chain_id(gate: str) -> str:
    """Check the live listener with a bounded ordinary Unix-socket JSON client."""
    script = (
        "const net=await import('node:net');"
        "const socket=net.createConnection('/run/approval/rpc.sock');"
        "let bytes='';let settled=false;"
        "const timer=setTimeout(()=>finish(Error('listener response timed out')),5000);"
        "function finish(error,value){if(settled)return;settled=true;clearTimeout(timer);"
        "socket.destroy();if(error){console.error(error.message);process.exitCode=1;}"
        "else process.stdout.write(value);};"
        "socket.on('error',error=>finish(error));"
        "socket.on('connect',()=>socket.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_chainId',params:[]})));"
        "socket.on('data',block=>{bytes+=block.toString('utf8');const end=bytes.indexOf('\\n');"
        "if(end<0)return;try{const body=JSON.parse(bytes.slice(0,end));"
        "if(body.jsonrpc!=='2.0'||body.id!==1||body.result!=='0x7a6a')"
        "throw Error('unexpected listener JSON-RPC response');finish(null,body.result);"
        "}catch(error){finish(error);}});"
    )
    result = subprocess.run(
        ["docker", "exec", gate, "node", "--input-type=module", "-e", script],
        capture_output=True, text=True, check=False, timeout=8,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Approval listener did not answer a direct Unix-socket read "
            f"(status {result.returncode}): {result.stderr.strip()}"
        )
    return result.stdout.strip()


def wait_for_exit(process: subprocess.Popen[bytes], master: int, transcript: bytearray,
                  deadline: float) -> int:
    terminal_closed = False
    while time.monotonic() < deadline:
        status = process_status(process)
        if terminal_closed and status is not None:
            return status
        pause = min(0.2, max(0.0, deadline - time.monotonic()))
        if terminal_closed:
            time.sleep(pause)
        else:
            terminal_closed = drain_terminal(master, transcript, pause)
    raise TimeoutError("Release command did not finish after the operator rejected the first transaction")

def main() -> None:
    image = required("RELEASE_APPROVAL_IMAGE")
    output = Path(required("ESCROW_RELEASE_OUTPUT_DIR"))
    deployer = required("ESCROW_RELEASE_EXPECTED_DEPLOYER_ADDRESS")
    source_commit = required("ESCROW_RELEASE_SOURCE_COMMIT")
    rehearsal_dir = Path(required("RELEASE_REHEARSAL_DIR"))
    rehearsal_network = required("RELEASE_REHEARSAL_NETWORK")
    if IDENTITY.fullmatch(image) is None:
        raise RuntimeError("RELEASE_APPROVAL_IMAGE must be a local sha256 image ID")
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
    approval_id = ""
    project = ""
    socket_path: Path | None = None
    log_path = rehearsal_dir / "approval-pty.log"
    with release_terminal(log_path) as (master, process, transcript):
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

        backend_chain_id(approval_id)
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
        listener_chain_id(approval_id)
        signer = next(iter(signer_ids))
        approval_chain_id(signer)
        signer_rpc_read(signer, "block-number")
        signer_rpc_read(signer, "nonce", deployer)
        signer_rpc_read(signer, "gas-price")

        def first_review_shown() -> bool:
            text = transcript.decode("utf-8", errors="replace")
            return "Review transaction 1" in text and re.search(r"Reject with: reject ([A-Za-z0-9-]+)", text) is not None

        try:
            read_until(master, process, transcript, first_review_shown,
                       time.monotonic() + 180, "the first signed transaction review")
        except RuntimeError as cause:
            if "Timed out waiting" not in str(cause):
                raise
            signer_tail = save_signer_tail(project, rehearsal_dir)
            if signer_tail is None:
                raise
            gate_tail = save_container_tail(approval_id, rehearsal_dir / "approval-tail.log")
            raise RuntimeError(
                f"{cause}; signer state and stdout/stderr tail saved to {signer_tail}; "
                f"approval state and RPC trace saved to {gate_tail}"
            ) from cause
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


if __name__ == "__main__":
    try:
        main()
    except ReleaseCleanupError as error:
        print(f"Release approval PTY cleanup incomplete: {error}", file=sys.stderr)
        raise SystemExit(2)
    except Exception as error:
        print(f"Release approval PTY check failed: {error}", file=sys.stderr)
        raise SystemExit(1)
