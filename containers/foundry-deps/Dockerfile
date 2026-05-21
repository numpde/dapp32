# syntax=docker/dockerfile:1.19

# Foundry image for the networked dependency staging lane.
#
# Keep dependency-staging tools out of the normal offline build/test image. This
# image is used by soldeer-stage, where network access is expected and upstream
# archives are explicitly verified against soldeer.lock by the Python verifier.
FROM ghcr.io/foundry-rs/foundry:v1.7.1@sha256:8347b728d5d393dac1c018691b36f506d23b9dcd78341d40ea0fcb11c3a19cdd

USER root

RUN set -eux; \
  apt-get update; \
  apt-get install -y --no-install-recommends \
    libssl3=3.0.2-0ubuntu1.23 \
    patch=2.7.6-7build2 \
    python3=3.10.6-1~22.04.1 \
    python3.10=3.10.12-1~22.04.15; \
  rm -rf /var/lib/apt/lists/*

WORKDIR /work

RUN mkdir -p /input /out /work \
  && chmod 1777 /out

ENTRYPOINT []
CMD ["forge", "--version"]
