# syntax=docker/dockerfile:1.19

# Minimal HTTPS CONNECT proxy for dependency installation lanes.
#
# The proxy is intentionally small and dependency-free. It allows CONNECT only
# to default HTTPS port 443, rejects non-global resolved addresses, and does not
# serve ordinary HTTP forwarding.
FROM docker.io/library/python:3.13-alpine@sha256:420cd0bf0f3998275875e02ecd5808168cf0843cbb4d3c536432f729247b2acc

RUN addgroup -S egressproxy \
  && adduser -S -D -H -u 65532 -G egressproxy egressproxy

COPY --chmod=0555 https_egress_proxy.py /usr/local/bin/https-egress-proxy

USER 65532:65532
EXPOSE 8080

ENTRYPOINT ["python3", "/usr/local/bin/https-egress-proxy"]
