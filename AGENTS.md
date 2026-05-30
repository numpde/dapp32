# AGENTS.md

Scope: this repository and all subdirectories unless a deeper `AGENTS.md`
overrides.

Audience: coding agents working in this repo.

## Mission

This repository explores contract-defined workflows: contracts publish
structured manifests that can be rendered for humans or interpreted by agents.

Keep the project small, explicit, and protocol-first.

## Branch Posture

- `main` is the clean rebuild branch.
- `poc` preserves the historical proof of concept.
- Do not copy or migrate PoC code into `main` unless explicitly requested.

## Trust Model

- Treat frontends as untrusted renderers.
- Treat contract-returned URLs, manifests, labels, and actions as untrusted
  until validated.
- Prefer contract-anchored manifest integrity, such as URI plus hash or
  content-addressed storage.
- The contract must enforce business rules onchain; the manifest is not an
  authority by itself.
- Avoid arbitrary JavaScript in manifests by default.

## Docker-First Workflow

- Use Docker-backed Make targets for install, test, build, and local dev.
- Do not assume host Node, npm, Hardhat, browser, or Python tooling.
- Keep dependency installation as the explicit networked step.
- Prefer read-only, least-privilege containers for check/test lanes.
- `Makefile` should be the supported operator entrypoint.
- Do not run Docker containers, pull images, or start services until the command
  is properly secured and scoped. Use pinned images, least privilege, explicit
  mounts, bounded resources, and no unnecessary network access.
- Dependency installation lanes must separate network access from repository
  writes. Use a stage/apply shape: the networked stage reads only the minimum
  dependency input files, verifies upstream artifacts against committed lockfile
  checksums, and writes to a staging volume; the offline apply step writes only
  the expected dependency outputs.
- Default dependency installation must not change committed dependency metadata.
  Soldeer lock/remapping/checksum updates require `make deps ALLOW_UPDATE=1`;
  npm workspace lock updates require `make package-deps ALLOW_UPDATE=1`.
- Keep direct npm dependency versions exact. For local workspace package
  references, use the referenced package's exact local version so npm records a
  workspace link in `package-lock.json`. Generated package locks must resolve
  registry packages from `https://registry.npmjs.org/` with integrity metadata.
- Shared npm toolchain dependencies, such as TypeScript, belong in
  `js/package.json`, not repeated in each private workspace package or app.
- Keep npm install policy in `compose/package-deps.yml`; do not add repo
  `.npmrc` files.
- Keep npm workspace execution in `compose/packages.yml`; package/app build and
  test lanes are offline consumers of the locked `node_modules/` tree, mounted
  read-only into a staged tmpfs source workspace. Package-backed tool checks
  with a distinct runtime boundary belong in their own Compose file.
- Use `js/package-lock.json` as the only package lock source for the current JS
  workspace under `js/`; do not add repo-root locks, yarn, pnpm, bun, nested app
  package-lock, or npm-shrinkwrap locks unless the dependency lane is
  deliberately redesigned.
- Do not give networked dependency tools repo-root read/write mounts. In this
  repo, the dapps package owns the expected dependency outputs:
  `dapps/dependencies/`, `dapps/soldeer.lock`,
  `dapps/remappings.txt`, and `dapps/dependency-checksums.txt`. Npm workspace
  dependency materialization owns only `js/node_modules/` and
  `js/package-lock.json`.
- Dependency materialization lanes may pre-create only their guarded host bind
  targets, after rejecting symlinks and wrong-type paths, so Docker never creates
  repository paths implicitly.
- Offline build, test, fuzz, invariant, and coverage lanes must verify installed
  dependency contents before compiling or executing code.
- JS build/test lanes must not create host-side package build directories as
  preflight. JS lanes should mount the host JS workspace read-only, stage only
  source/manifests into container-local tmpfs, mount
  `js/node_modules/` read-only, and leave `dist/` outputs in tmpfs unless
  an explicit artifact export lane is added.
- Local scenario fixtures must not mount the repository root by default. Mount
  only the exact project files/directories the service needs, read-only, and let
  tests assert those rendered mounts.
- Hardcoded private keys are allowed only for local fixture chains when the key
  is obviously non-secret and useless outside that fixture, such as a repeated
  pattern key. Real RPC, live deployment, or operator-controlled lanes must use
  file-backed secrets or another explicit secret boundary instead.
- Workspace package tests must run `tsc -p tsconfig.test.json` before
  `node --test`; strip-types execution is runtime convenience, not semantic
  typechecking.
- `package-build-check` is compile validation only. Do not add `package-build`
  unless there is a deliberate durable artifact-export lane.
- `package-ci` is a Make aggregation over JS workspace tests and package-backed tool
  checks. Do not duplicate a tool's smoke command inside `compose/packages.yml`;
  run the tool's own Compose check service instead.
- ABI export must parse CAM manifests structurally, write a temporary export
  plan outside the repo, then run Forge from that plan. It must keep `dapps/`
  read-only and mount only explicit, pre-existing `dapps/<name>/cam/abi/`
  directories writable.
- CAM ABI files are generated resources whose source of truth is
  `dapps/<name>/cam/main.json`. `contracts.*.abiURI` must point directly to
  `cam/abi/<ContractName>.json`; unused `cam/abi/*.json` files are repository
  hygiene failures.

## Dapp Layout

- First-level dapps live under `dapps/<name>/`.
- Each dapp should use `src/` for Solidity sources and `test/` for Solidity
  tests. Forge lanes discover those directories by convention.
- Soldeer-managed dependency material belongs only under `dapps/dependencies/`.
- A dapp that owns CAM resources and expects ABI export must create
  `dapps/<name>/cam/abi/` deliberately; Docker must not create that path as a
  bind-mount side effect.

## Checks Lane

- Repository/source hygiene checks live in `tests/checks/` as Python
  `unittest` tests using only the standard library.
- Run them with `make checks`. The lane uses `compose/checks.yml` and
  `containers/checks/`: no network, read-only repo mount, read-only root
  filesystem, non-root user, no capabilities, bounded memory/PIDs, and no
  Python bytecode writes.
- `make test` must include `make checks` before Forge unit tests, so routine
  hygiene cannot be skipped accidentally.
- Put text/repo-shape checks here, not in Solidity tests. Examples: compiler
  pragma consistency, forbidden names, secret patterns, Compose posture, and
  dependency metadata consistency.
- Keep brittle text/config mirroring checks under `tests/checks/text/`. They
  are allowed when they protect an important operator or security contract that
  is hard to assert semantically, but they are the first candidates for
  replacement with rendered config, parsed data, or a narrower invariant.
- Keep Solidity tests focused on contract behavior.
- Do not add Python package dependencies to the checks lane unless there is a
  clear, reviewed need. Prefer standard-library parsing for small repository
  invariants.
- Cross-package TypeScript test fixtures live under `tests/fixtures/`, not
  under one package's `test/` tree and not in package exports. Package/test
  Compose lanes may mount this directory read-only when tests need shared
  fixture data.

## Implementation Discipline

- Before coding, stop and identify the actual invariant or requirement.
- Explore the ordinary solution in the current stack before inventing a new
  script, lane, abstraction, directory, or tool.
- Prefer canonical, routine paths over bespoke machinery. For example, checks
  that should always run with tests belong in the normal test path.
- Add a new Make target, Compose service, script, or directory only when it has
  a distinct runtime posture, trust boundary, dependency boundary, or operator
  purpose.
- If a change would expand the repo shape, first ask whether the same outcome
  fits cleanly into an existing file, test suite, or workflow.
- When history is still local and unpushed, prefer a clean rewritten commit
  over follow-up commits that only undo mistakes.

## Change Discipline

- Inspect the tree first with `git status -sb`.
- Make small, focused edits.
- Add or update focused tests/fixtures when behavior changes.
- Run the narrowest relevant Docker-backed check available.
- Do not modify unrelated files.
- Do not revert others' edits unless explicitly requested.
- Do not use destructive git commands unless explicitly requested.
- Never log or commit secrets, tokens, private keys, wallet signatures, or RPC
  credentials.

## Notion Workflow

Use Notion only for task-tracking state. Repository files, tests, docs, and
commits remain the durable source of truth.

- Work one card at a time.
- Move a card to `Doing` before starting implementation.
- Read the card, then inspect the relevant repo context before editing.
- If the card is not safe or well-scoped enough to implement, mark it as a
  decision/blocker and explain why in Notion.
- If implementing, make a focused repo change and run the narrowest relevant
  check.
- Record the commit hash and a short summary in Notion when a commit is made.
- Move completed implementation cards to `In review`.
- When reviewing cards, either mark them `Reviewed`, convert them to a
  decision/blocker, or create a specific follow-up task.
- Before reporting a batch complete, check for remaining `Task` or `Doing`
  cards and mention any that remain.
