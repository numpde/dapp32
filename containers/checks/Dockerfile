# syntax=docker/dockerfile:1.7

# Minimal Python runtime for offline repository/source checks.
#
# This image deliberately does not copy repository files. The Compose lane
# mounts the repository read-only at runtime so checks always inspect the
# working tree that the operator is testing.
#
# Keep this image dependency-free. Repo checks should use the Python standard
# library unless a future check clearly justifies a pinned, audited dependency.
FROM docker.io/library/python:3.13-alpine@sha256:420cd0bf0f3998275875e02ecd5808168cf0843cbb4d3c536432f729247b2acc

RUN addgroup -S repochecks \
  && adduser -S -D -H -u 65532 -G repochecks repochecks

WORKDIR /work

USER 65532:65532

ENTRYPOINT ["python3"]
CMD ["-I", "-B", "--version"]
