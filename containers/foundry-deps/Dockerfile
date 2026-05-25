# syntax=docker/dockerfile:1.19

# Foundry image for the networked Soldeer installation stage.
#
# Keep dependency-staging tools out of the normal offline build/test image. This
# image is used by soldeer-stage, where network access is expected for Soldeer
# install/update. Python verification and patch application run in the separate
# containers/python-deps image so this Foundry image does not carry Ubuntu
# Python packages.
FROM ghcr.io/foundry-rs/foundry:v1.7.1@sha256:8347b728d5d393dac1c018691b36f506d23b9dcd78341d40ea0fcb11c3a19cdd

USER root

WORKDIR /work

RUN mkdir -p /input /out /work \
  && chmod 1777 /out

ENTRYPOINT []
CMD ["forge", "--version"]
