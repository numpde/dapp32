# syntax=docker/dockerfile:1.19

# Python verifier image for the networked dependency staging lane.
#
# Foundry/Soldeer installation stays in containers/foundry-deps. This image
# runs only the Python dependency-integrity verifier and applies committed
# dependency patches against the staged Docker volume.
FROM docker.io/library/python:3.13-alpine@sha256:420cd0bf0f3998275875e02ecd5808168cf0843cbb4d3c536432f729247b2acc

RUN set -eux; \
  apk add --no-cache \
    patch=2.8-r0; \
  mkdir -p /input /out /work; \
  chmod 1777 /out

WORKDIR /work

ENTRYPOINT []
CMD ["python3", "-I", "-B", "--version"]
