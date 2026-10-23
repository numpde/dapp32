from __future__ import annotations

from contextlib import contextmanager
import http.client
import json
import multiprocessing
import os
import select
from pathlib import Path
import signal
import socket
import struct
import tempfile
import time
import unittest

from .common import import_python_module_with_env, repo_path
from .test_rpc_proxy import proxy_environment


def serve_fixture(upstream_path, ready, activity, release, overrides, stall_dns):
    proxy = import_python_module_with_env(
        "rpc_proxy_server_under_test",
        repo_path("containers/rpc-proxy/rpc_proxy.py"),
        {**proxy_environment(upstream_path), **overrides},
    )

    class FixtureResponse:
        status = 200
        reason = "OK"

        def __init__(self, request_id):
            self.request_id = request_id

        def read(self, _limit):
            if self.request_id.startswith("block"):
                deadline = time.monotonic() + 30
                while release.value < (2 if self.request_id == "block-next" else 1):
                    if time.monotonic() >= deadline:
                        raise TimeoutError("fixture response was not released")
                    time.sleep(0.01)
            return json.dumps({"jsonrpc": "2.0", "id": self.request_id, "result": "0x2"}).encode()

        def getheaders(self):
            return [("content-type", "application/json")]

    class FixtureTransport:
        def request(self, _method, _path, *, body, headers):
            self.request_id = json.loads(body)["id"]
            activity.send(("upstream", self.request_id, os.getpid()))

        def getresponse(self):
            return FixtureResponse(self.request_id)

        def close(self):
            pass

    class FixtureHandler(proxy.Handler):
        def setup(self):
            super().setup()
            activity.send(("accepted", os.getpid()))

        def open_upstream(self, deadline):
            if stall_dns:
                proxy.resolve_global_ip("example.com", 443, deadline)
                raise AssertionError("the fixture DNS resolver must remain blocked")
            return FixtureTransport(), "/", "example.com"

    class FixtureServer(proxy.BoundedForkingHTTPServer):
        def __init__(self, _address, handler):
            super().__init__(("127.0.0.1", 0), handler)
            ready.send(self.server_address)
            ready.close()

        def service_actions(self):
            # Exercise accept-triggered dispatch without a periodic reap winning
            # the ownership race before the next connection arrives.
            if not overrides.get("FIXTURE_DISPATCH_ON_ACCEPT") or getattr(self, "accepting", False):
                super().service_actions()

        def process_request(self, request, client_address):
            self.accepting = True
            try:
                super().process_request(request, client_address)
            finally:
                self.accepting = False

    def blocked_dns(*_args, **_kwargs):
        activity.send(("dns", os.getpid()))
        time.sleep(30)
        return []

    proxy.Handler = FixtureHandler
    proxy.BoundedForkingHTTPServer = FixtureServer
    if stall_dns:
        proxy.socket.getaddrinfo = blocked_dns
    try:
        raise SystemExit(proxy.main())
    finally:
        activity.close()


class RpcProxyServerTest(unittest.TestCase):
    @contextmanager
    def server(self, *, stall_dns, overrides=None):
        if overrides is None:
            overrides = {}
        process_context = multiprocessing.get_context("fork")
        ready, ready_sender = process_context.Pipe(duplex=False)
        activity, activity_sender = process_context.Pipe(duplex=False)
        # Workers and DNS children are deliberately killed in these tests. A
        # shared condition can retain a dead waiter and hang its next notify;
        # this one-byte flag owns no lock or acknowledgement from the worker.
        release = process_context.RawValue("b", 0)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8") as upstream:
            upstream.write("https://example.com/rpc")
            upstream.flush()
            process = process_context.Process(target=serve_fixture, args=(
                upstream.name, ready_sender, activity_sender, release, overrides, stall_dns,
            ))
            process.start()
            ready_sender.close()
            activity_sender.close()
            try:
                self.assertTrue(ready.poll(3), "proxy did not bind its loopback listener")
                address = ready.recv()
                yield address, activity, release, process
            finally:
                release.value = 1
                if process.is_alive():
                    process.terminate()
                process.join(timeout=3)
                if process.is_alive():
                    process.kill()
                    process.join(timeout=1)
                ready.close()
                activity.close()

    def next_activity(self, activity, kind):
        deadline = time.monotonic() + 3
        while True:
            self.assertTrue(activity.poll(max(0, deadline - time.monotonic())), f"proxy never reached {kind}")
            item = activity.recv()
            if item[0] == kind:
                return item

    def connect(self, address):
        connection = socket.create_connection(address, timeout=3)
        self.addCleanup(connection.close)
        return connection

    def send_rpc(self, connection, request_id):
        body = json.dumps({"jsonrpc": "2.0", "method": "eth_blockNumber", "id": request_id}).encode()
        connection.sendall(b"POST / HTTP/1.0\r\nContent-Length: " + str(len(body)).encode() + b"\r\n\r\n" + body)

    def response(self, connection):
        response = http.client.HTTPResponse(connection)
        response.begin()
        body = response.read()
        return response.status, dict(response.getheaders()), body

    def assert_recovers(self, address):
        deadline = time.monotonic() + 2
        while True:
            with self.connect(address) as connection:
                connection.sendall(b"GET /healthz HTTP/1.0\r\n\r\n")
                status, _, _ = self.response(connection)
            if status == 204:
                return
            self.assertEqual(503, status)
            self.assertLess(time.monotonic(), deadline, "finished workers did not release capacity")
            # A response can reach the peer before its worker exits; give the
            # supervisor a turn to reap it instead of relying on that ordering.
            time.sleep(0.02)

    def test_stalled_upstream_does_not_block_another_rpc_or_health_request(self):
        with self.server(stall_dns=False) as (address, activity, release, _process):
            stalled = self.connect(address)
            self.send_rpc(stalled, "block-first")
            self.next_activity(activity, "upstream")

            with self.connect(address) as other:
                self.send_rpc(other, "ready")
                status, _, body = self.response(other)
            self.assertEqual(200, status)
            self.assertEqual("ready", json.loads(body)["id"])
            self.assert_recovers(address)

            release.value = 1
            self.assertEqual(200, self.response(stalled)[0])

    def test_at_capacity_returns_503_without_forwarding_then_recovers(self):
        with self.server(stall_dns=False) as (address, activity, release, _process):
            blocked = []
            for request_id in ("block-first", "block-second"):
                connection = self.connect(address)
                self.send_rpc(connection, request_id)
                self.assertEqual(request_id, self.next_activity(activity, "upstream")[1])
                blocked.append(connection)

            with self.connect(address) as overload:
                self.send_rpc(overload, "never-forward")
                status, headers, _ = self.response(overload)
            self.assertEqual(503, status)
            self.assertEqual("1", headers["Retry-After"])
            self.assertFalse(activity.poll(0.05), "overload was admitted to a worker")

            release.value = 1
            for connection in blocked:
                self.assertEqual(200, self.response(connection)[0])
            self.assert_recovers(address)

    def test_bounded_queue_absorbs_a_read_burst_without_extra_workers(self):
        with self.server(stall_dns=False, overrides={"RPC_PROXY_MAX_QUEUED_REQUESTS": "2"}) as (address, activity, release, _process):
            requests = []
            workers = set()
            for request_id in ("block-first", "block-second"):
                connection = self.connect(address)
                self.send_rpc(connection, request_id)
                workers.add(self.next_activity(activity, "upstream")[2])
                requests.append(connection)
            queued = self.connect(address)
            self.send_rpc(queued, "third")
            self.assertFalse(select.select([queued], [], [], 0.2)[0], "ordinary burst was rejected instead of queued")
            self.assertFalse(activity.poll(0.05), "queued request started another worker")
            self.assertEqual(2, len(workers))
            release.value = 1
            for connection in (*requests, queued):
                self.assertEqual(200, self.response(connection)[0])
            self.assertEqual("third", self.next_activity(activity, "upstream")[1])

    def test_queue_overflow_is_not_forwarded_and_fifo_recovers(self):
        with self.server(stall_dns=False, overrides={"RPC_PROXY_MAX_CONCURRENT_REQUESTS": "1", "RPC_PROXY_MAX_QUEUED_REQUESTS": "2"}) as (address, activity, release, _process):
            first = self.connect(address)
            self.send_rpc(first, "block-first")
            self.next_activity(activity, "upstream")
            queued = []
            for request_id in ("second", "third"):
                connection = self.connect(address)
                self.send_rpc(connection, request_id)
                queued.append(connection)
            overflow = self.connect(address)
            self.send_rpc(overflow, "must-not-forward")
            self.assertEqual(503, self.response(overflow)[0])
            release.value = 1
            for connection in (first, *queued):
                self.assertEqual(200, self.response(connection)[0])
            self.assertEqual("second", self.next_activity(activity, "upstream")[1])
            self.assertEqual("third", self.next_activity(activity, "upstream")[1])

    def test_expired_queued_request_is_never_forwarded(self):
        overrides = {"RPC_PROXY_MAX_CONCURRENT_REQUESTS": "1", "RPC_PROXY_MAX_QUEUED_REQUESTS": "1", "RPC_PROXY_REQUEST_TIMEOUT_SECONDS": "0.3"}
        with self.server(stall_dns=False, overrides=overrides) as (address, activity, _release, _process):
            blocked = self.connect(address)
            self.send_rpc(blocked, "block-first")
            worker = self.next_activity(activity, "upstream")[2]
            os.kill(worker, signal.SIGSTOP)
            try:
                queued = self.connect(address)
                self.send_rpc(queued, "must-not-forward")
                self.assertEqual(408, self.response(queued)[0])
                self.assertFalse(activity.poll(0.1), "expired request reached upstream")
            finally:
                os.kill(worker, signal.SIGCONT)

    def test_disconnected_waiter_releases_its_queue_slot(self):
        with self.server(stall_dns=False, overrides={"RPC_PROXY_MAX_CONCURRENT_REQUESTS": "1", "RPC_PROXY_MAX_QUEUED_REQUESTS": "1"}) as (address, activity, release, _process):
            blocked = self.connect(address)
            self.send_rpc(blocked, "block-first")
            self.next_activity(activity, "upstream")
            canceled = self.connect(address)
            self.send_rpc(canceled, "must-not-forward")
            canceled.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
            canceled.close()
            replacement = self.connect(address)
            self.send_rpc(replacement, "replacement")
            self.assertFalse(select.select([replacement], [], [], 0.2)[0])
            release.value = 1
            self.assertEqual(200, self.response(blocked)[0])
            self.assertEqual(200, self.response(replacement)[0])
            self.assertEqual("replacement", self.next_activity(activity, "upstream")[1])

    def test_shutdown_closes_queued_sockets_and_active_workers(self):
        with self.server(stall_dns=False, overrides={"RPC_PROXY_MAX_CONCURRENT_REQUESTS": "1", "RPC_PROXY_MAX_QUEUED_REQUESTS": "2"}) as (address, activity, _release, process):
            blocked = self.connect(address)
            self.send_rpc(blocked, "block-first")
            worker = self.next_activity(activity, "upstream")[2]
            queued = self.connect(address)
            self.send_rpc(queued, "must-not-forward")
            self.assertFalse(select.select([queued], [], [], 0.2)[0])
            process.terminate()
            process.join(timeout=3)
            self.assertFalse(process.is_alive())
            try:
                self.assertEqual(b"", queued.recv(1))
            except ConnectionResetError:
                pass
            with self.assertRaises(ProcessLookupError):
                os.kill(worker, 0)

    def test_promoted_worker_does_not_keep_a_new_arrivals_socket_open(self):
        overrides = {"RPC_PROXY_MAX_CONCURRENT_REQUESTS": "1", "RPC_PROXY_MAX_QUEUED_REQUESTS": "1", "FIXTURE_DISPATCH_ON_ACCEPT": "1"}
        with self.server(stall_dns=False, overrides=overrides) as (address, activity, release, _process):
            first = self.connect(address)
            self.send_rpc(first, "block-first")
            self.next_activity(activity, "upstream")
            older = self.connect(address)
            self.send_rpc(older, "block-next")
            self.assertFalse(select.select([older], [], [], 0.1)[0])
            release.value = 1
            self.assertEqual(200, self.response(first)[0])
            time.sleep(0.05)
            incoming = self.connect(address)
            self.assertEqual("block-next", self.next_activity(activity, "upstream")[1])
            incoming.shutdown(socket.SHUT_WR)
            trigger = self.connect(address)
            trigger.sendall(b"GET /healthz HTTP/1.0\r\n\r\n")
            incoming.settimeout(0.3)
            self.assertEqual(b"", incoming.recv(1), "promoted worker retained the unrelated accepted socket")
            release.value = 2
            self.assertEqual(200, self.response(older)[0])

    def test_dispatch_uses_the_remaining_connection_budget(self):
        overrides = {"RPC_PROXY_MAX_CONCURRENT_REQUESTS": "1", "RPC_PROXY_MAX_QUEUED_REQUESTS": "1", "RPC_PROXY_REQUEST_TIMEOUT_SECONDS": "1", "RPC_PROXY_UPSTREAM_TIMEOUT_SECONDS": "3"}
        with self.server(stall_dns=False, overrides=overrides) as (address, activity, _release, _process):
            first = self.connect(address)
            self.send_rpc(first, "block-first")
            self.next_activity(activity, "upstream")
            time.sleep(0.2)
            queued = self.connect(address)
            self.send_rpc(queued, "block-second")
            self.assertEqual(504, self.response(first)[0])
            started = time.monotonic()
            self.assertEqual(504, self.response(queued)[0])
            self.assertLess(time.monotonic() - started, 0.65, "dequeue reset the connection deadline")

    def test_connection_deadline_bounds_incomplete_headers_and_body(self):
        for request in (b"POST / HTTP/1.0\r\n", b"POST / HTTP/1.0\r\nContent-Length: 100\r\n\r\n{"):
            with self.subTest(request=request), self.server(stall_dns=False, overrides={
                "RPC_PROXY_MAX_CONCURRENT_REQUESTS": "1",
                "RPC_PROXY_CONNECT_TIMEOUT_SECONDS": "2",
                "RPC_PROXY_REQUEST_TIMEOUT_SECONDS": "0.25",
                "RPC_PROXY_UPSTREAM_TIMEOUT_SECONDS": "0.1",
            }) as (address, activity, _release, _process):
                connection = self.connect(address)
                connection.sendall(request)
                self.next_activity(activity, "accepted")
                started = time.monotonic()
                self.assertEqual(408, self.response(connection)[0])
                self.assertLess(time.monotonic() - started, 1.5, "client inactivity timeout replaced the whole-connection deadline")
                self.assertFalse(activity.poll(), "incomplete request reached the upstream")
                self.assert_recovers(address)

    def test_upstream_deadline_frees_a_slot_for_the_next_request(self):
        with self.server(stall_dns=False, overrides={
            "RPC_PROXY_MAX_CONCURRENT_REQUESTS": "1",
            "RPC_PROXY_UPSTREAM_TIMEOUT_SECONDS": "0.2",
        }) as (address, activity, _release, _process):
            connection = self.connect(address)
            self.send_rpc(connection, "block-until-deadline")
            self.next_activity(activity, "upstream")
            self.assertEqual(504, self.response(connection)[0])
            self.assert_recovers(address)

    def test_client_deadline_bounds_a_longer_upstream_budget_after_dispatch(self):
        with self.server(stall_dns=False, overrides={
            "RPC_PROXY_MAX_CONCURRENT_REQUESTS": "1",
            "RPC_PROXY_REQUEST_TIMEOUT_SECONDS": "0.25",
            "RPC_PROXY_UPSTREAM_TIMEOUT_SECONDS": "2",
        }) as (address, activity, _release, _process):
            connection = self.connect(address)
            self.send_rpc(connection, "block-past-client-deadline")
            self.next_activity(activity, "upstream")
            status, _, body = self.response(connection)
            self.assertEqual(504, status)
            self.assertIn(b"RPC request deadline exceeded", body)
            self.assertNotIn(b"RPC upstream deadline exceeded", body)
            self.assert_recovers(address)

    def test_sigterm_stops_active_worker_and_its_dns_resolver(self):
        with self.server(stall_dns=True) as (address, activity, _release, process):
            connection = self.connect(address)
            self.send_rpc(connection, "blocked-dns")
            worker_pid = self.next_activity(activity, "accepted")[1]
            dns_pid = self.next_activity(activity, "dns")[1]
            process.terminate()
            process.join(timeout=2)
            self.assertFalse(process.is_alive(), "SIGTERM did not stop the proxy")
            self.assertEqual(0, process.exitcode)
            for pid in (worker_pid, dns_pid):
                with self.subTest(pid=pid), self.assertRaises(ProcessLookupError):
                    os.kill(pid, 0)

    def test_killed_worker_stops_its_dns_resolver_and_releases_capacity(self):
        with self.server(stall_dns=True, overrides={
            "RPC_PROXY_MAX_CONCURRENT_REQUESTS": "1",
            "RPC_PROXY_UPSTREAM_TIMEOUT_SECONDS": "10",
            "RPC_PROXY_REQUEST_TIMEOUT_SECONDS": "20",
        }) as (address, activity, _release, process):
            connection = self.connect(address)
            self.send_rpc(connection, "blocked-dns")
            worker_pid = self.next_activity(activity, "accepted")[1]
            dns_pid = self.next_activity(activity, "dns")[1]
            os.kill(worker_pid, signal.SIGKILL)
            self.assert_recovers(address)

            deadline = time.monotonic() + 1
            while True:
                try:
                    state = Path(f"/proc/{dns_pid}/stat").read_text().split(")", 1)[1].split()[0]
                except FileNotFoundError:
                    break
                # The fixture container's PID 1 may retain an adopted zombie;
                # it must no longer execute or hold the accepted connection.
                if state == "Z":
                    break
                self.assertLess(time.monotonic(), deadline, "killed worker left its DNS resolver running")
                time.sleep(0.01)

            self.assertEqual(b"", connection.recv(1), "orphan resolver retained the client connection")
            process.terminate()
            process.join(timeout=2)
            self.assertFalse(process.is_alive(), "proxy did not stop after reaping the killed worker")
            self.assertEqual(0, process.exitcode)


if __name__ == "__main__":
    unittest.main()
