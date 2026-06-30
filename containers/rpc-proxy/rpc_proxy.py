#!/usr/bin/env python3
import http.client
import http.server
import ipaddress
import json
import os
import re
import socket
import ssl
import sys
from urllib.parse import urlsplit


def required_env(name):
    value = os.environ[name].strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


POSITIVE_INT_RE = re.compile(r"^[1-9][0-9]*$")
POSITIVE_SECONDS_RE = re.compile(r"^(?:[1-9][0-9]*)(?:\.[0-9]+)?$|^0\.[0-9]*[1-9][0-9]*$")
CONTENT_LENGTH_RE = re.compile(r"^[0-9]+$")


def required_positive_int_env(name):
    value = required_env(name)
    if POSITIVE_INT_RE.fullmatch(value) is None:
        raise RuntimeError(f"{name}: expected a positive decimal integer")
    return int(value)


def required_port_env(name):
    port = required_positive_int_env(name)
    if port > 65535:
        raise RuntimeError(f"{name}: expected a TCP port in 1..65535")
    return port


def required_positive_seconds_env(name):
    value = required_env(name)
    if POSITIVE_SECONDS_RE.fullmatch(value) is None:
        raise RuntimeError(f"{name}: expected positive seconds")
    return float(value)


LISTEN_HOST = required_env("RPC_PROXY_HOST")
LISTEN_PORT = required_port_env("RPC_PROXY_PORT")
UPSTREAM_FILE = required_env("RPC_UPSTREAM_FILE")
MAX_REQUEST_BYTES = required_positive_int_env("RPC_PROXY_MAX_REQUEST_BYTES")
MAX_RESPONSE_BYTES = required_positive_int_env("RPC_PROXY_MAX_RESPONSE_BYTES")
MAX_UPSTREAM_URL_BYTES = required_positive_int_env("RPC_PROXY_MAX_UPSTREAM_URL_BYTES")
CONNECT_TIMEOUT_SECONDS = required_positive_seconds_env("RPC_PROXY_CONNECT_TIMEOUT_SECONDS")
ALLOWED_METHODS = frozenset(
    method
    for method in required_env("RPC_ALLOWED_METHODS").replace(",", " ").split()
    if method
)

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


class UpstreamRejected(Exception):
    pass


class RpcRequestMalformed(Exception):
    pass


class RpcMethodRejected(Exception):
    pass


def reject_json_constant(value):
    raise RpcRequestMalformed(f"JSON-RPC request body contains non-standard JSON constant: {value}")


class FixedIpHttpsConnection(http.client.HTTPSConnection):
    def __init__(self, host, port, target_ip, timeout):
        super().__init__(host, port=port, timeout=timeout, context=ssl.create_default_context())
        self._target_ip = target_ip

    def connect(self):
        sock = socket.create_connection((self._target_ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def read_upstream():
    with open(UPSTREAM_FILE, "rb") as handle:
        raw = handle.read(MAX_UPSTREAM_URL_BYTES + 1)

    if len(raw) > MAX_UPSTREAM_URL_BYTES:
        raise UpstreamRejected("RPC upstream URL is too large")

    try:
        value = raw.decode("utf-8").strip()
    except UnicodeDecodeError as exc:
        raise UpstreamRejected("RPC upstream URL must be UTF-8") from exc

    if not value:
        raise UpstreamRejected("RPC upstream URL is empty")
    if any(ord(char) < 0x21 or ord(char) == 0x7F for char in value):
        raise UpstreamRejected("RPC upstream URL must not contain control characters or whitespace")

    parsed = urlsplit(value)
    if parsed.scheme != "https":
        raise UpstreamRejected("RPC upstream must use https")
    if not parsed.hostname:
        raise UpstreamRejected("RPC upstream is missing a host")
    if parsed.username or parsed.password:
        raise UpstreamRejected("RPC upstream must not include userinfo")
    if parsed.fragment:
        raise UpstreamRejected("RPC upstream must not include a fragment")

    try:
        parsed_port = parsed.port
    except ValueError as exc:
        raise UpstreamRejected("RPC upstream has an invalid port") from exc

    port = 443
    if parsed_port is not None:
        port = parsed_port
    if port != 443:
        raise UpstreamRejected("RPC upstream must use the default https port")

    path = parsed.path
    if path == "":
        path = "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"

    return parsed.hostname, port, path


def resolve_global_ip(host, port):
    try:
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise UpstreamRejected(f"RPC upstream DNS lookup failed: {exc}") from exc

    candidates = []
    for family, _socktype, _proto, _canonname, sockaddr in addresses:
        if family not in (socket.AF_INET, socket.AF_INET6):
            continue

        ip = ipaddress.ip_address(sockaddr[0])
        if not ip.is_global:
            raise UpstreamRejected(f"RPC upstream resolved to non-global address {ip}")
        candidates.append(str(ip))

    if not candidates:
        raise UpstreamRejected("RPC upstream did not resolve to a usable IP address")

    return candidates[0]


def request_items(payload):
    if isinstance(payload, dict):
        return [payload]
    if isinstance(payload, list):
        if not payload:
            raise RpcRequestMalformed("JSON-RPC batch must not be empty")
        return payload
    raise RpcRequestMalformed("JSON-RPC request must be an object or batch array")


def validate_rpc_request(raw_body, allowed_methods):
    if not allowed_methods:
        raise RpcMethodRejected("RPC method allowlist is empty")

    try:
        payload = json.loads(raw_body, parse_constant=reject_json_constant)
    except json.JSONDecodeError as exc:
        raise RpcRequestMalformed("invalid JSON-RPC request body") from exc
    except UnicodeDecodeError as exc:
        raise RpcRequestMalformed("JSON-RPC request body must be UTF-8") from exc

    for item in request_items(payload):
        if not isinstance(item, dict):
            raise RpcRequestMalformed("JSON-RPC batch entries must be objects")

        method = item.get("method")
        if not isinstance(method, str) or not method:
            raise RpcRequestMalformed("JSON-RPC request method must be a non-empty string")

        if method not in allowed_methods:
            raise RpcMethodRejected(f"JSON-RPC method is not allowed: {method}")


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "safe-rpc-proxy"
    # Intentional default: blanking Python's default sys_version intentionally
    # reduces response fingerprinting. Keep this local to the proxy handler so
    # it is not mistaken for an unconfigured server version.
    sys_version = ""

    def do_GET(self):
        if self.path == "/healthz":
            self.send_response(204)
            self.end_headers()
            return

        self.send_error(405, "method not allowed")

    def do_POST(self):
        conn = None
        content_length = self.headers.get("content-length")
        if content_length is None:
            self.send_error(411, "content-length required")
            return

        if CONTENT_LENGTH_RE.fullmatch(content_length) is None:
            self.send_error(400, "invalid content-length")
            return

        request_size = int(content_length)
        if request_size > MAX_REQUEST_BYTES:
            self.send_error(413, "request too large")
            return

        request_body = self.rfile.read(request_size)

        try:
            validate_rpc_request(request_body, ALLOWED_METHODS)
            host, port, path = read_upstream()
            target_ip = resolve_global_ip(host, port)
            conn = FixedIpHttpsConnection(host, port, target_ip, CONNECT_TIMEOUT_SECONDS)
            # This proxy is a JSON-RPC method gate, not a generic HTTP relay.
            # Do not let untrusted viewer clients shape upstream request headers.
            headers = {"accept": "application/json", "content-type": "application/json", "host": host}
            conn.request("POST", path, body=request_body, headers=headers)
            response = conn.getresponse()
            response_body = response.read(MAX_RESPONSE_BYTES + 1)
        except RpcRequestMalformed as exc:
            self.send_error(400, str(exc))
            return
        except RpcMethodRejected as exc:
            self.send_error(403, str(exc))
            return
        except UpstreamRejected as exc:
            self.send_error(502, str(exc))
            return
        except Exception:
            self.send_error(502, "RPC upstream request failed")
            return
        finally:
            if conn is not None:
                conn.close()

        if len(response_body) > MAX_RESPONSE_BYTES:
            self.send_error(502, "RPC upstream response too large")
            return

        self.send_response(response.status, response.reason)
        for name, value in response.getheaders():
            if name.lower() in HOP_BY_HOP_HEADERS:
                continue
            if name.lower() == "content-length":
                continue
            self.send_header(name, value)
        self.send_header("content-length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def log_message(self, _format, *_args):
        return


def main():
    read_upstream()

    server = http.server.HTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"rpc-proxy: invalid upstream: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
