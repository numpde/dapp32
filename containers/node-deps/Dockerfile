# syntax=docker/dockerfile:1.19

# Node image for npm dependency and package execution lanes.
#
# The image does not copy repository files. package-stage receives only a
# temporary manifest input directory at runtime, installs with lifecycle scripts
# disabled, and writes installed dependencies to a Docker volume. Offline
# package lanes reuse the same image utilities to stage source files into tmpfs.
FROM docker.io/library/node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d

COPY stage-node-modules stage-package-workspace /usr/local/bin/

RUN set -eux; \
  chmod 0755 /usr/local/bin/stage-node-modules; \
  chmod 0755 /usr/local/bin/stage-package-workspace; \
  mkdir -p /input /out /work; \
  chmod 1777 /out

WORKDIR /work

ENTRYPOINT []
CMD ["node", "--version"]
