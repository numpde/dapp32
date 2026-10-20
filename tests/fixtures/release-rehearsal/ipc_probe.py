"""Observe stock Forge's Unix JSON-RPC transport on a disposable chain."""

import hashlib
import http.client
import json
import os
from pathlib import Path
import runpy
from functools import cache
import socket
import socketserver
import sys
import threading
import time


SOCKET = "/run/approval/rpc.sock"
EVIDENCE = Path("/wait-evidence/events.jsonl")
CASES = {"smoke", "delay-120", "same-socket", "receipt", "reject", "drop", "loss-hold"}


@cache
def release_proxy():
    fixture = runpy.run_path("/rehearsal/rpc_proxy.py")
    fixture["require_fixture_upstream"]()
    return fixture["proxy"]


def upstream(request, validate):
    body = json.dumps(request, separators=(",", ":")).encode()
    if validate:
        proxy = release_proxy()
        proxy["validate_rpc_request"](body, proxy["ALLOWED_METHODS"])
    connection = http.client.HTTPConnection("release-anvil", 8545, timeout=20)
    try:
        connection.request("POST", "/", body, {"content-type": "application/json"})
        response = connection.getresponse()
        raw = response.read(1024 * 1024 + 1)
        if response.status != 200 or len(raw) > 1024 * 1024:
            raise RuntimeError("Fixture node returned an invalid response")
        return json.loads(raw)
    finally:
        connection.close()


def node(method, params):
    value = upstream({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, False)
    if "error" in value:
        raise RuntimeError(f"Fixture node rejected {method}")
    return value["result"]


class Probe:
    def __init__(self, case):
        self.case = case
        self.lock = threading.RLock()
        self.output = EVIDENCE.open("x", encoding="utf-8")
        self.events = 0
        self.connections = 0
        self.first = None
        self.started = None
        self.hash = None
        self.first_done = False
        self.receipt_null = False
        self.receipt_success = False

    def event(self, name, **facts):
        with self.lock:
            if self.events >= 2048 or self.output.tell() >= 1024 * 1024:
                raise RuntimeError("IPC evidence limit reached")
            self.events += 1
            self.output.write(json.dumps({"event": name, "at": time.monotonic(), **facts}) + "\n")
            self.output.flush()

    def new_connection(self):
        with self.lock:
            self.connections += 1
            return self.connections

    def mine_after_null(self):
        try:
            time.sleep(10)
            node("evm_mine", [])
            node("evm_setAutomine", [True])
            self.event("mine")
        except Exception as exc:
            self.event("harness_error", operation="controlled mining", reason=type(exc).__name__)

    def process(self, rpc, handler):
        proxy = release_proxy()
        method = rpc.get("method")
        request_id = rpc.get("id")
        if not isinstance(method, str):
            raise RuntimeError("Forge sent an invalid method")
        if method not in proxy["ALLOWED_METHODS"]:
            self.event("unsupported_method", method=method, request_id=request_id)
            return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": "Method not found"}}
        if method == "eth_sendRawTransaction":
            signed = rpc["params"][0]
            if self.case == "same-socket":
                self.event("synthetic_send_started", request_id=request_id, connection=handler.connection_id)
                time.sleep(3)
                self.event("synthetic_send_finished", request_id=request_id, connection=handler.connection_id)
                return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32000, "message": "Synthetic concurrency probe; no transaction submitted"}}
            fingerprint = hashlib.sha256(bytes.fromhex(signed.removeprefix("0x"))).hexdigest()
            with self.lock:
                first = self.first is None
                self.event("send", fingerprint=fingerprint, request_id=request_id, connection=handler.connection_id)
                if first:
                    self.first, self.started = fingerprint, time.monotonic()
                    self.hash = node("web3_sha3", [signed])
                    self.event("expected_hash", hash=self.hash)
                extra = not first and (fingerprint == self.first or not self.first_done or self.case in {"drop", "reject", "loss-hold"} or (self.case == "receipt" and not self.receipt_success))
                if extra:
                    self.event("extra_send", fingerprint=fingerprint)
                if self.case == "reject" or extra:
                    self.event("denied", request_id=request_id)
                    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32000, "message": "Fixture approval denied"}}
            if first and self.case == "loss-hold":
                time.sleep(1)
                handler.close_connection()
                self.event("dropped_during_hold")
                with self.lock:
                    self.first_done = True
                    self.event("first_finished")
                return None
            if first and self.case == "delay-120":
                time.sleep(max(0, self.started + 120 - time.monotonic()))
            if first and self.case == "receipt":
                node("evm_setAutomine", [False])
            self.event("forward", fingerprint=fingerprint, request_id=request_id)
            reply = upstream(rpc, True)
            if "error" in reply:
                raise RuntimeError("Fixture transaction submission was rejected upstream")
            self.event("accepted", hash=reply["result"])
            if first and reply["result"] != self.hash:
                raise RuntimeError("Fixture transaction hash mismatch")
            if first and self.case == "drop":
                handler.close_connection()
                self.event("dropped_after_acceptance")
                with self.lock:
                    self.first_done = True
                    self.event("first_finished")
                return None
            return reply
        reply = upstream(rpc, True)
        if method == "eth_getTransactionReceipt" and rpc.get("params") == [self.hash]:
            result = reply.get("result")
            with self.lock:
                if result is None and not self.receipt_null:
                    self.receipt_null = True
                    self.event("receipt_null")
                    if self.case == "receipt":
                        threading.Thread(target=self.mine_after_null, daemon=True).start()
                elif isinstance(result, dict) and result.get("status") == "0x1" and not self.receipt_success:
                    self.receipt_success = True
                    self.event("receipt_success")
        return reply


class Handler(socketserver.BaseRequestHandler):
    def setup(self):
        self.send_lock = threading.Lock()
        self.connection_id = self.server.probe.new_connection()
        self.server.probe.event("connected", connection=self.connection_id)

    def close_connection(self):
        try:
            self.request.shutdown(socket.SHUT_RDWR)
        except OSError as exc:
            self.server.probe.event("socket_shutdown_failed", reason=type(exc).__name__)
        self.request.close()

    def handle_one(self, rpc):
        probe = self.server.probe
        first = rpc.get("method") == "eth_sendRawTransaction" and probe.first is None
        try:
            reply = probe.process(rpc, self)
            if reply is not None:
                encoded = json.dumps(reply, separators=(",", ":")).encode() + b"\n"
                with self.send_lock:
                    self.request.sendall(encoded)
                probe.event("response", request_id=rpc.get("id"), first=first)
        except (BrokenPipeError, ConnectionResetError, OSError) as exc:
            probe.event("response_failed", request_id=rpc.get("id"), first=first, reason=type(exc).__name__)
        except Exception as exc:
            probe.event("harness_error", operation="IPC request", reason=type(exc).__name__, method=rpc.get("method"))
            self.close_connection()
        finally:
            if first and not probe.first_done:
                with probe.lock:
                    probe.first_done = True
                    probe.event("first_finished")

    def handle(self):
        decoder = json.JSONDecoder()
        buffer = b""
        while True:
            block = self.request.recv(65536)
            if not block:
                break
            buffer += block
            if len(buffer) > 1024 * 1024:
                self.server.probe.event("harness_error", operation="IPC request too large")
                break
            while buffer.strip():
                try:
                    decoded = buffer.decode("utf-8")
                    request, consumed = decoder.raw_decode(decoded.lstrip())
                except (UnicodeDecodeError, json.JSONDecodeError):
                    break
                consumed += len(decoded) - len(decoded.lstrip())
                buffer = decoded[consumed:].encode()
                if not isinstance(request, dict):
                    self.server.probe.event("harness_error", operation="IPC request shape")
                    return
                threading.Thread(target=self.handle_one, args=(request,), daemon=True).start()


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def serve():
    release_proxy()
    case = os.environ["RELEASE_WAIT_CASE"]
    if case not in CASES:
        raise RuntimeError("Unsupported IPC wait case")
    os.umask(0o077)
    if os.path.lexists(SOCKET):
        raise RuntimeError("IPC fixture socket already exists")
    server = Server(SOCKET, Handler)
    server.probe = Probe(case)
    server.serve_forever()


def evaluate(case, events, forge_status, receipt, same_socket_evidence):
    def rows(name):
        return [row for row in events if row["event"] == name]

    if rows("harness_error") or len(events) >= 2048:
        return "inconclusive"
    if case == "same-socket":
        if same_socket_evidence is None:
            return "inconclusive"
        starts, finishes = rows("synthetic_send_started"), rows("synthetic_send_finished")
        passed = same_socket_evidence["passed"] and len(starts) == len(finishes) == 1 and not rows("forward")
        passed &= bool(starts and finishes and starts[0]["connection"] == finishes[0]["connection"])
        if passed:
            return "pass"
        return "compatibility_failure"

    sends, forwards, accepted = rows("send"), rows("forward"), rows("accepted")
    if forge_status in (124, 137) or not sends:
        return "inconclusive"
    expected = next((row["hash"] for row in rows("expected_hash")), None)
    if case in {"smoke", "delay-120", "receipt"}:
        first = sends[0]["fingerprint"]
        held_sends = [row for row in sends if row["fingerprint"] == first]
        held_forwards = [row for row in forwards if row["fingerprint"] == first]
        passed = forge_status == 0 and len(held_sends) == len(held_forwards) == 1
        passed &= bool(accepted and receipt and receipt.get("status") == "0x1" and receipt.get("transactionHash") == accepted[0]["hash"] == expected)
        passed &= bool(rows("receipt_success")) and not rows("extra_send")
        if case == "delay-120":
            passed &= bool(held_forwards and held_forwards[0]["at"] - sends[0]["at"] >= 120)
        if case == "receipt":
            nulls, mines, successes = rows("receipt_null"), rows("mine"), rows("receipt_success")
            passed &= bool(nulls and mines and successes and mines[0]["at"] - nulls[0]["at"] >= 10)
            passed &= bool(successes and len(sends) > 1 and all(row["at"] >= successes[0]["at"] and row["fingerprint"] != first for row in sends[1:]))
    elif case == "reject":
        passed = forge_status != 0 and not forwards and receipt is None and len(rows("denied")) == len(sends)
    elif case == "drop":
        passed = forge_status != 0 and len(forwards) == len(accepted) == 1
        passed &= bool(accepted and receipt and receipt.get("status") == "0x1" and receipt.get("transactionHash") == accepted[0]["hash"] == expected)
        passed &= bool(rows("dropped_after_acceptance"))
    elif case == "loss-hold":
        passed = forge_status != 0 and not forwards and receipt is None and bool(rows("dropped_during_hold"))
    else:
        return "inconclusive"
    if passed:
        return "pass"
    return "compatibility_failure"


def check(forge_status):
    case = os.environ["RELEASE_WAIT_CASE"]
    deadline = time.monotonic() + 30
    while True:
        events = [json.loads(line) for line in EVIDENCE.read_text().splitlines()]
        if any(row["event"] == "first_finished" for row in events) or not any(row["event"] == "send" for row in events):
            break
        if time.monotonic() > deadline:
            events.append({"event": "harness_error", "operation": "first worker did not finish"})
            break
        time.sleep(0.1)
    if case == "same-socket":
        evidence = json.loads(Path("/wait-evidence/same-socket.json").read_text())
        outcome = evaluate(case, events, forge_status, None, evidence)
        summary = {"case": case, "outcome": outcome, "evidence": evidence}
        Path("/wait-evidence/result.json").write_text(json.dumps(summary, indent=2) + "\n")
        print(json.dumps({"case": case, "outcome": summary["outcome"]}))
        return {"pass": 0, "compatibility_failure": 1, "inconclusive": 2}[outcome]
    expected = next((row["hash"] for row in events if row["event"] == "expected_hash"), None)
    receipt = None
    if expected is not None:
        receipt = node("eth_getTransactionReceipt", [expected])
    outcome = evaluate(case, events, forge_status, receipt, None)
    summary = {"case": case, "outcome": outcome, "forge_status": forge_status, "hash": expected, "receipt": receipt, "events": events}
    Path("/wait-evidence/result.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({key: value for key, value in summary.items() if key not in {"events", "receipt"}}))
    return {"pass": 0, "compatibility_failure": 1, "inconclusive": 2}[outcome]


def same_socket():
    """A two-ID client checks that a read can finish while its send is pending."""
    sock = socket.socket(socket.AF_UNIX)
    sock.settimeout(5)
    sock.connect(SOCKET)
    started = time.monotonic()
    requests = [
        {"jsonrpc": "2.0", "id": "pending-send", "method": "eth_sendRawTransaction", "params": ["0x1234"]},
        {"jsonrpc": "2.0", "id": "concurrent-read", "method": "eth_blockNumber", "params": []},
    ]
    try:
        sock.sendall(b"".join(json.dumps(item).encode() + b"\n" for item in requests))
        received = b""
        replies = {}
        while len(replies) < 2:
            received += sock.recv(4096)
            while b"\n" in received:
                line, received = received.split(b"\n", 1)
                reply = json.loads(line)
                replies[reply["id"]] = (reply, time.monotonic() - started)
        read, read_elapsed = replies["concurrent-read"]
        send, send_elapsed = replies["pending-send"]
        passed = isinstance(read.get("result"), str) and read_elapsed < 2 and send_elapsed >= 3 and "error" in send
        Path("/wait-evidence/same-socket.json").write_text(json.dumps({"passed": passed, "read_elapsed": read_elapsed, "send_elapsed": send_elapsed}) + "\n")
        if passed:
            return 0
        return 1
    finally:
        sock.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["same-socket"]:
        raise SystemExit(same_socket())
    if len(sys.argv) == 3 and sys.argv[1] == "check":
        try:
            raise SystemExit(check(int(sys.argv[2])))
        except Exception as exc:
            print(f"IPC fixture checker failed: {type(exc).__name__}", file=sys.stderr)
            raise SystemExit(2) from exc
    serve()
