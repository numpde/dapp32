"""Run the production RPC gate against the disposable Pay-to-Play chain."""

import http.client
import json
import os
import runpy
import time

proxy = runpy.run_path("/usr/local/bin/rpc-proxy")
SEND_COUNT = "/tmp/refund-sends"


class FixtureConnection(http.client.HTTPConnection):
    def request(self, method, url, body=None, headers=None, **kwargs):
        self.rpc_method = json.loads(body).get("method")
        if self.rpc_method == "eth_sendRawTransaction":
            # Count attempts before an ambiguous write: the peer may receive
            # the transaction even if request() ultimately raises.
            with open(SEND_COUNT, "a", encoding="ascii") as counts:
                counts.write("1\n")
        return super().request(method, url, body=body, headers=headers, **kwargs)

    def getresponse(self):
        response = super().getresponse()
        if self.rpc_method == "eth_getTransactionReceipt" and os.path.exists("/tmp/refund-response-dropped") and not os.path.exists("/tmp/refund-receipts-released"):
            response.read()
            raise ConnectionResetError("Fixture holds receipts until the worker is restarted")
        if self.rpc_method == "eth_sendRawTransaction":
            if not os.path.exists("/tmp/refund-drop-armed") or os.path.exists("/tmp/refund-response-dropped"):
                return response
            result = json.loads(response.read())
            if response.status != 200 or not isinstance(result.get("result"), str):
                raise ValueError("Fixture chain did not accept the submitted transaction")
            with open("/tmp/refund-response-dropped.tmp", "w", encoding="ascii") as marker:
                marker.write(result["result"])
            os.replace("/tmp/refund-response-dropped.tmp", "/tmp/refund-response-dropped")
            raise ConnectionResetError("Fixture dropped the accepted transaction response")
        return response


class FixtureHandler(proxy["Handler"]):
    def open_upstream(self, deadline):
        timeout = min(proxy["CONNECT_TIMEOUT_SECONDS"], deadline - time.monotonic())
        if timeout <= 0:
            raise TimeoutError("Fixture RPC deadline expired")
        return FixtureConnection("pay-to-play-anvil", 8545, timeout=timeout), "/", "pay-to-play-anvil"

    def do_GET(self):
        if self.path == "/fixture/arm-drop":
            with open("/tmp/refund-drop-armed", "w", encoding="ascii"):
                pass
            self.send_response(204)
            self.end_headers()
            return
        if self.path == "/fixture/release-receipts":
            with open("/tmp/refund-receipts-released", "w", encoding="ascii"):
                pass
            self.send_response(204)
            self.end_headers()
            return
        if self.path == "/fixture/dropped":
            try:
                with open("/tmp/refund-response-dropped", encoding="ascii") as marker:
                    body = marker.read().encode("ascii")
            except FileNotFoundError:
                body = b""
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path != "/fixture/sends":
            return super().do_GET()
        try:
            with open(SEND_COUNT, encoding="ascii") as counts:
                count = sum(1 for _ in counts)
        except FileNotFoundError:
            count = 0
        body = str(count).encode("ascii")
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = proxy["BoundedForkingHTTPServer"]((proxy["LISTEN_HOST"], proxy["LISTEN_PORT"]), FixtureHandler)
    proxy["run_server"](server)
