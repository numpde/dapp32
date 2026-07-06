# Architecture Composition Audit

Date: 2026-07-05
Revised: 2026-07-06

Purpose: keep the refactor queue honest after the protocol-fact, ABI
characterization, viewer, and transaction slices. This note is a sequencing
guide, not a second source of truth for behavior.

## Current State

The original broad risks have been reduced:

- CAM document meaning now has small protocol-owned substrates for root,
  namespaces, resource declarations, route invocations, route inputs, route
  expression policy diagnostics, and expression reference occurrence
  collection.
- Runtime and conformance still keep different reporting policies: runtime
  fails fast, conformance accumulates author-facing issues.
- ABI traversal is characterized across runtime inputs, runtime outputs,
  conformance route checks, UI typeflow, and declaration parsing parity. No ABI
  walker should be extracted until new production pressure proves the remaining
  duplication is accidental.
- Viewer session internals are split behind the same public API:
  rendered-interaction checks, write preparation, UI resolution, read-route
  resolution, and route preflight are internal modules.
- Browser transaction execution is outside `App.tsx` behind explicit wallet,
  public-client, receipt, and freshness ports.

Checklist:

- [ ] Re-check this note against current `main` before starting a new slice.
- [ ] Prefer deletion or narrower helpers over expanding an existing substrate.
- [ ] Preserve runtime/conformance reporting differences unless a behavior
  change is explicit.

## Preserved Invariants

Do not weaken these while refactoring:

- Duplicate-key JSON rejection and fatal UTF-8 decoding.
- Inert value validation/cloning at viewer, runtime, and UI boundaries.
- Bounded resource reads before full buffering.
- Byte-exact resource integrity semantics.
- Same-origin HTTP resource loading with redirect refusal.
- Narrow structural EVM client/wallet ports.
- Public package root exports only; package internals stay internal.
- Protocol CAM facts remain provisional and consumed only by `@cam/core` and
  `@cam/conformance`.

Checklist:

- [ ] Add focused regression coverage for any touched invariant.
- [ ] Run the narrowest Docker-backed lane that owns the changed boundary.
- [ ] Keep public APIs stable unless the commit documents the API change.

## Remaining Refactor Pressure

### 1. Viewer Session State Boundary

`session.ts` now mostly owns mutable session state, loading, snapshots, account
rollback, and resource/UI loading. That is the right residual boundary for now.
Further splits should require a concrete state-risk finding, not just file size.

Checklist:

- [ ] Keep account rollback and partial-load failure behavior in session-level
  tests.
- [ ] Do not extract a generic viewer context helper unless read/write/UI phases
  start drifting in behavior.
- [ ] Keep internal viewer modules unexported from `@cam/viewer`.

### 2. Local File Resource Boundary

`js/tools/local-cam-files.ts` owns local CAM file containment, symlink
rejection, file type checks, and size bounds. It is used by publication
preflight, local terminal mocks, integration fuzz options, and shared fixtures.

Checklist:

- [ ] Add direct tests only if a natural tool test lane exists or a bug is found.
- [ ] Keep path containment, realpath containment, symlink rejection, and size
  checks together.
- [ ] Do not let individual tools reimplement manifest-backed local file reads.

### 3. ABI Traversal

The ABI inventory is current and says not to extract a walker. Treat that as a
stop sign until production code changes create a smaller, proven seam.

Checklist:

- [ ] Characterize any new ABI behavior before abstraction.
- [ ] Keep runtime input, runtime output, conformance route checks, and UI
  typeflow value policies separate.
- [ ] Consider only a metadata-only descent helper, and only if it removes real
  current duplication without importing caller policy.

### 4. Compose And Checks Maintenance

Compose hardening is intentionally policed by rendered-config checks where
construction cannot share a safe repo-wide fragment. Checks are now part of the
operator contract; stale allowlists or dead path guards should be trimmed when
found.

Checklist:

- [ ] Prefer parsed/rendered checks over text mirroring when practical.
- [ ] Remove stale check inventories that no longer match current repo shape.
- [ ] Keep Make targets as the supported operator entrypoint.

## Stop Criteria

Stop a refactor when any of these become true:

- The helper must know whether it is runtime, conformance, viewer, app, or
  tooling policy.
- A test starts preserving accidental wording/order rather than a boundary
  invariant.
- The new abstraction has only hypothetical consumers.
- The change adds more fixture scaffolding than behavior it protects.
- A local comment is needed to justify why unrelated concerns live together.
