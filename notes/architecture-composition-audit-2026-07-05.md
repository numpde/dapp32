# Architecture and Composition Audit

Date: 2026-07-05

This note records a static architecture audit of the current `numpde/dapp32` repository, with emphasis on large-scale design and composition smells. It is intentionally critical: the goal is to identify the places where semantic drift, coordination cost, and package-boundary erosion are most likely as CAM grows.

The repo's stated direction is compelling: contracts publish hash-pinned, conformance-checked CAM bundles that generic viewers, wallets, and agents can render or interpret without trusting bespoke frontend JavaScript. That objective puts unusual pressure on semantic consistency across protocol, conformance, runtime, viewer, app, and tooling layers.

## Scope and confidence

This was a static repository audit. I inspected the TypeScript package layout, CAM protocol/core/screen/EVM/viewer/app composition, conformance pipeline, resource/integrity handling, and Makefile-driven tooling. I did not run the Docker, Foundry, npm, or integration-fuzz lanes locally as part of this pass.

Overall judgment: the repo has strong validation and security instincts, but the largest scale risk is semantic duplication across packages plus several central orchestrator modules that will become change bottlenecks.

### Revision checklist

- [ ] Run the full local verification surface before converting any finding into a blocking issue:
  - [ ] `make package-ci`
  - [ ] `make cam-conformance-check`
  - [ ] `make test`
  - [ ] `make fuzz`
  - [ ] `make invariant`
  - [ ] The relevant integration-fuzz lane for any touched fixture.
- [ ] Confirm whether the audit still applies to the current `main` branch before starting work.
- [ ] For every refactor proposed here, identify whether it changes public package exports, internal source layout only, or protocol-visible behavior.
- [ ] Do not weaken the existing security posture while reducing duplication:
  - [ ] Duplicate-key JSON rejection remains enforced.
  - [ ] Fatal UTF-8 decoding remains enforced for byte-addressed documents.
  - [ ] Inert value cloning/validation remains the object-boundary default.
  - [ ] Resource size caps remain enforced before full buffering where applicable.
  - [ ] Resource integrity semantics remain byte-exact.
- [ ] Treat this note as architectural guidance, not as proof of bugs. Open focused issues or PRs for concrete changes.
- [ ] Revisit this note after any CAM schema, UI element, resource URI, ABI type, or viewer transaction-flow expansion.

## What is working well

The security posture is much stronger than typical early dapp tooling. The JSON layer rejects duplicate object keys before parsing, decodes UTF-8 fatally, and checks sparse arrays. Inert values are deeply validated and cloned to reject host objects, cycles, prototypes, functions, and hidden mutability. Resource loading is bounded and same-origin/redirect-conscious. Integrity checking is explicit and shared across relevant layers.

The package graph is also directionally sensible. `@cam/protocol` is dependency-free. `@cam/core` and `@cam/screen` sit above it. `@cam/evm-viem` adapts core/protocol to viem. `@cam/viewer` composes runtime pieces. `cam-web` is the React app.

The EVM adapter deliberately defines narrow structural client surfaces instead of exposing viem's full client types. That is a good boundary: mocks and non-viem consumers can satisfy CAM ports without inheriting viem's entire generic/overloaded surface.

### Revision checklist

- [ ] Preserve the existing validation posture as non-negotiable invariants.
- [ ] Add explicit regression tests for each important security invariant before major refactors:
  - [ ] Duplicate JSON keys are rejected.
  - [ ] Invalid UTF-8 is rejected.
  - [ ] Sparse arrays are rejected where JSON arrays are expected.
  - [ ] Cyclic values are rejected by inert-value conversion.
  - [ ] Prototype-bearing objects are rejected where protocol records are expected.
  - [ ] Oversized resources fail before downstream parsing.
  - [ ] Integrity mismatch diagnostics remain stable.
  - [ ] Redirecting HTTP resource loads remain rejected where the same-origin loader is used.
- [ ] Keep the EVM adapter's structural public-client/wallet-client ports narrow.
- [ ] Avoid importing broad viem client types into packages that only need small CAM-specific capabilities.
- [ ] Keep `cam-web` rendering concerns separate from protocol semantics wherever possible.
- [ ] When splitting packages or modules, keep the current good dependency direction unless there is an explicit design decision to change it.

## Priority design smells

## 1. `@cam/protocol` is becoming a semantic commons/kernel, not just protocol vocabulary

`@cam/protocol` currently exports ABI typing utilities, expression parsing/evaluation, inert-value cloning, JSON parsing/guards, HTTP/resource loading policy, URI resolution, manifest constants, namespace constants, UI constants, and UI prop schemas from one barrel.

That gives one source of truth, which is useful in the short term. At scale, it becomes a reverse-dependency trap: everything depends on `@cam/protocol`, so unrelated concerns become hard to evolve independently. HTTP response streaming and same-origin loading live beside manifest namespace rules; IPFS CID validation lives beside UI prop schemas; EVM ABI scalar validation lives beside generic expression syntax.

The smell is not that shared vocabulary exists. The smell is that the package is accumulating multiple semantic domains with different change rates and different consumers.

### Refactor direction

Split protocol vocabulary from protocol-adjacent utilities. A cleaner long-term layering would be:

- `@cam/schema` or `@cam/protocol-model`: versions, manifest vocabulary, namespace names, route/UI vocabulary.
- `@cam/json`: duplicate-key-safe JSON and guard helpers.
- `@cam/inert`: inert value model and clone/validation.
- `@cam/expressions`: expression grammar, AST/reference collection, resolver.
- `@cam/resources`: URI policy, integrity, bounded HTTP resource reading.
- `@cam/abi`: EVM ABI type/value policy.

This does not require a large public API change immediately. An internal source split plus import-boundary checks would already reduce coupling.

### Revision checklist

- [ ] Inventory every export from `js/packages/cam-protocol/src/index.ts` and classify it into one semantic domain:
  - [ ] Schema/vocabulary.
  - [ ] JSON parsing/guarding.
  - [ ] Inert value handling.
  - [ ] Expressions.
  - [ ] Resources/URI/integrity/HTTP.
  - [ ] ABI typing/value policy.
  - [ ] UI vocabulary/schema.
- [ ] For each export, record its consumers:
  - [ ] `@cam/core`
  - [ ] `@cam/screen`
  - [ ] `@cam/evm-viem`
  - [ ] `@cam/conformance`
  - [ ] `@cam/viewer`
  - [ ] `cam-web`
  - [ ] tests/tools.
- [ ] Identify exports that are used by only one higher-level package and consider moving them closer to that package.
- [ ] Identify exports that are true cross-cutting protocol facts and keep them in the shared model layer.
- [ ] Add import-boundary rules or a package graph check so lower layers cannot import higher-layer concepts accidentally.
- [ ] Preserve public API compatibility until a deliberate package-versioning decision is made.
- [ ] If package splits are too large for one PR, first split source folders inside `@cam/protocol` and update internal imports to target submodules.
- [ ] Add an architecture decision record documenting what belongs in the protocol model package and what does not.

## 2. `@cam/conformance` duplicates runtime parser semantics instead of reusing shared fact builders

`@cam/conformance` depends only on `@cam/protocol`, not on `@cam/core`, `@cam/screen`, or `@cam/evm-viem`. That avoids runtime dependencies but creates a semantic fork. The conformance pipeline reimplements manifest root validation, namespace validation, route validation, UI raw parsing, UI node interfaces, ABI parsing, route/ABI compatibility, UI typeflow, expression-root checks, and resource declaration/integrity checks.

Runtime parsers throw typed errors. Conformance accumulates structured issues. That explains the duplication, but it does not remove the drift risk. `@cam/core` and conformance both validate route shapes, route kinds, invocation namespace types, inputs, and expression payloads. `@cam/screen` and conformance both interpret UI document/node/call semantics.

### Refactor direction

Extract shared diagnostic fact builders. Instead of runtime parsers throwing from one implementation and conformance re-parsing from another, create a lower-level layer that produces facts with provenance:

- `RootFact`
- `NamespaceFact`
- `ResourceFact`
- `RouteFact`
- `UiDocumentFact`
- `UiNodeFact`
- `AbiFunctionFact`
- `ExpressionFact`

Then expose two facades:

- `parseCam(input): CamDocument` for runtime, fail-fast.
- `validateCamBundle(bundle): CamConformanceIssue[]` for conformance, accumulate.

Both facades should consume the same fact builders. They can differ in error policy without differing in semantic interpretation.

### Revision checklist

- [ ] Make a table of duplicated semantic checks between runtime and conformance:
  - [ ] CAM root object/version/top-level fields.
  - [ ] Namespace object/type/name rules.
  - [ ] Resource URI/integrity declaration rules.
  - [ ] Route kind/input/invocation rules.
  - [ ] Route expression root and input-reference rules.
  - [ ] UI document version/top-level/node-map rules.
  - [ ] UI node `requires` rules.
  - [ ] UI call namespace rules.
  - [ ] ABI function name/signature/overload rules.
  - [ ] ABI input/output type support rules.
- [ ] For each duplicated check, decide whether it belongs in:
  - [ ] A shared fact builder.
  - [ ] A runtime-only parser/resolver.
  - [ ] A conformance-only publication rule.
- [ ] Introduce a shared diagnostic-neutral representation before changing public errors.
- [ ] Keep runtime fail-fast APIs intact while migrating internals.
- [ ] Keep conformance's accumulated issue API intact while migrating internals.
- [ ] Add parity tests proving that runtime parser acceptance and conformance structural acceptance do not drift for valid/invalid fixtures.
- [ ] Add fixtures where runtime and conformance previously risked disagreeing:
  - [ ] Unknown root field.
  - [ ] Unknown namespace type.
  - [ ] Invalid route continuation namespace.
  - [ ] Missing UI node `requires`.
  - [ ] Unsupported UI prop shape.
  - [ ] Invalid expression root.
- [ ] Document why conformance is allowed to add stricter publication checks that runtime parsing does not need.

## 3. `validateCamBundle` is a linear mutable pipeline that encodes the whole static semantics graph implicitly

`validateCamBundle` mutates one `issues` array while running phases in a fixed order: parse root JSON, validate root, validate namespaces, collect/validate resources, parse UI, parse ABI functions, validate routes, collect UI nodes, route handoffs, UI dataflow, route ABI compatibility, UI typeflow, and expression roots.

The order is meaningful, but it is not modeled as data. Contributors must know which partial facts exist after each phase, which failures short-circuit, and whether downstream validators expect raw or normalized forms.

### Refactor direction

Turn conformance into a two-stage system:

1. Collect facts with provenance and partial-failure markers.
2. Run rules over declared fact dependencies.

Example shape:

```ts
type FactSet = {
  root?: RootFact
  namespaces: readonly NamespaceFact[]
  resources: readonly ResourceFact[]
  routes: readonly RouteFact[]
  ui?: UiDocumentFact
  abiFunctionsByNamespace: ReadonlyMap<NamespaceName, readonly AbiFunctionFact[]>
}

type ConformanceRule = {
  readonly code: CamConformanceRuleCode
  readonly requires: readonly FactKind[]
  readonly check: (facts: FactSet) => readonly CamConformanceIssue[]
}
```

This would make conformance easier to cache, parallelize, test rule-by-rule, and extend.

### Revision checklist

- [ ] Draw the current conformance phase graph from `validateCamBundle`.
- [ ] For every phase, list:
  - [ ] Inputs required.
  - [ ] Facts produced.
  - [ ] Issues emitted.
  - [ ] Whether it short-circuits downstream work.
  - [ ] Whether it consumes raw JSON, parsed runtime objects, or conformance-specific facts.
- [ ] Define `FactSet` with optional/partial facts rather than relying on phase order.
- [ ] Add provenance fields to facts:
  - [ ] `resource`
  - [ ] `path`
  - [ ] original raw value where useful.
- [ ] Define rule dependencies explicitly.
- [ ] Split resource validation facts from cross-document semantic facts.
- [ ] Make missing prerequisites produce either no rule output or a clear prerequisite issue, never accidental exceptions.
- [ ] Add rule-level unit tests that construct `FactSet` directly.
- [ ] Add integration tests that compare old pipeline output with new rule output before deleting old code.
- [ ] Preserve stable public rule codes wherever possible.
- [ ] Decide whether issue ordering is part of the public contract; if yes, document and test ordering.

## 4. UI element extensibility is closed-world across too many packages

Adding a UI element currently implies touching protocol UI schemas, screen node types, screen parser switches, screen resolver switches, web renderer switches, and conformance typeflow/dataflow logic.

A closed-world UI vocabulary can be legitimate for CAM V1. The smell is not closure itself. The smell is that closure is distributed horizontally. A new element becomes a coordinated edit across protocol, parser, resolver, conformance, and renderer, which is exactly where scale creates inconsistent behavior.

### Refactor direction

Introduce a static element descriptor registry. The registry can remain closed-world, but each element's parser, resolver, typeflow metadata, and render contract should be declared from one descriptor or from tightly colocated descriptors.

Example shape:

```ts
type UiElementDescriptor = {
  readonly element: string
  readonly nodeKeys: ReadonlySet<string>
  readonly propSchema?: UiPropSchema
  readonly children: "none" | "required" | "optional"
  readonly state?: UiStateSchema
  readonly call?: UiCallSchema
  readonly resolve: UiElementResolver
  readonly conformance: readonly UiElementRule[]
}
```

### Revision checklist

- [ ] List every current UI element and all files that must change when the element changes:
  - [ ] `Screen`
  - [ ] `Fragment`
  - [ ] `Text`
  - [ ] `TextField`
  - [ ] `Address`
  - [ ] `Status`
  - [ ] `Nft`
  - [ ] `Include`
  - [ ] `Button`
- [ ] Define a single descriptor format for UI element shape:
  - [ ] Allowed fields.
  - [ ] Required props.
  - [ ] String props.
  - [ ] Address props.
  - [ ] State binding requirements.
  - [ ] Call namespace requirements.
  - [ ] Child-node allowance.
- [ ] Generate or derive parser decisions from descriptors where practical.
- [ ] Generate or derive conformance prop/type expectations from descriptors where practical.
- [ ] Keep renderer-specific rendering code separate from protocol validation, but have it consume the same resolved node contract.
- [ ] Add a test fixture for every element that exercises:
  - [ ] Minimal valid shape.
  - [ ] Unknown field rejection.
  - [ ] Missing required prop rejection.
  - [ ] Runtime resolution of expressions.
  - [ ] Conformance typeflow rules.
- [ ] Before adding new elements, require a descriptor and tests in the same PR.
- [ ] Document the process for adding a UI element.

## 5. Expression handling is well-designed but still duplicated at the adapters

The core expression engine is a useful abstraction: it validates strings, parses references, resolves values against a context, and normalizes the result. But `@cam/core` and `@cam/screen` wrap it in similar ways: both choose roots, enable numeric segments, normalize via `toInertValue`, and map generic expression errors into layer-specific errors.

More importantly, some consumers re-walk raw inert values for special questions. For example, route account requirements are detected by recursively scanning argument values and checking whether a string parses to an expression whose root is `account`. That works today, but it is an untyped side path around the expression runtime.

### Refactor direction

Parse expressions into a reusable AST or reference index during validation. Then expose utilities such as:

- `references(value): ExpressionReference[]`
- `referencedRoots(value): ReadonlySet<ExpressionRoot>`
- `requiresRoot(value, "account"): boolean`
- `validateReferences(value, scope): Diagnostic[]`

Then route account detection, conformance root checks, input checks, UI typeflow, and route handoff checks can use the same expression facts instead of repeatedly walking raw values.

### Revision checklist

- [ ] Add a shared expression-reference collection API.
- [ ] Ensure the API handles:
  - [ ] Escaped literal dollar strings.
  - [ ] Numeric segments.
  - [ ] Invalid expression syntax.
  - [ ] Arrays.
  - [ ] Records.
  - [ ] Nested values.
- [ ] Replace custom recursive account scans with reference-index queries.
- [ ] Replace conformance expression-root walkers with reference-index queries where possible.
- [ ] Preserve layer-specific error codes while sharing expression parsing facts.
- [ ] Add tests for root detection:
  - [ ] `$account.address` is detected as account-dependent.
  - [ ] `$$account.address` is not detected as an expression.
  - [ ] `$inputs.owner` is detected as an input reference.
  - [ ] `$outputs.0.owner` is detected as an output reference.
  - [ ] Invalid expressions produce syntax diagnostics but do not crash reference collection.
- [ ] Decide whether expression facts should be stored in parsed `CamDocument`/`UiDocument` objects or remain external fact metadata.
- [ ] Document the expression grammar once and link all parser/conformance/runtime code to that source.

## 6. The viewer session is a stateful god object

`createCamViewerSession` owns many responsibilities inside one mutable closure: load CAM from host, resolve contracts, load/verify/parse UI, maintain account, maintain current route/input/state/output view, navigate read routes, update state, dispatch actions, prepare write calls, check rendered-action membership, and translate account-related UI errors.

The responsibilities are related, but they are not all the same abstraction. At scale, this will become hard to test under concurrency, hard to adapt to non-browser hosts, and hard to reason about when writes, optimistic updates, multiple accounts, richer UI state, or multi-step flows are introduced.

### Refactor direction

Split the session internals into pure and impure pieces:

- `CamBundleLoader`: load root, verify root hash, load resources.
- `ContractResolver`: resolve contract namespace addresses and ABIs.
- `ViewResolver`: pure route outputs + UI document + state -> resolved UI.
- `ActionInterpreter`: resolved button -> navigation or prepared contract call.
- `ViewerStore` or reducer: current account/current view/current loaded facts.

`CamViewerSession` can remain as the public facade, but internally it should delegate.

### Revision checklist

- [ ] Extract pure functions first, before changing public session API.
- [ ] Identify session responsibilities and assign each to a target unit:
  - [ ] CAM host loading.
  - [ ] Resource loading and integrity verification.
  - [ ] Contract namespace resolution.
  - [ ] UI resource loading and parsing.
  - [ ] Route read execution.
  - [ ] UI initial-state resolution.
  - [ ] UI re-resolution after state updates.
  - [ ] Rendered-action membership checks.
  - [ ] Write-call preparation.
  - [ ] Account-dependent failure translation.
  - [ ] Snapshot cloning.
- [ ] Make `ViewResolver` deterministic and side-effect-free.
- [ ] Make `ActionInterpreter` deterministic and side-effect-free except for explicit dependencies.
- [ ] Add tests for stale/fabricated action rejection after extraction.
- [ ] Add tests for state updates that target non-rendered fields.
- [ ] Add tests for account-required routes and UI account references.
- [ ] Add tests for read-route navigation and write-route preparation as separate behaviors.
- [ ] Keep snapshot cloning and inert validation at the public boundary.
- [ ] Decide whether the session should expose a reducer-like event model for future UI hosts.

## 7. `cam-web` bypasses the viewer abstraction and owns too much transaction lifecycle

The app imports both `@cam/viewer` and low-level EVM send/simulation helpers from `@cam/evm-viem`. Its main component owns initialization, session loading, wallet connection, action dispatch, simulation, chain/account checks, transaction send, receipt waiting, nonce diagnosis, post-write navigation, and rendering.

This is a classic composition smell: the UI app becomes the only place where the real transaction lifecycle exists. That makes it hard to reuse the viewer in terminal/agent contexts and hard to test transaction behavior without React.

### Refactor direction

Move transaction execution into a `PreparedCallExecutor` or viewer-adjacent service with a narrow wallet port:

```ts
type WalletPort = {
  readonly connect: () => Promise<Address>
  readonly ensureChain: (chain: ChainSpec) => Promise<void>
  readonly ensureAccount: (address: Address) => Promise<void>
  readonly send: (call: PreparedContractCall) => Promise<Hash>
}
```

Then React becomes mostly state binding and rendering. The app should preferably depend on `@cam/viewer` plus a browser wallet adapter, not on `@cam/evm-viem` for core send semantics.

### Revision checklist

- [ ] Separate transaction lifecycle states from React component state:
  - [ ] Prepared.
  - [ ] Simulating.
  - [ ] Ready to send.
  - [ ] Sending.
  - [ ] Submitted.
  - [ ] Waiting for receipt.
  - [ ] Confirmed.
  - [ ] Reverted.
  - [ ] Timed out.
  - [ ] Replaced/stale/nonce-gap suspected.
- [ ] Extract a transaction executor with explicit ports:
  - [ ] Public client/read client.
  - [ ] Wallet client.
  - [ ] Chain switcher.
  - [ ] Account checker.
  - [ ] Receipt waiter.
  - [ ] Clock/timer if timeout logic is tested.
- [ ] Move nonce diagnosis out of `App.tsx`.
- [ ] Move post-write navigation policy out of `App.tsx` or make it a clear callback from the executor.
- [ ] Add unit tests for transaction lifecycle without React.
- [ ] Add app-level tests only for UI wiring and user-visible messages.
- [ ] Ensure stale interaction/send revision logic is preserved or replaced with an explicit state machine.
- [ ] Confirm terminal/agent hosts can reuse the same transaction executor.
- [ ] Keep wallet-specific browser details in a browser adapter, not in core viewer/session code.

## 8. ABI input/output normalization is duplicated

`@cam/evm-viem` has one walker for normalizing ABI inputs and another for normalizing ABI outputs. They both handle dynamic arrays, tuples, scalar types, integer ranges, bytes, addresses, and unsupported ABI shapes. Conformance has another substantial ABI compatibility and type-checking layer for route arguments and outputs.

The duplication is understandable because input normalization produces viem-callable values while output normalization produces inert protocol values. But the tree-walking policy should be shared.

### Refactor direction

Introduce an ABI walker with direction-specific callbacks:

```ts
walkAbiValue(parameter, value, {
  onString,
  onAddress,
  onBool,
  onInteger,
  onBytes,
  onTuple,
  onDynamicArray,
  onUnsupported,
})
```

Runtime input normalization, runtime output normalization, and conformance literal/known-value checks should then share traversal and unsupported-type decisions.

### Revision checklist

- [ ] Inventory ABI handling rules across:
  - [ ] `@cam/evm-viem` input normalization.
  - [ ] `@cam/evm-viem` output normalization.
  - [ ] `@cam/conformance` route ABI compatibility.
  - [ ] `@cam/conformance` UI typeflow.
- [ ] Identify differences that are intentional by direction:
  - [ ] Inputs become viem-callable values.
  - [ ] Outputs become inert values.
  - [ ] Conformance known values may be partial/unknown.
- [ ] Identify differences that are accidental drift.
- [ ] Build a shared ABI parameter walker.
- [ ] Make unsupported ABI type policy shared.
- [ ] Make tuple component naming policy shared.
- [ ] Make dynamic-array handling shared.
- [ ] Make fixed-array rejection shared, or explicitly document exceptions.
- [ ] Add tests for every supported ABI type:
  - [ ] `address`
  - [ ] `bool`
  - [ ] `string`
  - [ ] `bytes`
  - [ ] `bytes1` through `bytes32` representative cases.
  - [ ] `uint8`, `uint256`, `int8`, `int256` representative cases.
  - [ ] Dynamic arrays.
  - [ ] Tuples.
  - [ ] Nested tuple/array combinations within supported policy.
- [ ] Add negative tests for unsupported ABI shapes.
- [ ] Ensure conformance and runtime agree on named/duplicate/unnamed tuple component handling.

## 9. The Makefile is robust but too central

The root `Makefile` handles dependency installation, package checks, conformance checks, CAM publication preflight, viewer terminal, integration fuzz, Foundry build/test/fuzz/invariant/coverage, Anvil modes, RPC egress, fixture deployment, browser GUI composition, and extensive symlink/root guards.

The guard posture is commendable. The composition is the problem. As more fixtures and packages are added, this file will become a second application written in shell and Make syntax.

### Refactor direction

Split the Makefile into included modules:

- `mk/guards.mk`
- `mk/deps.mk`
- `mk/js.mk`
- `mk/foundry.mk`
- `mk/cam.mk`
- `mk/integration.mk`
- `mk/fixtures/bike-nft.mk`

Keep the root `Makefile` as an index of lanes. Preserve CLI compatibility.

### Revision checklist

- [ ] Do not weaken existing non-root and symlink guards during modularization.
- [ ] Extract guards first into `mk/guards.mk`.
- [ ] Add a test or check that all Docker-backed lanes still include the required guards.
- [ ] Move dependency lanes into `mk/deps.mk`.
- [ ] Move npm/package lanes into `mk/js.mk`.
- [ ] Move Foundry lanes into `mk/foundry.mk`.
- [ ] Move CAM conformance/publication lanes into `mk/cam.mk`.
- [ ] Move integration fuzz lanes into `mk/integration.mk`.
- [ ] Move bike NFT fixture lanes into `mk/fixtures/bike-nft.mk`.
- [ ] Keep the `help` target accurate after the split.
- [ ] Keep existing target names stable.
- [ ] Add a rendered-target list check so new targets appear in help or are explicitly hidden.
- [ ] Avoid adding new shell logic to the root `Makefile` after modularization.
- [ ] Document environment variables per module.

## 10. Error and diagnostic models are fragmented

There are separate error systems for core, EVM, viewer, UI, and conformance. Layer-specific error types are not inherently bad. The smell is that cross-layer causes get repeatedly rewrapped, and some distinctions get blurred. For example, a resource-size failure can be wrapped as a resource-load failure depending on the adapter boundary.

### Refactor direction

Introduce a common internal diagnostic shape:

```ts
type CamDiagnostic = {
  readonly layer: "protocol" | "core" | "screen" | "evm" | "viewer" | "conformance"
  readonly code: string
  readonly message: string
  readonly path?: string
  readonly resource?: string
  readonly cause?: unknown
}
```

Each package can still expose its own error class, but mappings should preserve the underlying diagnostic code and resource/path metadata.

### Revision checklist

- [ ] Inventory all public error classes and code unions:
  - [ ] `CamError`
  - [ ] `UiError`
  - [ ] `CamEvmError`
  - [ ] `CamViewerError`
  - [ ] `CamConformanceIssue`
  - [ ] Resource integrity errors.
- [ ] List all cross-layer wrapping sites.
- [ ] Identify where wrapping changes the semantic code too much.
- [ ] Define a common diagnostic payload that can be carried as `cause` or as a public property.
- [ ] Preserve current public error class names until a versioning decision is made.
- [ ] Preserve path/resource metadata through wrappers.
- [ ] Add tests for important wrapping boundaries:
  - [ ] UI parse failure through viewer.
  - [ ] Resource integrity mismatch through EVM/viewer.
  - [ ] Missing account through UI/viewer.
  - [ ] Route ABI mismatch through EVM route call.
  - [ ] Conformance issue formatting.
- [ ] Decide whether conformance rule codes and runtime error codes should share a registry or remain intentionally separate.
- [ ] Document when to throw, when to return diagnostics, and when to accumulate issues.

## 11. The package graph is not cyclic, but app-level dependencies leak across layers

`@cam/viewer` already composes `@cam/core`, `@cam/evm-viem`, `@cam/protocol`, and `@cam/screen`. Yet `cam-web` also depends directly on `@cam/evm-viem`, `@cam/protocol`, `@cam/screen`, and `@cam/viewer`.

That means the app can bypass viewer-level invariants. It already owns simulation and send semantics directly.

### Refactor direction

Decide whether `@cam/viewer` is a full orchestration boundary or just a state helper. If it is the orchestration boundary, `cam-web` should mostly consume `@cam/viewer` plus a wallet/browser adapter. If it is only a helper, rename or scope it accordingly and move more orchestration out of React.

### Revision checklist

- [ ] Draw the intended package dependency graph.
- [ ] Draw the actual package dependency graph from `package.json` files.
- [ ] Mark every app import that bypasses `@cam/viewer`.
- [ ] Decide which imports are legitimate rendering concerns and which are orchestration leaks.
- [ ] If `@cam/viewer` is the boundary:
  - [ ] Move send/simulate transaction semantics behind viewer or a viewer-adjacent executor.
  - [ ] Keep direct `@cam/screen` imports out of `cam-web` except for display-only types if needed.
  - [ ] Keep direct `@cam/protocol` imports out of `cam-web` except for inert value display/type helpers if needed.
- [ ] If `@cam/viewer` is not the boundary:
  - [ ] Rename or document it as a session helper.
  - [ ] Create a different orchestration package for app/terminal/agent hosts.
- [ ] Add a package graph check that prevents undesired imports.
- [ ] Add an ADR stating the intended boundary between viewer, app, and wallet adapters.

## 12. Dynamic string maps dominate important boundaries

Core documents and UI documents are largely `Record<string, ...>` maps. Invocations use string namespace/function names. UI state keys are strings. Runtime contexts allow dynamic keys.

That is normal for JSON protocol documents, but it weakens internal composition. Once a value is validated, it should preferably become a branded or opaque type:

- `RouteName`
- `NamespaceName`
- `ContractNamespaceName`
- `UiNodeName`
- `StateKey`
- `ResourceURI`
- `Sha256Integrity`
- `Eip155ChainId`

This would reduce accidental cross-use and make fact-builder outputs more self-documenting.

### Refactor direction

Keep wire-format JSON strings as-is, but introduce branded internal types at validation boundaries. Do not overdo branding for ephemeral local values; focus on identifiers that cross package boundaries or appear in diagnostics.

### Revision checklist

- [ ] Identify string identifiers that cross package boundaries.
- [ ] Introduce branded types only after validation:
  - [ ] `RouteName`
  - [ ] `NamespaceName`
  - [ ] `ContractNamespaceName`
  - [ ] `UiNodeName`
  - [ ] `UiStateKey`
  - [ ] `ResourceURI`
  - [ ] `Sha256Integrity`
  - [ ] `Eip155ChainId`
  - [ ] `EvmAddress`
- [ ] Avoid casting raw JSON strings directly to branded types.
- [ ] Add constructors/validators for each branded type.
- [ ] Ensure error messages still show plain strings.
- [ ] Update fact builders to output branded values.
- [ ] Update runtime APIs only where branding adds real protection.
- [ ] Do not expose excessive branding in public APIs if it harms ergonomics.
- [ ] Add compile-time tests or type assertions for common mix-ups:
  - [ ] Route name passed where UI node name is expected.
  - [ ] Namespace name passed where resource URI is expected.
  - [ ] Chain ID passed where address is expected.

## Suggested refactor sequence

The highest-leverage sequence is:

1. Extract shared diagnostic/fact builders for CAM root, namespaces, routes, UI documents/nodes, expressions, resources, and ABI functions. Make both runtime parsers and conformance consume them.
2. Replace conformance's linear mutable pipeline with `collectFacts(bundle)` plus independent rules over facts.
3. Introduce an expression AST/reference index so account requirements, root validation, input checks, and typeflow use the same expression facts.
4. Split the viewer session internally into loader, resolver, action interpreter, and state reducer. Keep the public `CamViewerSession` API if useful.
5. Move transaction execution out of `App.tsx` into a viewer- or app-service module with a wallet port.
6. Unify ABI traversal across runtime inputs, runtime outputs, and conformance known-value checks.
7. Modularize the Makefile after semantic refactors, because the Makefile is a coordination smell but not the highest semantic-drift risk.

### Revision checklist

- [ ] Do not begin with a package-split PR unless shared tests already protect semantics.
- [ ] Start with low-risk internal extraction:
  - [ ] Fact types.
  - [ ] Expression reference collection.
  - [ ] ABI walker tests.
- [ ] Keep each PR focused on one axis:
  - [ ] Facts.
  - [ ] Conformance pipeline.
  - [ ] Expressions.
  - [ ] Viewer session internals.
  - [ ] Transaction executor.
  - [ ] ABI traversal.
  - [ ] Makefile modularization.
- [ ] Add characterization tests before deleting duplicated logic.
- [ ] In each PR, record whether public behavior should be byte-for-byte/issue-for-issue identical.
- [ ] If issue output changes, document the intended difference and update fixtures deliberately.
- [ ] Keep public APIs stable until internal duplication is reduced.
- [ ] After each extraction, run the full package and fixture checks.
- [ ] After all semantic refactors, re-audit package boundaries and update this note.

## Bottom line

The repo is not sloppy. It is careful and security-minded. The main architectural risk is that the same CAM semantics are implemented in several places for different purposes: fail-fast runtime parsing, accumulated conformance diagnostics, EVM execution, UI resolution, viewer orchestration, and React transaction handling.

That will scale poorly as CAM grows. The most important design move is to make validated facts the shared substrate. Runtime, conformance, viewer, and tooling should disagree only on when they stop and how they report, not on what the CAM document means.

### Revision checklist

- [ ] Treat semantic duplication as the top design risk.
- [ ] Treat validated facts as the preferred shared substrate.
- [ ] Keep runtime, conformance, and viewer behavior aligned through shared builders and parity tests.
- [ ] Preserve the repo's existing strong validation/security posture.
- [ ] Reduce orchestration size where state, network, wallet, and rendering responsibilities are currently mixed.
- [ ] Keep public APIs stable while improving internals.
- [ ] Re-run this audit after the first major fact-builder or conformance-pipeline refactor.
