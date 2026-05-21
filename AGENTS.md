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
  dependency input files and writes to a staging volume; the offline apply step
  writes only the expected dependency outputs.
- Do not give networked dependency tools repo-root read/write mounts. In this
  repo, the expected dependency outputs are `dependencies/`, `soldeer.lock`,
  `remappings.txt`, and `dependency-checksums.txt`.
- Offline build, test, fuzz, invariant, and coverage lanes must verify installed
  dependency contents before compiling.

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
