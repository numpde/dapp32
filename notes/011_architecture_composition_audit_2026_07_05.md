# Architecture Composition Audit

Date: 2026-07-05

This note records the architectural refactors that still look valid after
review. The repo is security-minded and already has strong Docker, dependency,
JSON, resource, integrity, and conformance posture. The remaining risk is
narrower: the same CAM semantics are interpreted in multiple places for
different purposes.

Treat this as a sequencing note for future work.

Checklist:

- [ ] Re-check this note against current `main` before starting work.
- [ ] Identify whether each change is behavior-preserving or intentionally
  behavior-changing.
- [ ] Run the narrowest Docker-backed check for every change.

## Preserve

Keep these invariants intact while refactoring:

- Duplicate-key JSON rejection and fatal UTF-8 decoding.
- Inert value validation/cloning at object boundaries.
- Bounded resource reads before full buffering.
- Byte-exact resource integrity semantics.
- Same-origin HTTP resource loading with redirect refusal.
- Narrow structural EVM client/wallet ports.
- Current public package APIs, with an explicit versioning decision for changes.

Checklist:

- [ ] Add or keep regression coverage for any invariant touched by a refactor.
- [ ] Preserve byte-exact resource and integrity behavior.
- [ ] Preserve public APIs or document the explicit API change.

## Core Problem

Runtime parsing, conformance diagnostics, UI resolution, EVM call preparation,
viewer orchestration, and the React app each understand overlapping parts of the
CAM model. The long-term failure mode is semantic drift: two layers accept or
diagnose the same CAM document differently.

The right direction is to extract small shared facts where duplication is
already real, prove parity with tests, and keep the public facades stable.

Checklist:

- [ ] Prefer shared facts over duplicated semantic walkers.
- [ ] Keep runtime fail-fast behavior and conformance accumulation distinct.
- [ ] Keep internal facts and parity tests ahead of package-boundary changes.

## Necessary Refactors

### 1. Add Expression Reference Facts

Expression parsing and the `ExpressionReference` type are already centralized in
`@cam/protocol`. The missing piece is a path-preserving collector. Consumers
still recurse through raw inert values to answer questions such as "does this
route require account?" or "which roots does this UI expression reference?"

Add a small protocol-level collection API around the existing parser. Each
occurrence should carry the source path, raw string value, parsed reference when
valid, and syntax detail when invalid.

Required behavior:

- Walk strings, arrays, and records.
- Treat escaped `$$...` strings as literals.
- Preserve invalid `$...` syntax as a finding instead of a traversal exception.
- Support the same numeric-segment policy as existing expression parsing.
- Reuse `parseExpressionReference` and `expressionReferenceSyntaxError` as the
  sole expression grammar.

Use it first in the smallest high-value places:

- Route account requirement detection in `@cam/core`.
- Conformance expression-root/input/output checks.

This is the best first refactor because it proves the shared-fact model without
rewriting the conformance pipeline.

Checklist:

- [ ] Implement path-preserving reference collection in `@cam/protocol`.
- [ ] Cover escaped dollars, invalid syntax, arrays, records, and numeric
  segment policy.
- [ ] Replace route account requirement scanning in `@cam/core`.
- [ ] Replace at least one conformance expression-root walker.
- [ ] Keep layer-specific error and issue codes.

### 2. Add Runtime/Conformance Parity Tests Before Shared Builders

`@cam/conformance` intentionally accumulates issues while runtime parsers fail
fast. That difference is legitimate. Drift is not.

Before extracting a fact builder, add fixtures for the semantic area being
changed. Use this risk list to pick the cases where runtime and conformance
should agree on structural acceptance or rejection:

- Unknown CAM root field.
- Unknown namespace type.
- Invalid route continuation namespace.
- Missing or malformed UI node requirements.
- Unsupported UI prop shape.
- Invalid expression root.
- Invalid ABI function reference or unsupported ABI type.

The test should compare document meaning and allow wording to differ.
Conformance-only publication rules need explicit labels in the fixture
expectations.

Checklist:

- [ ] Add fixtures for the disagreement risks touched by the next extraction.
- [ ] Assert agreement on accept/reject meaning while allowing wording to differ.
- [ ] Mark stricter conformance-only publication rules explicitly.
- [ ] Run package tests before extracting shared builders.

### 3. Extract Shared Fact Builders Where Parity Tests Pin Drift Risk

Extract fact builders one semantic area at a time, after parity tests make the
target behavior clear.

Likely candidates, in order:

- Expression reference occurrences.
- Route invocation facts.
- UI document and node facts.
- CAM root and namespace facts.
- ABI function facts.

Keep two facades:

- Runtime APIs remain fail-fast and return parsed runtime documents.
- Conformance remains accumulated and returns `CamConformanceIssue[]`.

The shared layer should own facts instead of public diagnostics. Each facade can
map facts to its existing error/issue model.

Checklist:

- [ ] Pick one semantic area with proven duplication.
- [ ] Add characterization tests before moving logic.
- [ ] Keep runtime and conformance public facades unchanged.
- [ ] Preserve issue ordering if current tests or callers depend on it.
- [ ] Document any intentional diagnostic differences.

### 4. Split Viewer Session Internals Behind the Existing API

`createCamViewerSession` is the main orchestration pressure point. It loads CAM,
resolves contracts, loads UI, tracks account/view/state, navigates routes,
prepares writes, rejects fabricated rendered actions, and snapshots state.

Keep the public session API stable. Extract pure internals first:

- `ViewResolver`: loaded CAM/UI facts + route outputs + state -> resolved UI.
- `ActionInterpreter`: loaded facts + rendered button -> navigation request or
  prepared write descriptor.
- Snapshot/state helpers that remain inert and clone-safe.

Keep network, wallet, and React concerns outside these pure pieces. The goal is
lower risk and better tests.

Required tests before/with extraction:

- Fabricated or stale action rejection.
- State update rejection for non-rendered fields.
- Account-required route/UI behavior.
- Read navigation separate from write preparation.
- Snapshot isolation.

Checklist:

- [ ] Extract pure helpers before changing the session facade.
- [ ] Keep network/resource loading out of pure view/action helpers.
- [ ] Keep snapshot cloning and inert boundaries intact.
- [ ] Add stale/fabricated action and state-field rejection tests.
- [ ] Run `make package-test`.

### 5. Move Transaction Execution Out Of `App.tsx`

The React app currently owns too much transaction lifecycle: wallet connection,
chain/account checks, simulation, send, receipt wait, timeout/nonce diagnosis,
and post-write navigation. That makes terminal or agent hosts harder to share
with and makes transaction behavior hard to test without React.

Extract a small executor with explicit capability-shaped ports for simulation,
chain/account checks, send, transaction lookup, pending nonce lookup, receipt
waiting, and timeout control. The important boundary is that React becomes state
binding and message rendering, while the transaction lifecycle is unit-testable
without a component.

Preserve:

- Account revalidation before send.
- Chain revalidation after switch/add-chain.
- Simulation-before-send.
- Receipt timeout diagnostics.
- Nonce-gap diagnosis.
- Stale interaction/send revision checks, or replace them with an explicit
  state-machine equivalent.

Checklist:

- [ ] Define narrow simulation, public-client, wallet, receipt, and timing ports.
- [ ] Move simulation/send/receipt/diagnosis logic out of React.
- [ ] Keep wallet browser specifics in an adapter.
- [ ] Unit-test transaction lifecycle without React.
- [ ] Keep app tests focused on UI wiring and messages.

### 6. Inventory ABI Traversal Policy

Input normalization, output normalization, and conformance ABI checks all walk
ABI-shaped values. They already share useful protocol helpers for scalar types,
integer bounds, bytes, fixed arrays, dynamic arrays, signatures, and parameter
names. The remaining work is to inventory the traversal differences before
extracting another abstraction.

Inventory the actual duplicated rules:

- Supported scalar types.
- Integer bounds.
- Fixed bytes and dynamic bytes.
- Tuple component naming.
- Dynamic arrays.
- Fixed-array rejection.
- Unsupported ABI shapes.

If the inventory shows real drift risk, introduce a small walker with
direction-specific callbacks and keep the direction-specific policy explicit.

Checklist:

- [ ] Inventory runtime input, runtime output, and conformance ABI policies.
- [ ] Separate intentional direction-specific differences from drift.
- [ ] Add parity tests for shared unsupported-type decisions.
- [ ] Extract a walker only for duplicated traversal policy proven by the
  inventory.
- [ ] Keep input, output, and conformance callbacks explicit.

## Recommended Order

1. Add expression reference collection and migrate the obvious recursive scans.
2. Add runtime/conformance parity fixtures around structural CAM meaning.
3. Extract one small shared fact builder where the parity tests justify it.
4. Split pure viewer session internals behind the existing API.
5. Extract transaction execution from `App.tsx`.
6. Inventory ABI traversal and extract only proven shared traversal policy.

Each step should be small, state whether behavior is preserved or intentionally
changed, and be covered by the narrowest relevant Docker-backed check.

Checklist:

- [ ] Complete steps in order; jump ahead only for a concrete bug.
- [ ] Keep each PR/commit on one axis.
- [ ] Record which checks were run with each change.
