# syntax=docker/dockerfile:1.7

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
# Official Foundry image, pinned to the inspected multi-arch stable digest.
# Provides forge, cast, anvil, and chisel.
FROM ghcr.io/foundry-rs/foundry:stable@sha256:043752653d5be351c71709091b3db97c4421c907eb40ea294195e7f532aadf46

USER root

ARG SOLC_VERSION=0.8.35

WORKDIR /work

# Foundry installs missing Solidity compilers under the svm data directory.
# Provision the repo-pinned compiler while the image build has network, then
# verify the compiler is usable with Foundry's offline mode.
ENV XDG_DATA_HOME=/usr/local/share

RUN set -eux; \
  mkdir -p /tmp/solc-bootstrap/src; \
  printf 'pragma solidity %s; contract CompilerBootstrap {}\n' "${SOLC_VERSION}" > /tmp/solc-bootstrap/src/CompilerBootstrap.sol; \
  printf '[profile.default]\nsolc = "%s"\nsrc = "src"\nout = "out"\ncache_path = "cache"\n' "${SOLC_VERSION}" > /tmp/solc-bootstrap/foundry.toml; \
  forge build --root /tmp/solc-bootstrap; \
  forge build --root /tmp/solc-bootstrap --offline; \
  rm -rf /tmp/solc-bootstrap /tmp/foundry-cache; \
  chmod -R a+rX /usr/local/share/svm

# Compose runs this image with a numeric host UID/GID, read-only rootfs, tmpfs
# caches, and network disabled for normal checks.
ENTRYPOINT []
CMD ["forge", "--version"]
