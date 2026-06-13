# dapp32

dapp32 explores contract-defined workflows: contracts publish validated,
hash-pinned CAM bundles that generic viewers, wallets, and agents can render or
interpret without trusting bespoke frontend JavaScript.

Public overview: <https://numpde.github.io/dapp32/>

## Current Shape

The active rebuild is on `main`. The historical proof of concept is preserved
on `poc`.

- `dapps/bike-nft/` is the current demo dapp and local fixture.
- `dapps/bike-nft/cam/main.json` declares CAM namespaces, routes, ABI
  resources, and UI resources.
- `dapps/bike-nft/cam/ui.json` declares the portable UI node catalog.
- `js/packages/` contains the CAM protocol, EVM adapter, viewer, and
  conformance packages.
- `js/apps/cam-web/` is the local graphical reference viewer.
- `js/tools/cam-integration-fuzz/` walks deployed CAM hosts through the generic
  viewer path.

## Try It Locally

The supported operator entrypoint is the Docker-backed Makefile. A working
Docker Compose setup is expected.

```sh
make deps
make package-deps
make cam-conformance-check
make bike-nft-viewer-gui
```

`make bike-nft-viewer-gui` starts a local Anvil chain, deploys the bike NFT
fixture, serves CAM resources, and prints a local browser URL.

## Useful Checks

```sh
make checks
make package-test
make test
make test-integration-fuzz-bike-nft
make test-integration-fuzz-with-writes-bike-nft
```

## Project Posture

- Frontends are treated as untrusted renderers.
- Contracts remain the authority for business rules.
- CAM resources are validated before use.
- Dependency installation is explicit and separated from offline build/test
  lanes.
