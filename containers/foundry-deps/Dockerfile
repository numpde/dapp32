# syntax=docker/dockerfile:1.7

# Foundry image for the networked dependency staging lane.
#
# Keep fetch/extract tools out of the normal offline build/test image. This
# image is used by soldeer-stage, where network access is expected and upstream
# archives are explicitly verified against soldeer.lock.
FROM ghcr.io/foundry-rs/foundry:stable@sha256:043752653d5be351c71709091b3db97c4421c907eb40ea294195e7f532aadf46

USER root

RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
    ca-certificates=20240203~22.04.1 \
    curl=7.81.0-1ubuntu1.24 \
    python3=3.10.6-1~22.04.1 \
    unzip=6.0-26ubuntu3.2; \
  rm -rf /var/lib/apt/lists/*

WORKDIR /work

RUN mkdir -p /input /out /work \
  && chmod 1777 /out

ENTRYPOINT []
CMD ["forge", "--version"]
