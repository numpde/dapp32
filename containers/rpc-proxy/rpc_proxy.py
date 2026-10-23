#!/usr/bin/env python3
"""Forward allowed JSON-RPC methods through bounded HTTPS and worker lifetimes."""

from contextlib import contextmanager
from collections import deque
from dataclasses import dataclass
import http.client
import http.server
import ipaddress
import json
import math
import multiprocessing
import os
import re
import signal
import socket
import ssl
import sys
import time
from urllib.parse import urlsplit


def required_env(name):
    value = os.environ[name].strip()
    if not value:
        raise RuntimeError(f"missing required environment variable: {name}")
    return value


POSITIVE_INT_RE = re.compile(r"^[1-9][0-9]*$")
POSITIVE_SECONDS_RE = re.compile(r"^(?:[1-9][0-9]*)(?:\.[0-9]+)?$|^0\.[0-9]*[1-9][0-9]*$")
CONTENT_LENGTH_RE = re.compile(r"^[0-9]+$")
MAX_REQUEST_LIMIT_BYTES = 16 * 1024 * 1024
MAX_RESPONSE_LIMIT_BYTES = 16 * 1024 * 1024
MAX_UPSTREAM_URL_LIMIT_BYTES = 16 * 1024
MAX_CONCURRENT_REQUESTS_LIMIT = 32
MAX_BATCH_ITEMS_LIMIT = 1000
MAX_TIMEOUT_SECONDS = 300


def required_positive_int_env(name):
    value = required_env(name)
    if POSITIVE_INT_RE.fullmatch(value) is None:
        raise RuntimeError(f"{name}: expected a positive decimal integer")
    return int(value)


def required_bounded_positive_int_env(name, maximum):
    value = required_positive_int_env(name)
    if value > maximum:
        raise RuntimeError(f"{name}: expected a positive decimal integer no greater than {maximum}")
    return value


def required_port_env(name):
    port = required_positive_int_env(name)
    if port > 65535:
        raise RuntimeError(f"{name}: expected a TCP port in 1..65535")
    return port


def required_positive_seconds_env(name):
    value = required_env(name)
    if POSITIVE_SECONDS_RE.fullmatch(value) is None:
        raise RuntimeError(f"{name}: expected positive seconds")
    seconds = float(value)
    if not math.isfinite(seconds) or seconds <= 0:
        raise RuntimeError(f"{name}: expected positive seconds")
    return seconds


def required_bounded_seconds_env(name):
    seconds = required_positive_seconds_env(name)
    if seconds > MAX_TIMEOUT_SECONDS:
        raise RuntimeError(f"{name}: expected positive seconds no greater than {MAX_TIMEOUT_SECONDS}")
    return seconds


LISTEN_HOST = required_env("RPC_PROXY_HOST")
LISTEN_PORT = required_port_env("RPC_PROXY_PORT")
UPSTREAM_FILE = required_env("RPC_UPSTREAM_FILE")
MAX_REQUEST_BYTES = required_bounded_positive_int_env("RPC_PROXY_MAX_REQUEST_BYTES", MAX_REQUEST_LIMIT_BYTES)
MAX_RESPONSE_BYTES = required_bounded_positive_int_env("RPC_PROXY_MAX_RESPONSE_BYTES", MAX_RESPONSE_LIMIT_BYTES)
MAX_UPSTREAM_URL_BYTES = required_bounded_positive_int_env("RPC_PROXY_MAX_UPSTREAM_URL_BYTES", MAX_UPSTREAM_URL_LIMIT_BYTES)
CONNECT_TIMEOUT_SECONDS = required_positive_seconds_env("RPC_PROXY_CONNECT_TIMEOUT_SECONDS")
MAX_CONCURRENT_REQUESTS = required_bounded_positive_int_env(
    "RPC_PROXY_MAX_CONCURRENT_REQUESTS", MAX_CONCURRENT_REQUESTS_LIMIT,
)
MAX_QUEUED_REQUESTS = os.environ.get("RPC_PROXY_MAX_QUEUED_REQUESTS")
# A queue requires a declared capacity; other callers retain immediate rejection.
if MAX_QUEUED_REQUESTS is not None:
    if re.fullmatch(r"0|[1-9][0-9]?", MAX_QUEUED_REQUESTS) is None or int(MAX_QUEUED_REQUESTS) > 64:
        raise RuntimeError("RPC_PROXY_MAX_QUEUED_REQUESTS: expected a decimal integer from 0 through 64")
    MAX_QUEUED_REQUESTS = int(MAX_QUEUED_REQUESTS)
MAX_BATCH_ITEMS = required_bounded_positive_int_env("RPC_PROXY_MAX_BATCH_ITEMS", MAX_BATCH_ITEMS_LIMIT)
REQUEST_DEADLINE_SECONDS = required_bounded_seconds_env("RPC_PROXY_REQUEST_TIMEOUT_SECONDS")
UPSTREAM_DEADLINE_SECONDS = required_bounded_seconds_env("RPC_PROXY_UPSTREAM_TIMEOUT_SECONDS")
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


class UpstreamDeadlineExceeded(Exception):
    pass


class RequestDeadlineExceeded(Exception):
    pass


class ServerStopping(BaseException):
    pass


def reject_json_constant(value):
    raise RpcRequestMalformed(f"JSON-RPC request body contains non-standard JSON constant: {value}")


def reject_duplicate_json_keys(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise RpcRequestMalformed("JSON-RPC request body contains duplicate object key")
        result[key] = value
    return result


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

    try:
        parsed = urlsplit(value)
    except ValueError as exc:
        raise UpstreamRejected("RPC upstream URL is malformed") from exc
    if parsed.scheme != "https":
        raise UpstreamRejected("RPC upstream must use https")
    if not parsed.hostname:
        raise UpstreamRejected("RPC upstream is missing a host")
    if parsed.username is not None or parsed.password is not None:
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


def resolve_addresses(host, port, sender):
    # The worker's graceful-stop handler must not prevent terminating DNS.
    signal.signal(signal.SIGTERM, signal.SIG_DFL)
    signal.pthread_sigmask(signal.SIG_UNBLOCK, {signal.SIGALRM, signal.SIGTERM})
    try:
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        sender.send((True, [(family, sockaddr[0]) for family, _, _, _, sockaddr in addresses]))
    except socket.gaierror:
        sender.send((False, "RPC upstream DNS lookup failed"))
    finally:
        sender.close()


def resolve_global_ip(host, port, deadline):
    process_context = multiprocessing.get_context("fork")
    receiver, sender = process_context.Pipe(duplex=False)
    resolver = process_context.Process(target=resolve_addresses, args=(host, port, sender))
    started = False
    try:
        old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGALRM, signal.SIGTERM})
        try:
            resolver.start()
            started = True
        finally:
            signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
        sender.close()
        remaining = deadline - time.monotonic()
        if remaining <= 0 or not receiver.poll(remaining):
            raise UpstreamDeadlineExceeded()
        try:
            succeeded, addresses = receiver.recv()
        except EOFError as exc:
            raise UpstreamRejected("RPC upstream DNS resolver exited without a result") from exc
        if not succeeded:
            raise UpstreamRejected(addresses)
    finally:
        receiver.close()
        sender.close()
        if started:
            # A deadline signal must not interrupt termination of a stalled
            # resolver and leave it running after the request has failed.
            old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGALRM, signal.SIGTERM})
            try:
                if resolver.is_alive():
                    resolver.terminate()
                resolver.join(timeout=0.1)
                if resolver.is_alive():
                    resolver.kill()
                    resolver.join(timeout=0.1)
            finally:
                signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)

    candidates = []
    for family, address in addresses:
        if family not in (socket.AF_INET, socket.AF_INET6):
            continue

        ip = ipaddress.ip_address(address)
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
        if len(payload) > MAX_BATCH_ITEMS:
            raise RpcRequestMalformed("JSON-RPC batch has too many entries")
        return payload
    raise RpcRequestMalformed("JSON-RPC request must be an object or batch array")


def validate_rpc_request(raw_body, allowed_methods):
    if not allowed_methods:
        raise RpcMethodRejected("RPC method allowlist is empty")

    try:
        payload = json.loads(
            raw_body.decode("utf-8"),
            object_pairs_hook=reject_duplicate_json_keys,
            parse_constant=reject_json_constant,
        )
    except UnicodeDecodeError as exc:
        raise RpcRequestMalformed("JSON-RPC request body must be UTF-8") from exc
    except (ValueError, RecursionError) as exc:
        raise RpcRequestMalformed("invalid JSON-RPC request body") from exc

    methods = set()
    for item in request_items(payload):
        if not isinstance(item, dict):
            raise RpcRequestMalformed("JSON-RPC batch entries must be objects")

        method = item.get("method")
        if not isinstance(method, str) or not method:
            raise RpcRequestMalformed("JSON-RPC request method must be a non-empty string")

        if method not in allowed_methods:
            raise RpcMethodRejected("JSON-RPC method is not allowed")
        methods.add(method)

    return frozenset(methods)


@contextmanager
def request_deadline(seconds, exception_type):
    """Nest the upstream budget inside the original client connection budget."""
    started = time.monotonic()
    old_handler = signal.getsignal(signal.SIGALRM)
    old_timer, old_interval = signal.getitimer(signal.ITIMER_REAL)
    parent_expires_first = old_timer > 0 and old_timer <= seconds

    def expired(signal_number, frame):
        if parent_expires_first and callable(old_handler):
            old_handler(signal_number, frame)
        raise exception_type()

    budget = min(seconds, old_timer) if old_timer > 0 else seconds
    signal.signal(signal.SIGALRM, expired)
    signal.setitimer(signal.ITIMER_REAL, budget)
    try:
        yield started + budget
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old_handler)
        if old_timer > 0:
            remaining = old_timer - (time.monotonic() - started)
            if remaining > 0:
                signal.setitimer(signal.ITIMER_REAL, remaining, old_interval)
            elif not isinstance(sys.exception(), (RequestDeadlineExceeded, ServerStopping, KeyboardInterrupt)) and callable(old_handler):
                # Cleanup can finish after the outer deadline. Preserve that
                # deadline even if another failure is already unwinding.
                old_handler(signal.SIGALRM, None)


def upstream_deadline():
    return request_deadline(UPSTREAM_DEADLINE_SECONDS, UpstreamDeadlineExceeded)


class Handler(http.server.BaseHTTPRequestHandler):
    timeout = CONNECT_TIMEOUT_SECONDS
    server_version = "safe-rpc-proxy"
    # Intentional default: blanking Python's default sys_version intentionally
    # reduces response fingerprinting. Keep this local to the proxy handler so
    # it is not mistaken for an unconfigured server version.
    sys_version = ""

    def handle(self):
        self.response_started = False
        self.upstream_started = False
        self.is_submission = False
        self.submission_started = False
        # A deadline may expire before BaseHTTPRequestHandler reads a line.
        self.requestline = ""
        self.request_version = "HTTP/1.0"
        self.command = None
        try:
            # The worker inherits the acceptance deadline, including time spent
            # waiting in the parent's queue.
            deadline = getattr(self.server, "connection_deadline", time.monotonic() + REQUEST_DEADLINE_SECONDS)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RequestDeadlineExceeded()
            with request_deadline(remaining, RequestDeadlineExceeded):
                super().handle()
        except RequestDeadlineExceeded:
            self.close_connection = True
            if self.upstream_started:
                status = 504
                reason = "RPC request deadline exceeded"
                if self.is_submission:
                    if self.submission_started:
                        reason += "; transaction submission outcome unknown"
                    else:
                        reason += " before transaction submission"
            else:
                status = 408
                reason = "RPC request deadline exceeded before forwarding"
            print(f"rpc-proxy: {reason}", file=sys.stderr)
            if not self.response_started:
                # Even the final error must not wait on a non-reading client.
                self.connection.settimeout(0.1)
                try:
                    self.send_error(status, reason)
                # silent-defaults: allow-exception-fallback -- A disconnected or non-reading client must not extend the expired request lifetime.
                except OSError:
                    pass

    def send_response(self, code, message=None):
        self.response_started = True
        super().send_response(code, message)

    def do_GET(self):
        if self.path == "/healthz":
            self.send_response(204)
            self.end_headers()
            return

        self.reject_method()

    def do_DELETE(self):
        self.reject_method()

    def do_HEAD(self):
        self.reject_method()

    def do_OPTIONS(self):
        self.reject_method()

    def do_PATCH(self):
        self.reject_method()

    def do_POST(self):
        conn = None
        submission_started = False
        is_submission = False
        lengths = self.headers.get_all("content-length", [])
        if self.headers.get_all("transfer-encoding") or len(lengths) > 1:
            self.send_error(400, "ambiguous request framing")
            return
        if not lengths:
            self.send_error(411, "content-length required")
            return

        content_length = lengths[0]
        if CONTENT_LENGTH_RE.fullmatch(content_length) is None:
            self.send_error(400, "invalid content-length")
            return

        # Compare decimal lengths before int(), including Python's digit limit.
        normalized_length = content_length.lstrip("0")
        if normalized_length == "":
            normalized_length = "0"
        maximum_length = str(MAX_REQUEST_BYTES)
        if len(normalized_length) > len(maximum_length) or (
            len(normalized_length) == len(maximum_length) and normalized_length > maximum_length
        ):
            self.send_error(413, "request too large")
            return
        request_size = int(normalized_length)

        request_body = self.rfile.read(request_size)
        if len(request_body) != request_size:
            self.send_error(400, "request body ended before content-length")
            return

        try:
            methods = validate_rpc_request(request_body, ALLOWED_METHODS)
            is_submission = "eth_sendRawTransaction" in methods
            self.is_submission = is_submission
            self.upstream_started = True
            with upstream_deadline() as deadline:
                conn, path, host = self.open_upstream(deadline)
                # This proxy is a JSON-RPC method gate, not a generic HTTP relay.
                # Do not let untrusted viewer clients shape upstream request headers.
                headers = {"accept": "application/json", "content-type": "application/json", "host": host}
                submission_started = True
                self.submission_started = True
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
        except UpstreamDeadlineExceeded:
            if is_submission:
                if submission_started:
                    reason = "RPC upstream deadline exceeded; transaction submission outcome unknown"
                else:
                    reason = "RPC upstream deadline exceeded before transaction submission"
            else:
                reason = "RPC upstream deadline exceeded"
            print(f"rpc-proxy: {reason}", file=sys.stderr)
            self.send_error(504, reason)
            return
        except RequestDeadlineExceeded:
            raise
        except Exception as exc:
            diagnostic = type(exc).__name__
            if isinstance(exc, ssl.SSLCertVerificationError):
                if hasattr(exc, "verify_code"):
                    diagnostic += f" verify_code={exc.verify_code}"
            elif isinstance(exc, ssl.SSLError):
                if hasattr(exc, "reason") and isinstance(exc.reason, str):
                    diagnostic += f" reason={ascii(exc.reason[:300])}"
            elif isinstance(exc, TimeoutError):
                diagnostic += ": timed out"
            elif isinstance(exc, OSError) and isinstance(exc.errno, int):
                diagnostic += f" errno={exc.errno}: {os.strerror(exc.errno)}"
            # Transport messages can contain the credential-bearing upstream
            # path or request contents; report only standard failure fields.
            if is_submission and submission_started:
                reason = "RPC upstream request failed; transaction submission outcome unknown"
            else:
                reason = "RPC upstream request failed"
            print(f"rpc-proxy: {reason}: {diagnostic[:500]}", file=sys.stderr)
            self.send_error(502, reason)
            return
        finally:
            if conn is not None:
                conn.close()

        if len(response_body) > MAX_RESPONSE_BYTES:
            if is_submission:
                self.send_error(502, "RPC upstream response too large; transaction submission outcome unknown")
            else:
                self.send_error(502, "RPC upstream response too large")
            return

        if response.status >= 400:
            print(f"rpc-proxy: upstream returned HTTP {response.status}", file=sys.stderr)
        self.send_response(response.status, response.reason)
        connection_headers = {
            token.strip().lower()
            for name, value in response.getheaders() if name.lower() == "connection"
            for token in value.split(",")
        }
        for name, value in response.getheaders():
            if name.lower() in HOP_BY_HOP_HEADERS or name.lower() in connection_headers:
                continue
            if name.lower() == "content-length":
                continue
            self.send_header(name, value)
        self.send_header("content-length", str(len(response_body)))
        self.end_headers()
        self.wfile.write(response_body)

    def do_PUT(self):
        self.reject_method()

    def open_upstream(self, deadline):
        host, port, path = read_upstream()
        target_ip = resolve_global_ip(host, port, deadline)
        return FixedIpHttpsConnection(host, port, target_ip, CONNECT_TIMEOUT_SECONDS), path, host

    def reject_method(self):
        self.send_error(405, "method not allowed")

    def log_message(self, _format, *_args):
        return


@dataclass(frozen=True)
class PendingConnection:
    """A parent-owned socket and its absolute monotonic deadline in seconds."""

    socket: socket.socket
    address: tuple
    deadline: float


class BoundedForkingHTTPServer(http.server.HTTPServer):
    """Own an optional bounded FIFO and reap each worker with its DNS descendants."""

    def __init__(self, server_address, handler_class):
        self.active_children = set()
        self.pending = deque()
        self.request_queue_size = MAX_CONCURRENT_REQUESTS
        super().__init__(server_address, handler_class)

    def collect_children(self):
        for pid in tuple(self.active_children):
            try:
                exited = os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            except ChildProcessError:
                self.active_children.discard(pid)
                continue
            if exited is not None:
                # Keep the owned leader unreaped until its descendants are
                # stopped, so its PID cannot be reused as another group ID.
                try:
                    os.killpg(pid, signal.SIGKILL)
                # silent-defaults: allow-exception-fallback -- A completed worker may have no remaining process group; its owned zombie is still reaped below.
                except ProcessLookupError:
                    pass
                os.waitpid(pid, 0)
                self.active_children.discard(pid)

    def service_actions(self):
        """Reap workers, remove expired or canceled waiters, then dispatch in FIFO order."""
        self.collect_children()
        for connection in tuple(self.pending):
            if time.monotonic() >= connection.deadline:
                self.reject_unforwarded(connection.socket, 408, "queue deadline expired")
                self.pending.remove(connection)
            elif self.has_observed_disconnect(connection.socket):
                self.shutdown_request(connection.socket)
                self.pending.remove(connection)
        while self.pending and len(self.active_children) < MAX_CONCURRENT_REQUESTS:
            self.start_next_connection()

    def has_observed_disconnect(self, request):
        """Detect transport failure or EOF without consuming input or waiting."""
        # Buffered bytes can hide a graceful close; cancel only on observed
        # transport errors or end-of-input, without consuming the request.
        try:
            if request.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR):
                return True
            return request.recv(1, socket.MSG_PEEK | socket.MSG_DONTWAIT) == b""
        # silent-defaults: allow-exception-fallback -- A nonblocking peek without available bytes provides no evidence that the peer has closed.
        except BlockingIOError:
            return False
        # silent-defaults: allow-exception-fallback -- These transport errors establish cancellation even when unread request bytes remain buffered.
        except (ConnectionResetError, ConnectionAbortedError):
            return True

    def reject_busy(self, request):
        self.reject_unforwarded(request, 503, "capacity exhausted")

    def reject_unforwarded(self, request, status, reason):
        """Close an undispatched socket after a bounded best-effort HTTP rejection."""
        print(f"rpc-proxy: request not forwarded: {reason}; active={len(self.active_children)} queued={len(self.pending)}", file=sys.stderr)
        try:
            request.setblocking(False)
            request.sendall(
                f"HTTP/1.0 {status} {http.HTTPStatus(status).phrase}\r\n".encode()
                + b"Content-Length: 0\r\nConnection: close\r\nRetry-After: 1\r\n\r\n"
            )
        # silent-defaults: allow-exception-fallback -- An overloaded server closes the socket even if its nonblocking rejection cannot reach the client.
        except OSError:
            pass
        finally:
            self.shutdown_request(request)

    def process_request(self, request, client_address):
        """Own the new socket, service older waiters, then enforce waiting capacity."""
        connection = PendingConnection(request, client_address, time.monotonic() + REQUEST_DEADLINE_SECONDS)
        # Maintenance can fork an older waiter. Track this socket first so that
        # worker closes its inherited copy too, even if admission later rejects it.
        self.pending.append(connection)
        self.service_actions()
        if connection not in self.pending:
            return
        if MAX_QUEUED_REQUESTS is None or len(self.pending) > MAX_QUEUED_REQUESTS:
            self.pending.remove(connection)
            self.reject_busy(request)

    def start_next_connection(self):
        """Transfer the oldest waiting socket to a worker while retaining its PID."""
        # Do not interrupt fork before the parent owns the child's lifetime.
        old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGTERM, signal.SIGINT})
        connection = self.pending.popleft()
        request = connection.socket
        client_address = connection.address
        try:
            pid = os.fork()
        except OSError:
            signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
            self.reject_busy(request)
            print("rpc-proxy: could not start request worker", file=sys.stderr)
            return

        if pid:
            self.active_children.add(pid)
            try:
                # Either side may win this race; both assign the same group.
                os.setpgid(pid, pid)
            # silent-defaults: allow-exception-fallback -- A completed worker can disappear before grouping; its recorded PID is still reaped.
            except ProcessLookupError:
                pass
            finally:
                self.close_request(request)
                signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
            return

        status = 1
        try:
            os.setpgid(0, 0)
            self.socket.close()
            # close() drops inherited descriptors; shutdown() would also disable
            # the parent's queued connections.
            for waiting in self.pending:
                waiting.socket.close()
            self.pending.clear()
            self.connection_deadline = connection.deadline

            def stop_worker(_signal_number, _frame):
                raise ServerStopping()

            signal.signal(signal.SIGTERM, stop_worker)
            signal.signal(signal.SIGINT, stop_worker)
            signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
            self.finish_request(request, client_address)
            status = 0
        except ServerStopping:
            status = 0
        except Exception:
            self.handle_error(request, client_address)
        finally:
            try:
                self.shutdown_request(request)
            finally:
                os._exit(status)

    def handle_error(self, _request, _client_address):
        # Exception text and tracebacks may contain upstream URLs or bodies.
        print("rpc-proxy: request worker failed", file=sys.stderr)

    def server_close(self):
        """Close parent-owned sockets, then stop and reap owned worker groups."""
        super().server_close()
        while self.pending:
            self.shutdown_request(self.pending.popleft().socket)
        self.collect_children()
        for pid in self.active_children:
            try:
                os.killpg(pid, signal.SIGTERM)
            # silent-defaults: allow-exception-fallback -- A worker may exit before its shutdown signal; collection below still reaps it.
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + 2
        while self.active_children and time.monotonic() < deadline:
            self.collect_children()
            if self.active_children:
                time.sleep(0.01)
        for pid in tuple(self.active_children):
            try:
                os.killpg(pid, signal.SIGKILL)
            # silent-defaults: allow-exception-fallback -- Graceful shutdown can finish before escalation; waitpid below still reaps the worker.
            except ProcessLookupError:
                pass
            try:
                os.waitpid(pid, 0)
            # silent-defaults: allow-exception-fallback -- Another completed wait can already have reaped this owned child.
            except ChildProcessError:
                pass
            self.active_children.discard(pid)


def run_server(server):
    def stop(_signal_number, _frame):
        raise ServerStopping()

    old_handler = signal.signal(signal.SIGTERM, stop)
    try:
        server.serve_forever(poll_interval=0.1)
    # silent-defaults: allow-exception-fallback -- Operator stop is successful only after the finally block stops and reaps all request workers.
    except (ServerStopping, KeyboardInterrupt):
        pass
    finally:
        signal.signal(signal.SIGTERM, signal.SIG_IGN)
        try:
            server.server_close()
        finally:
            signal.signal(signal.SIGTERM, old_handler)


def main():
    read_upstream()

    server = BoundedForkingHTTPServer((LISTEN_HOST, LISTEN_PORT), Handler)
    run_server(server)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"rpc-proxy: could not run RPC proxy on {LISTEN_HOST}:{LISTEN_PORT}: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
