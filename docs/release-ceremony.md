# Release ceremony mechanics

The Escrow and Bike NFT release lanes share one host ceremony. Application commands, authority policy, deployment artifacts, handoffs, verification claims, and live smoke tests remain in each dapp README.

Run a release only from the exact clean commit selected for publication. The targets reject visible tracked or untracked changes, resolve one commit, and export that commit with `git archive` into a private temporary directory. Dependency verification, release checks, compilation, planning, signing, and artifact materialization all use that snapshot rather than the working tree.

The snapshot includes copies of the installed Solidity and npm dependency trees. The lanes verify those trees against the archived repository metadata before use. The npm check proves the lockfile and package graph, not an independent checksum for every installed file byte; the ceremony therefore does not claim reproducible dependency-byte provenance.

RPC URLs and deployment keys are absolute, readable regular files whose path components must not be symlinks. Credential files must not be group- or world-accessible. Verification uses an RPC file but receives no deployment key.

Deployment requires a normalized new output directory outside the repository. The target rechecks its parent before creating the directory with mode `0700`, then creates three phase-specific subdirectories:

```text
plan/
broadcast/
artifact/
```

The offline planner writes only `plan/`. The signer reads the plan, recomputes the exact mounted CAM-root hash, holds the only deployment key, reaches the only RPC proxy admitting `eth_sendRawTransaction`, and writes only `broadcast/`. The materializer reads the plan and broadcast through a distinct read-only RPC path and writes only `artifact/`. Release files use staged, synced, no-clobber publication.

Each invocation derives private Compose project identities from its temporary ceremony directory. Cleanup addresses only those identities. Successful teardown removes the snapshot; incomplete teardown retains it and reports its path for inspection. Docker daemon and context selection remain operator-owned, so the project identity does not isolate unrelated users of the same daemon.

Deployment is one-shot. A failure after transaction submission preserves the output directory and temporary evidence when cleanup cannot complete. Inspect the plan, Forge broadcast, and partial artifact state before authorizing any further transaction; the repository provides no automatic recovery, retry, or redeployment target.

Verification first opens the app deployment artifact through one bounded, non-symlink descriptor, strictly parses it, checks the selected source commit and checked-in CAM bytes, and publishes one canonical JSON snapshot into a container volume without overwriting an existing destination. Receipt provenance and the Solidity verifier consume only that read-only snapshot. They cannot remount the external artifact. Verification receives no signing key, exposes no transaction-submission RPC method, and does not use `--broadcast`.
