from __future__ import annotations

from contextlib import contextmanager
import http.client
import json
import multiprocessing
import os
import socket
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
                release.wait(30)
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

    def blocked_dns(*_args, **_kwargs):
        activity.send(("dns", os.getpid()))
        release.wait(30)
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
        release = process_context.Event()
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
                if process.is_alive():
                    process.terminate()
                process.join(timeout=3)
                if process.is_alive():
                    process.kill()
                    process.join(timeout=1)
                ready.close()
                activity.close()
                release.set()

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
            multiprocessing.Event().wait(0.02)

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

            release.set()
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

            release.set()
            for connection in blocked:
                self.assertEqual(200, self.response(connection)[0])
            self.assert_recovers(address)

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


if __name__ == "__main__":
    unittest.main()
