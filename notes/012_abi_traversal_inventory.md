# ABI Traversal Inventory

Date: 2026-07-06

Purpose: inventory ABI-shaped value traversal before extracting anything.
The current code has repeated traversal skeletons, but the callers have
different jobs. Do not introduce a shared ABI walker until the direction-specific
rules below are pinned by tests and the remaining duplication is demonstrably
accidental.

## Traversal Owners

Runtime EVM input normalization:

- Owner: `js/packages/cam-evm-viem/src/arguments.ts`
- Entry points: `normalizeAbiArgs`, `normalizeAbiArg`
- Job: turn inert CAM named args into positional viem call args.
- Traverses: ABI input metadata plus already-resolved inert values.
- Reporting: fail-fast `CamEvmError` with route/write-specific error code.

Runtime EVM output normalization:

- Owner: `js/packages/cam-evm-viem/src/routes.ts`
- Entry points: `normalizeRouteValues`, `normalizeAbiValue`
- Job: turn viem decoded outputs into inert CAM values.
- Traverses: ABI output metadata plus concrete decoded RPC values.
- Reporting: fail-fast `CAM_ROUTE_INVALID_RESULT`.

Conformance route ABI compatibility:

- Owner: `js/packages/cam-conformance/src/abi/routes.ts`
- Entry points: `validateRouteArgs`, `abiArgValueMismatches`,
  `validateRouteOutputRefs`, `abiOutputAtSegments`
- Job: reject deterministic publication mismatches while skipping unknown
  runtime expressions.
- Traverses: ABI input/output metadata plus manifest literals and statically
  classified expressions.
- Reporting: accumulated `CAM_ROUTE_ABI_MISMATCH` and `CAM_ABI_INVALID`.

Conformance UI typeflow:

- Owner: `js/packages/cam-conformance/src/ui/typeflow.ts`
- Entry points: `knownValueShape`, `valueAtSegments`, `abiValueMatches`
- Job: propagate ABI-known and literal shapes through UI nodes, Includes, and
  Buttons without evaluating runtime state.
- Traverses: typeflow-local shape records, some ABI output metadata, and UI
  literals. It is adjacent to ABI traversal, not a general ABI walker.
- Reporting: accumulated UI typeflow/handoff/prop issues.

## Supported ABI Surface

Shared CAM route scalar grammar:

- `string`
- `address`
- `bool`
- signed and unsigned ABI integers accepted by `parseAbiIntegerType`
- `bytes`
- fixed bytes accepted by `parseAbiFixedBytesLength`

Shared CAM route aggregate grammar:

- Dynamic arrays via `abiDynamicArrayElementType`
- Tuples with declared `components`
- Nested dynamic arrays and nested tuples, subject to each caller's value-shape
  policy

Shared ABI declaration exclusions:

- Fixed-size arrays are rejected by runtime ABI parsing and conformance ABI
  parsing. UI typeflow may still see a malformed ABI-backed shape indirectly,
  but it should not make unsupported declarations acceptable.
- Tuple arrays require tuple `components`.
- Function inputs used by CAM routes must be named and unique.
- Tuple components used by CAM routes must be named and unique. Top-level
  function outputs may remain unnamed because CAM references them by numeric
  output index.
- Function names, signatures, mutability, and supported scalar types are
  protocol-owned helpers, but not a single shared traversal API yet.

Declaration parsing is a separate concern from value traversal:

- `@cam/evm-viem` parses ABIs before runtime execution and throws fail-fast
  runtime errors.
- `@cam/conformance` parses ABI resources for publication diagnostics and
  accumulates issues.
- Both use protocol syntax helpers, but their public error surfaces and
  ordering are intentionally different. Do not hide that behind a traversal
  kernel.

## Intentional Differences

Runtime input normalization is stricter than conformance route checks:

- It requires every named argument exactly, orders args by ABI, and rejects
  missing/unexpected names before a call.
- It rejects unknown expressions because `@cam/core` has already resolved route
  values to inert data by the time EVM calls are prepared.
- It normalizes integers to `bigint` for viem.
- It lowercases addresses.
- It requires tuple args as records keyed by component name.

Runtime output normalization accepts decoded shapes that authoring-time checks
do not accept as CAM-authored values:

- It accepts tuple outputs as either records keyed by component name or arrays
  indexed by ABI component order, because viem/RPC decoded tuple shape can vary.
- It accepts ABI integer outputs as `bigint` and safe JS `number`, then exposes
  one inert string representation.
- It lowercases address outputs.
- It recursively returns inert arrays and records.

Conformance route ABI compatibility is deliberately conservative:

- It checks only deterministic literal and statically classified expression
  values.
- Unknown expressions are skipped rather than rejected.
- `$account.address` and `$host.address` are statically classified as address;
  `$host.chainId` is statically classified as string.
- Literal strings may satisfy `string`, `address`, `bytes`, fixed bytes, and
  integer ABI inputs only when the literal grammar matches the ABI type.
- Tuple and array literal mismatches are reported recursively when known.
- Output reference validation checks that `$outputs.<index>...` can be followed
  through ABI outputs, arrays, and tuple fields, but it does not normalize
  concrete decoded values.

UI typeflow is not an ABI call normalizer:

- It preserves known ABI-backed shapes and literal shapes so UI props, dynamic
  selectors, Include args, and Button args can be checked.
- It represents unknown dynamic values explicitly and keeps partially known
  arrays/tuples useful.
- Literal arrays of strings get a special `literal-string[]` shape because UI
  selector lists need that distinction.
- It uses `abiOutputAtSegments` for ABI-backed output field lookup, but it also
  tracks local UI state, rendered inputs, handoffs, and route-local context.

## Shared Traversal Rules

These are the real shared candidates, but they are not yet a proven extraction.
Each caller still owns value admissibility, unknown handling, and reporting:

- Dynamic arrays recurse into an element ABI parameter.
- Tuples recurse into named components.
- Tuple component names must be unique and non-empty where CAM addresses them
  by name.
- Fixed-size arrays are unsupported.
- Integer and fixed-bytes parser failures should be reported at the concrete
  path being traversed.
- Path construction uses dot segments for array indexes and tuple component
  names.

Candidate extraction seam:

- A metadata-only descent helper could walk ABI parameter metadata and report
  callbacks for scalar, dynamic array, tuple, unsupported fixed array, and tuple
  component name problems.
- A value-aware helper is riskier. Runtime input normalization, runtime output
  normalization, route conformance, and UI typeflow disagree intentionally about
  concrete value shapes, unknowns, tuple array decoding, and literal strings.

## Likely Accidental Differences

These deserve characterization before any abstraction:

- Runtime output tuple traversal accepts array-like tuple values, while runtime
  input and conformance route literal traversal require object-like tuples.
  This is intentional unless a future runtime output decoder guarantees record
  tuples only; decoded output shape differs from CAM-authored input shape.
- Conformance route argument checks use `abiScalarKind`; runtime input/output
  normalization separately calls `parseAbiIntegerType`,
  `parseAbiFixedBytesLength`, `isAbiBytesValue`, and `isAbiIntegerValue`.
  The accepted scalar grammar should stay identical.
- Conformance route output reference traversal and UI typeflow both use
  `abiOutputAtSegments`, while runtime output normalization has its own concrete
  value traversal. That split is probably correct: one walks ABI metadata, the
  other walks decoded values.
- UI typeflow's `literal-string[]` and partially known aggregate shapes do not
  have runtime equivalents. Do not force them into an EVM normalizer.
- Runtime ABI parsing and conformance ABI parsing validate similar declaration
  grammar but not through the same code path. Before merging them, pin whether
  issue ordering and path wording are part of conformance's public authoring
  surface.

## Characterization Status

Already covered by existing tests:

- Runtime rejects unsupported ABI declarations, fixed-size arrays, invalid tuple
  components, invalid dynamic bytes, non-canonical integer output shapes, tuple
  output record/array shape errors, and single dynamic-array output handling.
- Runtime preserves tuple input component names as inert data.
- Runtime normalizes nested dynamic arrays of tuple inputs and rejects nested
  tuple scalar range failures.
- Runtime normalizes nested dynamic arrays of tuple outputs from both
  record-like and array-like decoded tuple shapes, and rejects malformed nested
  tuple output shapes.
- Conformance reports ABI resource shape failures, route argument scalar
  mismatches, recursive tuple/array literal mismatches, output-index and
  output-field reference failures, and partially known write-continuation
  aggregate failures.
- Conformance skips unknown route expressions inside otherwise known arrays and
  tuples while still reporting deterministic sibling scalar and tuple shape
  mismatches.
- UI typeflow checks ABI-backed prop incompatibility, route handoff literals,
  direct aggregate args, direct array args, selector lists, and literal field
  name preservation.
- UI typeflow skips unknown state-backed aggregate leaves while still reporting
  deterministic sibling scalar, tuple-shape, and missing known route-value
  errors.

Missing or weak characterization before extraction:

- ABI declaration parsing parity between `@cam/evm-viem` and `@cam/conformance`
  should be characterized before moving declaration walkers. They currently
  share protocol helpers but report through different public facades.

## Recommendation

Do not extract an ABI traversal helper yet.

First add characterization tests around the missing cases above. If those tests
show the same recursion skeleton with only direction-specific hooks, the next
abstraction should be a tiny internal traversal kernel over ABI metadata with
caller-supplied callbacks for scalar, tuple, array, unknown, and reporting
policy. It should not own viem value normalization, conformance issue mapping,
UI typeflow unknown-value semantics, or ABI declaration parsing unless those
declaration rules are characterized separately.

Stop criteria for a future extraction:

- Stop if the helper needs to know whether it is preparing a write, normalizing
  a read result, proving a route argument, or proving UI typeflow.
- Stop if unknown expression handling appears in the shared layer.
- Stop if UI typeflow's `literal-string[]` or partial aggregate records leak
  into EVM runtime code.
- Stop if runtime decoded tuple-array acceptance is applied to CAM-authored
  input values.
