# syntax=docker/dockerfile:1.7

# Image definition for the Compose lanes in compose/forge.yml, compose/cast.yml,
# and compose/anvil.yml.
#
# The Compose files build this Dockerfile through:
#
#   build:
#     context: ..
#     dockerfile: containers/foundry/Dockerfile
#
# Keep this file small. It should describe the shared Foundry tool image only;
# runtime restrictions such as read-only mounts, no network, dropped
# capabilities, tmpfs caches, and loopback ports belong in the Compose files.
#
# Official Foundry image, pinned to the inspected multi-arch stable digest.
# Provides forge, cast, anvil, and chisel.
FROM ghcr.io/foundry-rs/foundry:stable@sha256:043752653d5be351c71709091b3db97c4421c907eb40ea294195e7f532aadf46

WORKDIR /work

# Compose runs this image with a numeric host UID/GID, read-only rootfs, tmpfs
# caches, and network disabled for normal checks.
#
# Offline forge lanes require the compiler pinned in foundry.toml to be
# available in the image/cache. Before enabling offline checks, extend this
# Dockerfile with an explicit, verified compiler provisioning step rather than
# relying on forge to download solc during tests.
CMD ["forge", "--version"]
