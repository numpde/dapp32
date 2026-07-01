#!/usr/bin/env python3
from __future__ import annotations

import http.server
import ipaddress
import os
import re
import select
import selectors
import socket
import sys
import time


def required_env(name: str) -> str:
    value = os.environ[name].strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


POSITIVE_INT_RE = re.compile(r"^[1-9][0-9]*$")
POSITIVE_SECONDS_RE = re.compile(r"^(?:[1-9][0-9]*)(?:\.[0-9]+)?$|^0\.[0-9]*[1-9][0-9]*$")
PORT_RE = re.compile(r"^[0-9]+$")
MAX_CONNECT_TARGET_BYTES = 261
MAX_TUNNEL_BUFFER_BYTES = 1_048_576


def required_positive_int_env(name: str) -> int:
    value = required_env(name)
    if POSITIVE_INT_RE.fullmatch(value) is None:
        raise RuntimeError(f"{name}: expected a positive decimal integer")
    return int(value)


def required_bounded_positive_int_env(name: str, maximum: int) -> int:
    value = required_positive_int_env(name)
    if value > maximum:
        raise RuntimeError(f"{name}: expected a positive decimal integer no greater than {maximum}")
    return value


def required_port_env(name: str) -> int:
    port = required_positive_int_env(name)
    if port > 65535:
        raise RuntimeError(f"{name}: expected a TCP port in 1..65535")
    return port


def required_positive_seconds_env(name: str) -> float:
    value = required_env(name)
    if POSITIVE_SECONDS_RE.fullmatch(value) is None:
        raise RuntimeError(f"{name}: expected positive seconds")
    return float(value)


LISTEN_HOST = required_env("HTTPS_EGRESS_PROXY_HOST")
LISTEN_PORT = required_port_env("HTTPS_EGRESS_PROXY_PORT")
CONNECT_TIMEOUT_SECONDS = required_positive_seconds_env("HTTPS_EGRESS_PROXY_CONNECT_TIMEOUT_SECONDS")
TUNNEL_IDLE_TIMEOUT_SECONDS = required_positive_seconds_env("HTTPS_EGRESS_PROXY_TUNNEL_IDLE_TIMEOUT_SECONDS")
MAX_HOST_BYTES = required_bounded_positive_int_env("HTTPS_EGRESS_PROXY_MAX_HOST_BYTES", MAX_CONNECT_TARGET_BYTES)
BUFFER_BYTES = required_bounded_positive_int_env("HTTPS_EGRESS_PROXY_BUFFER_BYTES", MAX_TUNNEL_BUFFER_BYTES)
ALLOWED_HOSTS = frozenset()


class ProxyRejected(Exception):
    pass


def normalize_host(host: str) -> str:
    normalized = host.strip().lower().rstrip(".")
    if not normalized:
        raise ProxyRejected("host is empty")
    return normalized


def parse_allowed_hosts(raw: str) -> frozenset[str]:
    hosts = [item for item in (part.strip() for part in raw.split(",")) if item]
    return frozenset(normalize_host(host) for host in hosts)


def require_allowed_host(host: str, allowed_hosts: frozenset[str] | None = None) -> None:
    if allowed_hosts is None:
        allowed_hosts = ALLOWED_HOSTS
    if not allowed_hosts:
        raise ProxyRejected("CONNECT target host allowlist is empty")

    normalized = normalize_host(host)
    if normalized not in allowed_hosts:
        raise ProxyRejected(f"CONNECT target host is not allowlisted: {normalized}")


def parse_connect_target(target: str) -> tuple[str, int]:
    if len(target.encode("utf-8")) > MAX_HOST_BYTES + 6:
        raise ProxyRejected("CONNECT target is too large")
    if any(ord(char) < 0x21 or ord(char) == 0x7F for char in target):
        raise ProxyRejected("CONNECT target contains invalid characters")

    if target.startswith("["):
        host, separator, port_text = target.rpartition("]:")
        if not separator:
            raise ProxyRejected("CONNECT target must include a port")
        host = host[1:]
    else:
        host, separator, port_text = target.rpartition(":")
        if not separator:
            raise ProxyRejected("CONNECT target must include a port")

    if not host:
        raise ProxyRejected("CONNECT target is missing a host")

    host = normalize_host(host)

    if PORT_RE.fullmatch(port_text) is None:
        raise ProxyRejected("CONNECT target has an invalid port")

    port = int(port_text)
    if port != 443:
        raise ProxyRejected("CONNECT target must use port 443")

    return host, port


def resolve_global_addresses(host: str, port: int) -> list[str]:
    try:
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ProxyRejected(f"DNS lookup failed: {exc}") from exc

    candidates: list[str] = []
    rejected: list[str] = []
    for family, _socktype, _proto, _canonname, sockaddr in addresses:
        if family not in (socket.AF_INET, socket.AF_INET6):
            continue

        ip = ipaddress.ip_address(sockaddr[0])
        if ip.is_global:
            candidates.append(str(ip))
        else:
            rejected.append(str(ip))

    if rejected:
        raise ProxyRejected(f"CONNECT target resolved to non-global address {', '.join(sorted(set(rejected)))}")
    if not candidates:
        raise ProxyRejected("CONNECT target did not resolve to a usable global address")

    return sorted(set(candidates), key=lambda value: (":" in value, value))


def connect_first(addresses: list[str], port: int) -> socket.socket:
    last_error: OSError | None = None
    for address in addresses:
        try:
            return socket.create_connection((address, port), CONNECT_TIMEOUT_SECONDS)
        except OSError as exc:
            last_error = exc

    raise ProxyRejected(f"CONNECT target connection failed: {last_error}")


def forward_bytes(destination: socket.socket, data: bytes, deadline: float) -> float | None:
    view = memoryview(data)

    while view:
        timeout = max(0.0, deadline - time.monotonic())
        if timeout == 0.0:
            return None

        _readable, writable, _errors = select.select([], [destination], [], timeout)
        if not writable:
            return None

        try:
            sent = destination.send(view)
        except OSError:
            return None
        if sent <= 0:
            return None

        view = view[sent:]
        deadline = time.monotonic() + TUNNEL_IDLE_TIMEOUT_SECONDS

    return deadline


def tunnel(client: socket.socket, upstream: socket.socket) -> None:
    selector = selectors.DefaultSelector()
    client.setblocking(False)
    upstream.setblocking(False)
    selector.register(client, selectors.EVENT_READ, upstream)
    selector.register(upstream, selectors.EVENT_READ, client)
    deadline = time.monotonic() + TUNNEL_IDLE_TIMEOUT_SECONDS

    try:
        while True:
            timeout = max(0.0, deadline - time.monotonic())
            if timeout == 0.0:
                return

            events = selector.select(timeout)
            if not events:
                return

            for key, _mask in events:
                source = key.fileobj
                destination = key.data
                try:
                    data = source.recv(BUFFER_BYTES)
                except OSError:
                    return
                if not data:
                    return
                next_deadline = forward_bytes(destination, data, deadline)
                if next_deadline is None:
                    return
                deadline = next_deadline
    finally:
        selector.close()


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "https-egress-proxy"
    # Intentional default: blanking Python's default sys_version intentionally
    # reduces response fingerprinting. Keep this local to the proxy handler so
    # it is not mistaken for an unconfigured server version.
    sys_version = ""

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self.send_response(204)
            self.send_header("connection", "close")
            self.end_headers()
            return

        self.send_error(405, "method not allowed")

    def do_CONNECT(self) -> None:
        upstream = None
        try:
            host, port = parse_connect_target(self.path)
            require_allowed_host(host)
            upstream = connect_first(resolve_global_addresses(host, port), port)
        except ProxyRejected as exc:
            self.send_error(502, str(exc))
            return
        except Exception:
            self.send_error(502, "CONNECT failed")
            return

        self.send_response(200, "Connection established")
        self.end_headers()

        try:
            tunnel(self.connection, upstream)
        finally:
            self.close_connection = True
            upstream.close()

    def do_DELETE(self) -> None:
        self.send_error(405, "method not allowed")

    def do_HEAD(self) -> None:
        self.send_error(405, "method not allowed")

    def do_OPTIONS(self) -> None:
        self.send_error(405, "method not allowed")

    def do_PATCH(self) -> None:
        self.send_error(405, "method not allowed")

    def do_POST(self) -> None:
        self.send_error(405, "method not allowed")

    def do_PUT(self) -> None:
        self.send_error(405, "method not allowed")

    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> int:
    global ALLOWED_HOSTS
    ALLOWED_HOSTS = parse_allowed_hosts(required_env("HTTPS_EGRESS_PROXY_ALLOWED_HOSTS"))

    server = http.server.ThreadingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    server.daemon_threads = True
    server.serve_forever()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:
        print(f"https-egress-proxy: {exc}", file=sys.stderr)
        raise SystemExit(1)
