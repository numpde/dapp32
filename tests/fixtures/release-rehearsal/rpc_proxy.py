"""Use the production RPC request gates against one isolated rehearsal chain."""

import http.client
import http.server
import runpy

proxy = runpy.run_path("/usr/local/bin/rpc-proxy")


def require_fixture_upstream():
    with open(proxy["UPSTREAM_FILE"], "rb") as source:
        url = source.read(proxy["MAX_UPSTREAM_URL_BYTES"] + 1)
    if url.strip() != b"http://release-anvil:8545":
        raise ValueError("Rehearsal RPC upstream must be http://release-anvil:8545")


class RehearsalHandler(proxy["Handler"]):
    def open_upstream(self):
        require_fixture_upstream()
        return http.client.HTTPConnection("release-anvil", 8545, timeout=proxy["CONNECT_TIMEOUT_SECONDS"]), "/", "release-anvil"


if __name__ == "__main__":
    require_fixture_upstream()
    server = http.server.HTTPServer((proxy["LISTEN_HOST"], proxy["LISTEN_PORT"]), RehearsalHandler)
    server.serve_forever()
