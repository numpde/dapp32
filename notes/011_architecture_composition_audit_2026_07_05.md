# Architecture Composition Audit

Date: 2026-07-05

This note records the architectural refactors that still look valid after review.
It deliberately drops broad package-split and checklist sprawl. The repo is not
sloppy; it is security-minded and already has strong Docker, dependency, JSON,
resource, integrity, and conformance posture. The remaining risk is narrower:
the same CAM semantics are interpreted in multiple places for different
purposes.

Treat this as a sequencing note, not as proof that any item is a bug.

## Preserve

Do not weaken these invariants while refactoring:

- Duplicate-key JSON rejection and fatal UTF-8 decoding.
- Inert value validation/cloning at object boundaries.
- Bounded resource reads before full buffering.
- Byte-exact resource integrity semantics.
- Same-origin HTTP resource loading with redirect refusal.
- Narrow structural EVM client/wallet ports.
- Current public package APIs unless a versioning decision is explicit.

## Core Problem

Runtime parsing, conformance diagnostics, UI resolution, EVM call preparation,
viewer orchestration, and the React app each understand overlapping parts of the
CAM model. The long-term failure mode is semantic drift: two layers accept or
diagnose the same CAM document differently.

The right direction is not an immediate package split. The right direction is to
extract small shared facts where duplication is already real, prove parity with
tests, and keep the public facades stable.

## Necessary Refactors

### 1. Add Expression Reference Facts

Expression parsing is already centralized, but consumers still recurse through
raw inert values to answer questions such as "does this route require account?"
or "which roots does this UI expression reference?"

Add a small protocol-level reference collector:

```ts
type ExpressionReference = {
  readonly root: string
  readonly segments: readonly string[]
  readonly path: string
}
```

Required behavior:

- Walk strings, arrays, and records.
- Treat escaped `$$...` strings as literals.
- Report or preserve invalid expression syntax without throwing accidental
  traversal exceptions.
- Support the same numeric-segment policy as existing expression parsing.

Use it first in the smallest high-value places:

- Route account requirement detection in `@cam/core`.
- Conformance expression-root/input/output checks.

This is the best first refactor because it proves the shared-fact model without
rewriting the conformance pipeline.

### 2. Add Runtime/Conformance Parity Tests Before Shared Builders

`@cam/conformance` intentionally accumulates issues while runtime parsers fail
fast. That difference is legitimate. Drift is not.

Before extracting larger fact builders, add fixtures that pin where runtime and
conformance should agree on structural acceptance or rejection:

- Unknown CAM root field.
- Unknown namespace type.
- Invalid route continuation namespace.
- Missing or malformed UI node requirements.
- Unsupported UI prop shape.
- Invalid expression root.
- Invalid ABI function reference or unsupported ABI type.

The test should not require identical error wording. It should prove that the
layers agree on the document meaning, while allowing conformance to add stricter
publication rules when those are documented.

### 3. Extract Shared Fact Builders Only Where Parity Tests Expose Real Drift Risk

Do not build a general fact engine upfront. Extract fact builders one semantic
area at a time, only after the parity tests make the target behavior clear.

Good candidates:

- CAM root and namespace facts.
- Route invocation facts.
- UI document and node facts.
- ABI function facts.

Keep two facades:

- Runtime APIs remain fail-fast and return parsed runtime documents.
- Conformance remains accumulated and returns `CamConformanceIssue[]`.

The shared layer should own facts, not public diagnostics. Each facade can map
facts to its existing error/issue model.

### 4. Split Viewer Session Internals Behind the Existing API

`createCamViewerSession` is the main orchestration pressure point. It loads CAM,
resolves contracts, loads UI, tracks account/view/state, navigates routes,
prepares writes, rejects fabricated rendered actions, and snapshots state.

Keep the public session API stable. Extract pure internals first:

- `ViewResolver`: route outputs + UI document + state -> resolved UI.
- `ActionInterpreter`: rendered button -> navigation or prepared write.
- Snapshot/state helpers that remain inert and clone-safe.

Do not move network, wallet, or React concerns into these pure pieces. The goal
is lower risk and better tests, not a new framework.

Required tests before/with extraction:

- Fabricated or stale action rejection.
- State update rejection for non-rendered fields.
- Account-required route/UI behavior.
- Read navigation separate from write preparation.
- Snapshot isolation.

### 5. Move Transaction Execution Out Of `App.tsx`

The React app currently owns too much transaction lifecycle: wallet connection,
chain/account checks, simulation, send, receipt wait, timeout/nonce diagnosis,
and post-write navigation. That makes terminal or agent hosts harder to share
with and makes transaction behavior hard to test without React.

Extract a small executor with explicit ports:

```ts
type PreparedCallExecutorPorts = {
  readonly publicClient: unknown
  readonly wallet: WalletPort
  readonly waitForReceipt: ReceiptWaiter
}
```

The exact type shape should follow existing viem-facing code. The important
boundary is that React becomes state binding and message rendering, while the
transaction lifecycle is unit-testable without a component.

Preserve:

- Account revalidation before send.
- Chain revalidation after switch/add-chain.
- Simulation-before-send.
- Receipt timeout diagnostics.
- Nonce-gap diagnosis.
- Stale interaction/send revision checks, or replace them with an explicit
  state-machine equivalent.

### 6. Consider An ABI Walker Only After Inventory

Input normalization, output normalization, and conformance ABI checks all walk
ABI-shaped values. A shared walker may be right, but it can easily become a
generic abstraction that obscures direction-specific policy.

Before building it, inventory the actual duplicated rules:

- Supported scalar types.
- Integer bounds.
- Fixed bytes and dynamic bytes.
- Tuple component naming.
- Dynamic arrays.
- Fixed-array rejection.
- Unsupported ABI shapes.

If the inventory shows real drift risk, introduce a small walker with
direction-specific callbacks. If the duplication is clearer than the abstraction
would be, leave it alone and add parity tests instead.

## Deferred Or Rejected

### Package Splitting

Do not split `@cam/protocol` into many packages now. The current dependency
direction is good, and package splits would add versioning, lockfile, and
operator-lane overhead before the semantics are stable.

If organization becomes painful, split source folders and add import-boundary
checks first. Keep one public package until there is a concrete consumer or
versioning reason to split.

### UI Descriptor Registry

A descriptor registry may become useful when adding more UI elements, but it is
not necessary now. The current UI vocabulary is closed-world by design. Do not
introduce a registry until a real element addition or bug demonstrates that the
current switches are causing drift.

### Makefile Modularization

The Makefile is large, but it is guarded and tested. Modularizing it is lower
priority than semantic alignment across CAM runtime/conformance/viewer code.
Only split it when edits become clearly unsafe, and preserve target names and
guard checks exactly.

### Global Diagnostic Model

Do not introduce a universal diagnostic type yet. Preserve path/resource/code
metadata through wrapping where needed, but avoid a cross-package diagnostic
framework until repeated wrapping bugs prove it necessary.

### Branded Types Everywhere

Branding can help for route names, namespace names, resource URIs, chain IDs,
and addresses after validation. It can also make the code noisy. Add branded
types only where a real cross-boundary mix-up exists or a fact-builder output
needs stronger documentation.

## Recommended Order

1. Add expression reference collection and migrate the obvious recursive scans.
2. Add runtime/conformance parity fixtures around structural CAM meaning.
3. Extract one small shared fact builder where the parity tests justify it.
4. Split pure viewer session internals behind the existing API.
5. Extract transaction execution from `App.tsx`.
6. Reassess ABI traversal after inventory.

Each step should be small, behavior-preserving unless explicitly stated, and
covered by the narrowest relevant Docker-backed check. Broad rewrites, package
splits, and new frameworks are not justified by this audit.
