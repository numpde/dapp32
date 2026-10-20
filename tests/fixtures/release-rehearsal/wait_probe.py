"""Measure the pinned release client against an isolated node; never use live RPC."""

import hashlib
import http.client
import http.server
import json
import os
from pathlib import Path
import runpy
import socket
import socketserver
import sys
import threading
import time


CASES = ("delay-10", "delay-50", "delay-120", "receipt", "reject", "drop")
EVIDENCE = Path("/wait-evidence/events.jsonl")


def node(method, params):
    connection = http.client.HTTPConnection("release-anvil", 8545, timeout=20)
    try:
        connection.request("POST", "/", json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}), {"content-type": "application/json"})
        response = connection.getresponse()
        body = response.read(1024 * 1024 + 1)
        if response.status != 200 or len(body) > 1024 * 1024:
            raise RuntimeError("Fixture node returned an invalid HTTP response")
        value = json.loads(body)
        if "error" in value:
            raise RuntimeError(f"Fixture node rejected {method}")
        return value["result"]
    finally:
        connection.close()


def evaluate(case, events, forge_status, receipt):
    def rows(name):
        return [row for row in events if row["event"] == name]

    sends, forwards, accepted = rows("send"), rows("forward"), rows("accepted")
    expected_hashes = rows("expected_hash")
    if forge_status in (124, 137) or not sends or rows("harness_error") or len(events) >= 2048:
        return "inconclusive", "Fixture/setup/runner limit prevented client qualification"
    first = sends[0]["fingerprint"]
    held_sends = [row for row in sends if row["fingerprint"] == first]
    held_forwards = [row for row in forwards if row["fingerprint"] == first]
    successful_receipt = bool(accepted and expected_hashes and receipt and receipt.get("status") == "0x1" and receipt.get("transactionHash") == accepted[0]["hash"] == expected_hashes[0]["hash"])
    if case == "reject":
        passed = forge_status != 0 and not forwards and len(rows("denied")) == len(sends)
    elif case == "drop":
        passed = forge_status != 0 and len(forwards) == 1 and bool(rows("dropped")) and successful_receipt
        passed = passed and any(row["first"] for row in rows("response_failed")) and not any(row["first"] for row in rows("response"))
    else:
        passed = forge_status == 0 and successful_receipt and len(held_sends) == len(held_forwards) == 1
        passed = passed and not rows("extra_send") and bool(rows("response"))
        if case.startswith("delay-"):
            delay = int(case.split("-")[1])
            passed = passed and bool(held_forwards) and held_forwards[0]["at"] - sends[0]["at"] >= delay
            finished = rows("first_finished")
            passed = passed and bool(finished) and all(row["at"] >= finished[0]["at"] for row in sends[1:])
            for name in ("health", "block"):
                passed = passed and len(rows(name)) == 1 and rows(name)[0]["elapsed"] <= 5
                if rows(name) and held_forwards:
                    sample = rows(name)[0]
                    passed = passed and sample["at"] - sample["elapsed"] >= sends[0]["at"] and sample["at"] < held_forwards[0]["at"]
            passed = passed and bool(rows("receipt_success"))
        elif case == "receipt":
            nulls, mines, successes = rows("receipt_null"), rows("mine"), rows("receipt_success")
            passed = passed and bool(nulls and mines and successes)
            if nulls and mines and successes:
                passed = passed and mines[0]["at"] - nulls[0]["at"] >= 10
                passed = passed and accepted[0]["at"] <= nulls[0]["at"] <= mines[0]["at"] <= successes[0]["at"]
                passed = passed and all(row["at"] >= successes[0]["at"] for row in sends[1:])
                passed = passed and len(sends) > 1
    if passed:
        return "pass", "All case assertions passed"
    return "compatibility_failure", "Client did not meet this case's acceptance assertions"


class Response:
    status, reason = 200, "OK"

    def __init__(self, body):
        self.body = body

    def read(self, size):
        return self.body[:size]

    def getheaders(self):
        return [("content-type", "application/json")]


class Probe:
    def __init__(self, case):
        self.case = case
        self.lock = threading.RLock()
        self.output = EVIDENCE.open("x", encoding="utf-8")
        self.first = None
        self.started = None
        self.hash = None
        self.finished = False
        self.first_response = False
        self.null_seen = False
        self.receipt_seen = False
        self.events = 0

    def event(self, name, **facts):
        with self.lock:
            if self.events >= 2048 or self.output.tell() >= 1024 * 1024:
                raise RuntimeError("Wait fixture evidence limit reached")
            self.events += 1
            self.output.write(json.dumps({"event": name, "at": time.monotonic(), **facts}) + "\n")
            self.output.flush()

    def reads_during_hold(self):
        try:
            for name in ("health", "block"):
                connection = http.client.HTTPConnection("127.0.0.1", 8080, timeout=5)
                started = time.monotonic()
                try:
                    if name == "health":
                        connection.request("GET", "/healthz")
                    else:
                        connection.request("POST", "/", json.dumps({"jsonrpc": "2.0", "id": "independent-probe", "method": "eth_blockNumber", "params": []}), {"content-type": "application/json"})
                    response = connection.getresponse()
                    body = response.read(4096)
                    if response.status != {"health": 204, "block": 200}[name]:
                        raise RuntimeError("Concurrent fixture read failed")
                    if name == "block" and not isinstance(json.loads(body).get("result"), str):
                        raise RuntimeError("Concurrent block query had no result")
                    self.event(name, elapsed=time.monotonic() - started)
                finally:
                    connection.close()
        except Exception as exc:
            self.event("harness_error", operation="concurrent reads", reason=type(exc).__name__)

    def mine_after_null(self):
        try:
            time.sleep(10)
            self.event("mine")
            node("evm_mine", [])
            node("evm_setAutomine", [True])
        except Exception as exc:
            self.event("harness_error", operation="controlled mining", reason=type(exc).__name__)


class ObservedConnection:
    def __init__(self, probe, handler):
        self.probe, self.handler = probe, handler
        self.connection = http.client.HTTPConnection("release-anvil", 8545, timeout=20)
        self.synthetic = None
        self.sent = False

    def request(self, method, path, body, headers):
        try:
            self.observe_request(method, path, body, headers)
        except Exception as exc:
            self.probe.event("harness_error", operation="upstream request", reason=type(exc).__name__)
            raise

    def observe_request(self, method, path, body, headers):
        self.request_value = json.loads(body)
        rpc = self.request_value
        if isinstance(rpc, dict) and rpc.get("method") == "eth_sendRawTransaction":
            signed = rpc["params"][0]
            fingerprint = hashlib.sha256(bytes.fromhex(signed.removeprefix("0x"))).hexdigest()
            probe = self.probe
            with probe.lock:
                probe.event("send", fingerprint=fingerprint, request_id=rpc.get("id"))
                first = probe.first is None
                self.handler.wait_was_send = True
                self.handler.wait_was_first = first
                if first:
                    probe.first, probe.started = fingerprint, time.monotonic()
                    probe.hash = node("web3_sha3", [signed])
                    probe.event("expected_hash", hash=probe.hash)
                extra = not first and (fingerprint == probe.first or not probe.first_response or probe.case in ("drop", "reject") or (probe.case == "receipt" and not probe.receipt_seen))
                if extra:
                    probe.event("extra_send", fingerprint=fingerprint)
                if probe.case == "reject" or extra:
                    probe.event("denied")
                    self.synthetic = Response(json.dumps({"jsonrpc": "2.0", "id": rpc.get("id"), "error": {"code": -32000, "message": "Fixture approval denied"}}).encode())
                    return
            if first and probe.case.startswith("delay-"):
                threading.Thread(target=probe.reads_during_hold, daemon=True).start()
                time.sleep(max(0, probe.started + int(probe.case.split("-")[1]) - time.monotonic()))
            if first and probe.case == "receipt":
                node("evm_setAutomine", [False])
            probe.event("forward", fingerprint=fingerprint)
            self.sent = True
        self.connection.request(method, path, body=body, headers=headers)

    def getresponse(self):
        try:
            return self.observe_response()
        except Exception as exc:
            self.probe.event("harness_error", operation="upstream response", reason=type(exc).__name__)
            raise

    def observe_response(self):
        if self.synthetic is not None:
            return self.synthetic
        response = self.connection.getresponse()
        body = response.read(1024 * 1024 + 1)
        if response.status != 200 or len(body) > 1024 * 1024:
            raise RuntimeError("Wait fixture upstream response is invalid")
        value = json.loads(body)
        probe = self.probe
        if self.sent:
            if "result" not in value:
                raise RuntimeError("Fixture transaction submission was rejected upstream")
            probe.event("accepted", hash=value["result"])
            if value["result"] != probe.hash and not probe.first_response:
                raise RuntimeError("Fixture transaction hash mismatch")
            if probe.case == "drop":
                probe.event("dropped")
                self.handler.connection.shutdown(socket.SHUT_RDWR)
                self.handler.connection.close()
        rpc = self.request_value
        if isinstance(rpc, dict) and rpc.get("method") == "eth_getTransactionReceipt" and rpc.get("params") == [probe.hash]:
            with probe.lock:
                if value.get("result") is None and not probe.null_seen:
                    probe.null_seen = True
                    probe.event("receipt_null")
                    if probe.case == "receipt":
                        threading.Thread(target=probe.mine_after_null, daemon=True).start()
                elif isinstance(value.get("result"), dict) and value["result"].get("status") == "0x1" and not probe.receipt_seen:
                    probe.receipt_seen = True
                    probe.event("receipt_success")
        return Response(body)

    def close(self):
        self.connection.close()


def serve():
    os.umask(0o077)
    case = os.environ["RELEASE_WAIT_CASE"]
    if case not in CASES:
        raise RuntimeError("Unsupported fixture wait case")
    fixture = runpy.run_path("/rehearsal/rpc_proxy.py")
    fixture["require_fixture_upstream"]()
    probe = Probe(case)

    class Handler(fixture["RehearsalHandler"]):
        def open_upstream(self):
            return ObservedConnection(probe, self), "/", "release-anvil"

        def do_POST(self):
            try:
                super().do_POST()
                if getattr(self, "wait_was_send", False):
                    probe.event("response", first=self.wait_was_first)
            except (BrokenPipeError, ConnectionResetError, OSError) as exc:
                probe.event("response_failed", reason=type(exc).__name__, first=getattr(self, "wait_was_first", False))
            finally:
                if getattr(self, "wait_was_first", False):
                    with probe.lock:
                        probe.first_response = True
                        probe.finished = True
                        probe.event("first_finished")

    class Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True
        slots = threading.BoundedSemaphore(8)

        def process_request(self, request, address):
            if not self.slots.acquire(blocking=False):
                probe.event("harness_error", operation="connection limit")
                self.shutdown_request(request)
                return
            super().process_request(request, address)

        def process_request_thread(self, request, address):
            try:
                super().process_request_thread(request, address)
            finally:
                self.slots.release()

    Server(("0.0.0.0", 8080), Handler).serve_forever()


def check(forge_status):
    case = os.environ["RELEASE_WAIT_CASE"]
    # A timed-out client can exit before the first server worker finishes.
    deadline = time.monotonic() + 155
    while True:
        contents = EVIDENCE.read_bytes()
        if len(contents) > 1024 * 1024:
            raise RuntimeError("Wait fixture evidence exceeded its byte limit")
        events = [json.loads(line) for line in contents.splitlines(keepends=True) if line.endswith(b"\n")]
        if any(row["event"] == "first_finished" for row in events) or not any(row["event"] == "send" for row in events):
            break
        if time.monotonic() >= deadline:
            events.append({"event": "harness_error", "at": time.monotonic(), "operation": "first worker did not finish"})
            break
        time.sleep(0.1)
    expected = next((row["hash"] for row in events if row["event"] == "expected_hash"), None)
    receipt = None
    if expected:
        try:
            receipt = node("eth_getTransactionReceipt", [expected])
        except Exception as exc:
            events.append({"event": "harness_error", "at": time.monotonic(), "operation": "final receipt lookup", "reason": type(exc).__name__})
    outcome, reason = evaluate(case, events, forge_status, receipt)
    summary = {"case": case, "outcome": outcome, "reason": reason, "forge_status": forge_status, "hash": expected, "receipt": receipt, "events": events}
    Path("/wait-evidence/result.json").write_text(json.dumps(summary, indent=2) + "\n")
    print(json.dumps({key: value for key, value in summary.items() if key not in ("receipt", "events")}))
    return {"pass": 0, "inconclusive": 2, "compatibility_failure": 1}[outcome]


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "check":
        try:
            status = check(int(sys.argv[2]))
        except Exception as exc:
            print(f"Wait fixture checker failed: {type(exc).__name__}", file=sys.stderr)
            raise SystemExit(2) from exc
        raise SystemExit(status)
    serve()
