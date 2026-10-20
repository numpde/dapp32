# Node image for npm dependency and JS workspace execution lanes.
#
# The image does not copy repository files. package-stage receives only a
# temporary manifest input directory at runtime, installs with lifecycle scripts
# disabled, and writes installed dependencies to a Docker volume. Offline
# JS lanes reuse the same image utilities to stage source files into tmpfs.
FROM docker.io/library/node:24.22.0-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5

COPY stage-node-modules stage-js-workspace run-js-workspace /usr/local/bin/

RUN set -eux; \
  chmod 0755 /usr/local/bin/stage-node-modules; \
  chmod 0755 /usr/local/bin/stage-js-workspace; \
  chmod 0755 /usr/local/bin/run-js-workspace; \
  mkdir -p /input /out /work; \
  chmod 1777 /out

WORKDIR /work

ENTRYPOINT []
CMD ["node", "--version"]
