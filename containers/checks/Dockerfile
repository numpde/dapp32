# syntax=docker/dockerfile:1.7

# Minimal Python runtime for offline repository/source checks.
#
# This image deliberately does not copy repository files. The Compose lane
# mounts the repository read-only at runtime so checks always inspect the
# working tree that the operator is testing.
#
# Keep Python checks dependency-free: repo checks should use the Python standard
# library unless a future check clearly justifies a pinned, audited dependency.
# The Docker CLI and Compose plugin are present only so tests can render
# checked-in Compose files offline with `docker compose config`; do not mount
# the Docker socket into this container.
FROM docker.io/library/python:3.13-alpine@sha256:420cd0bf0f3998275875e02ecd5808168cf0843cbb4d3c536432f729247b2acc

RUN apk add --no-cache \
    docker-cli=29.5.1-r0 \
    docker-cli-compose=2.40.3-r6 \
  && addgroup -S repochecks \
  && adduser -S -D -H -u 65532 -G repochecks repochecks

WORKDIR /work

USER 65532:65532

ENTRYPOINT ["python3"]
CMD ["-I", "-B", "--version"]
