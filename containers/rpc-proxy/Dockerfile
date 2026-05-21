# syntax=docker/dockerfile:1.19

# Minimal JSON-RPC reverse proxy for the networked Cast lane.
#
# The Cast container itself stays on an internal Docker network. Only this proxy
# gets egress, and the proxy validates the configured upstream before forwarding
# JSON-RPC requests.
FROM docker.io/library/python:3.13-alpine@sha256:420cd0bf0f3998275875e02ecd5808168cf0843cbb4d3c536432f729247b2acc

RUN addgroup -S rpcproxy \
  && adduser -S -D -H -u 65532 -G rpcproxy rpcproxy

COPY --chmod=0555 rpc_proxy.py /usr/local/bin/rpc-proxy

USER 65532:65532
EXPOSE 8080

ENTRYPOINT ["python3", "/usr/local/bin/rpc-proxy"]
