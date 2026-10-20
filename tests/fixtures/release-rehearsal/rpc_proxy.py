"""Use the production RPC request gates against one isolated rehearsal chain."""

import http.client
import http.server
import runpy
import time

proxy = runpy.run_path("/usr/local/bin/rpc-proxy")


def require_fixture_upstream():
    with open(proxy["UPSTREAM_FILE"], "rb") as source:
        url = source.read(proxy["MAX_UPSTREAM_URL_BYTES"] + 1)
    if url.strip() != b"http://release-anvil:8545":
        raise ValueError("Rehearsal RPC upstream must be http://release-anvil:8545")


class RehearsalHandler(proxy["Handler"]):
    def open_upstream(self, deadline):
        require_fixture_upstream()
        timeout = min(proxy["CONNECT_TIMEOUT_SECONDS"], deadline - time.monotonic())
        if timeout <= 0:
            raise TimeoutError("rehearsal RPC deadline expired")
        return http.client.HTTPConnection("release-anvil", 8545, timeout=timeout), "/", "release-anvil"


if __name__ == "__main__":
    require_fixture_upstream()
    server = http.server.HTTPServer((proxy["LISTEN_HOST"], proxy["LISTEN_PORT"]), RehearsalHandler)
    server.serve_forever()
