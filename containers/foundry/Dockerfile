# Image definition for the Compose lanes in compose/forge.yml, compose/cast.yml,
# and compose/anvil.yml.
#
# The Compose files build this Dockerfile through a deliberately narrow context:
#
#   build:
#     context: ../containers/foundry
#     dockerfile: Dockerfile
#
# Keep this file small. It should describe the shared Foundry tool image only;
# runtime restrictions such as read-only mounts, no network, dropped
# capabilities, tmpfs caches, and loopback ports belong in the Compose files.
#
# Compiler acquisition is a separate, digest-pinned base-image pull.
# The Linux amd64 compiler binary has a reviewed SHA-256 below.
# No networked Forge bootstrap is permitted in ordinary image preparation.
FROM ghcr.io/argotorg/solc:0.8.35@sha256:460a63309125ca1ba0892859917df4da31840a70e625bfe15b4519ed44220348 AS solc-release

# Official Foundry image, pinned to the inspected multi-arch v1.7.1 digest.
# Provides forge, cast, anvil, and chisel.
FROM ghcr.io/foundry-rs/foundry:v1.7.1@sha256:8347b728d5d393dac1c018691b36f506d23b9dcd78341d40ea0fcb11c3a19cdd

USER root

ARG TARGETARCH
ARG SOLC_VERSION=0.8.35
ARG SOLC_AMD64_SHA256=fa8ac9a32d301ad023a36ee5a29f8e291fe3200c60244e43c142539e82a617f4

# SVM finds installed compiler versions under $XDG_DATA_HOME/svm.
ENV XDG_DATA_HOME=/usr/local/share

WORKDIR /work

RUN mkdir -p /foundry-broadcast /input /out /work \
  && chmod 1777 /foundry-broadcast /out

COPY --from=solc-release /usr/bin/solc /usr/local/share/svm/0.8.35/solc-0.8.35

RUN set -eux; \
  test "${TARGETARCH}" = "amd64"; \
  sha256sum /usr/local/share/svm/0.8.35/solc-0.8.35; \
  printf '%s  %s\n' "${SOLC_AMD64_SHA256}" /usr/local/share/svm/0.8.35/solc-0.8.35 | sha256sum -c -; \
  /usr/local/share/svm/0.8.35/solc-0.8.35 --version | grep -F 'Version: 0.8.35+'; \
  mkdir -p /tmp/solc-bootstrap/src; \
  printf 'pragma solidity %s; contract CompilerBootstrap {}\n' "${SOLC_VERSION}" > /tmp/solc-bootstrap/src/CompilerBootstrap.sol; \
  printf '[profile.default]\nsolc = "%s"\nsrc = "src"\nout = "out"\ncache_path = "cache"\n' "${SOLC_VERSION}" > /tmp/solc-bootstrap/foundry.toml; \
  forge build --root /tmp/solc-bootstrap --offline; \
  rm -rf /tmp/solc-bootstrap /tmp/foundry-cache; \
  chmod -R a+rX /usr/local/share/svm

COPY --chmod=0755 forge-tests /usr/local/bin/forge-tests

# Compose runs this image with a numeric host UID/GID, read-only rootfs, tmpfs
# caches, and network disabled for normal checks.
ENTRYPOINT []
CMD ["forge", "--version"]
