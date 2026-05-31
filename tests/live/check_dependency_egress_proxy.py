from __future__ import annotations

import os
import socket
import sys
import tomllib
from pathlib import Path
from urllib.parse import urlparse


def required_env(name: str) -> str:
    value = os.environ[name].strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


PROXY_HOST = required_env("DEPENDENCY_EGRESS_PROXY_HOST")
PROXY_PORT = int(required_env("DEPENDENCY_EGRESS_PROXY_PORT"))
LOCK_FILE = Path(required_env("DEPENDENCY_EGRESS_LOCK_FILE"))
DENIED_HOST = required_env("DEPENDENCY_EGRESS_DENIED_HOST")
CONNECT_TIMEOUT_SECONDS = float(required_env("DEPENDENCY_EGRESS_CONNECT_TIMEOUT_SECONDS"))


def locked_dependency_hosts() -> list[str]:
    lock = tomllib.loads(LOCK_FILE.read_text(encoding="utf-8"))
    dependencies = lock["dependencies"]
    if not isinstance(dependencies, list):
        raise RuntimeError(f"{LOCK_FILE}: dependencies must be a list")

    hosts = {
        host
        for record in dependencies
        if isinstance(record, dict)
        if isinstance(record.get("url"), str)
        if (hostname := urlparse(record["url"]).hostname) is not None
        if (host := hostname.lower().rstrip("."))
    }
    if not hosts:
        raise RuntimeError(f"no dependency hosts found in {LOCK_FILE}")
    return sorted(hosts)


def connect_status(target_host: str) -> bytes:
    with socket.create_connection((PROXY_HOST, PROXY_PORT), timeout=CONNECT_TIMEOUT_SECONDS) as sock:
        sock.settimeout(CONNECT_TIMEOUT_SECONDS)
        request = (
            f"CONNECT {target_host}:443 HTTP/1.1\r\n"
            f"Host: {target_host}:443\r\n"
            "Connection: close\r\n"
            "\r\n"
        ).encode("ascii")
        sock.sendall(request)
        response = b""
        while b"\r\n" not in response:
            chunk = sock.recv(4096)
            if not chunk:
                break
            response += chunk

    status, _separator, _rest = response.partition(b"\r\n")
    return status


def require_status_prefix(target_host: str, expected: bytes) -> bytes:
    status = connect_status(target_host)
    if not status.startswith(expected):
        raise RuntimeError(f"{target_host}: expected {expected!r}, got {status!r}")
    return status


def main() -> int:
    for allowed_host in locked_dependency_hosts():
        allowed_status = require_status_prefix(allowed_host, b"HTTP/1.1 200")
        print(f"live-deps-egress: allowed {allowed_host}:443 -> {allowed_status.decode('ascii', 'replace')}")

    denied_status = require_status_prefix(DENIED_HOST, b"HTTP/1.1 502")
    print(f"live-deps-egress: denied {DENIED_HOST}:443 -> {denied_status.decode('ascii', 'replace')}")

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"live-deps-egress: {exc}", file=sys.stderr)
        raise SystemExit(1)
