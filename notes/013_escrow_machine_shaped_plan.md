# Machine-Shaped Escrow and CAM State-Machine Path

Date: 2026-07-26

Status: audited implementation plan and current next-work note.

Purpose: define a second contract-defined application that exercises CAM 1.1
native transaction values, nested ABI inputs, multi-actor timed workflows,
pull-payment accounting, dynamic action projection, and eventual explicit
state-machine verification. Shape the application so a future CAM machine
resource is additive rather than requiring a Solidity or route redesign.

## Audit Verdict

Build the escrow, but do not treat the whole application as one finite-state
machine.

The application has three distinct workflow scopes:

1. **agreement factory**: preview and create a prospective agreement;
2. **stored agreement machine**: move one funded agreement through acceptance,
   submission, dispute, settlement, and terminal outcomes;
3. **account credit workflow**: withdraw credits aggregated across agreements.

Only the second scope is the first explicit CAM machine candidate.

The earlier draft incorrectly treated `createAgreement` as an edge from a
prospective `none` state. That does not compose cleanly with one canonical
instance observation: creation availability depends on the full prospective
parameter tuple, while stored agreement observation depends only on an
agreement ID. The stored agreement machine therefore starts at `funded` after a
successful factory call.

The earlier draft also over-specified an `expectedAgreementId` contract
argument and a duplicate top-level CAM `amount` input. Neither is needed. The
contract derives the ID from the client/reference pair, and the CAM route uses
one nested `params` value as the source of both calldata and transaction value.

The final responsibility boundary is:

```text
CamEscrow
    owns agreement state, deadlines, actor authorization, action availability,
    settlement, liabilities, document commitments, and canonical transition
    events

CamEscrowUI
    reads CamEscrow and maps contract facts to stable semantic machine, state,
    authority, view, and transition IDs

CAM 1.1 bundle
    binds application actions to explicit routes, nested contract arguments,
    native value, and post-write observations

Generic viewer
    permits only currently rendered actions, prepares and simulates the call,
    submits it, and refreshes from current chain state

Future CAM machine resource
    declares the stored agreement labelled transition graph and binds routes,
    observations, and transition-event witnesses
```

Do not implement the generic machine resource before the escrow works end to
end under CAM 1.1. Do fix all state IDs, transition IDs, observation routes, and
event identities now so the later resource is declarative.

## Why Escrow Is the Next Application

Bike NFT exercises read projections, permissions, dynamic views, ordinary write
routes, and local deployment. Escrow adds materially different pressure:

- a payable CAM 1.1 route;
- one nested amount value crossing calldata and the transaction envelope;
- multiple actors with different enabled transitions;
- exact deadline boundaries and permissionless timeout finalization;
- external evidence anchored by content commitments;
- liabilities moving from active escrow to aggregated withdrawal credits;
- workflow state changing outside the current viewer;
- a useful labelled-transition-system model;
- receipt-time transition evidence needed for concurrent execution.

This is a protocol-validation application, not a complete commercial escrow or
arbitration product.

## Product and Trust Model

The application is a:

> Single-milestone, native-asset, designated-arbitrator escrow with client
> cancellation before acceptance and bounded optimistic settlement.

Participants:

- **client**: creates and funds the agreement;
- **contractor**: accepts, performs, submits, and receives payment on approval or
  contractor-favoring timeout;
- **arbitrator**: selects the beneficiary only after a client dispute;
- **finalizer**: any nonzero caller may execute an already predetermined timeout
  outcome.

The arbitrator is selected by the client and accepted by the contractor only in
the limited sense that the contractor sees the address and terms before calling
`acceptAgreement`. The contract does not prove that the arbitrator consented,
is neutral, is competent, or is available. Role-address separation also does
not prove human or organizational independence.

The arbitrator may be an EOA, Safe, DAO executor, or another contract. Do not
require code at the arbitrator address.

The contract is:

- non-upgradeable;
- administrator-free;
- native-asset only;
- single-milestone;
- pull-payment based;
- explicit about every timeout outcome.

### Arbitration timeout outcome

If the arbitrator does not rule before the arbitration deadline, the amount is
released to the contractor.

This is deliberate:

- client inaction after an undisputed submission already favors the contractor;
- opening a dispute must not create an indefinite client veto;
- refund-on-inactivity would let a client select an inert arbitrator and recover
  every disputed amount;
- a split fallback is arbitrary and introduces partial-settlement accounting.

This policy is contractor-favoring. A contractor can submit poor work and still
receive payment if the client-selected arbitrator does not act. The client must
therefore choose an arbitrator whose availability it trusts, and the contractor
must decide whether to accept those terms. V1 does not solve that institutional
problem.

### Client cancellation and transaction ordering

The client may cancel only before contractor acceptance. A cancellation and an
acceptance submitted near each other are resolved by chain ordering: whichever
valid transaction executes first wins. Contractors must not begin relying on an
acceptance until the acceptance transaction is confirmed.

### Arbitrator compensation and consent

V1 has no arbitrator fee, acknowledgement transaction, availability registry, or
appeal process. It assumes arbitrator motivation or compensation exists out of
band. Requiring arbitrator acknowledgement would add another pre-acceptance
state and transaction and is deliberately deferred.

## Stored Agreement State Machine

The stored machine begins only after funded creation succeeds:

```text
Funded
  ├── client cancels before deadline ──────────────────► Refunded
  │                                                        ClientCancellation
  │
  ├── contractor accepts before deadline ──────────────► Accepted
  │
  └── acceptance deadline reached ─────────────────────► Refunded
                                                           AcceptanceTimeout

Accepted
  ├── contractor submits before deadline ──────────────► Submitted
  │
  └── work deadline reached ───────────────────────────► Refunded
                                                           WorkTimeout

Submitted
  ├── client approves before deadline ─────────────────► Released
  │                                                        ClientApproval
  │
  ├── client disputes before deadline ─────────────────► Disputed
  │
  └── review deadline reached ─────────────────────────► Released
                                                           ReviewTimeout

Disputed
  ├── arbitrator rules for client before deadline ─────► Refunded
  │                                                        ArbitratorToClient
  │
  ├── arbitrator rules for contractor before deadline ─► Released
  │                                                        ArbitratorToContractor
  │
  └── arbitration deadline reached ────────────────────► Released
                                                           ArbitrationTimeout
```

`Released` and `Refunded` are terminal agreement states. They mean that the
amount has been credited for withdrawal, not necessarily transferred out of the
contract.

`AgreementState.None` remains a storage/read sentinel for an uninstantiated ID,
but it is not a state in the stored agreement machine.

## Exact Time Semantics

Every phase uses one boundary:

```text
ordinary transition available: block.timestamp < deadline
timeout transition available:  block.timestamp >= deadline
```

Consequences:

```text
accept at deadline - 1                 succeeds
accept at deadline                     fails
finalizeAcceptanceTimeout at deadline  succeeds
```

The same rule applies to submission, approval, dispute, arbitration resolution,
and all timeout transitions.

Every active stored state has exactly one deadline:

| State | Active deadline |
|---|---|
| `Funded` | acceptance deadline |
| `Accepted` | work deadline |
| `Submitted` | review deadline |
| `Disputed` | arbitration deadline |
| terminal | zero |

Use `uint64` for configured durations and `uint256` for stored timestamps and
deadlines. Timestamp packing is not worth introducing a cast-based liveness
boundary in a contract already storing dynamic strings.

Pin a meaningful maximum phase duration:

```solidity
uint64 public constant MAX_PHASE_DURATION = 365 days;
```

Each duration must satisfy:

```text
1 <= duration <= MAX_PHASE_DURATION
```

Merely requiring a finite integer would permit multi-million-year locks and
would not justify the phrase “bounded settlement.” The one-year cap is product
policy, not an EVM necessity; changing it later requires a new deployment.

When a transition starts a phase:

```solidity
uint256 now_ = block.timestamp;
agreement.updatedAt = now_;
agreement.deadline = now_ + duration;
```

Solidity checked arithmetic owns overflow rejection.

## Exact Public Timeout Functions

Expose one public function per semantic timeout transition:

```solidity
function finalizeAcceptanceTimeout(bytes32 agreementId) external;
function finalizeWorkTimeout(bytes32 agreementId) external;
function finalizeReviewTimeout(bytes32 agreementId) external;
function finalizeArbitrationTimeout(bytes32 agreementId) external;
```

The functions may share private machinery, but each validates one exact source
state and produces one exact settlement reason.

Do not expose only a generic `finalizeExpiredAgreement`. A route named
`finalizeReviewTimeout` must not be able to invoke a generic function while the
agreement is `Funded` and obtain an acceptance-timeout refund.

The binding is intentionally one-to-one:

```text
transition ID
    ↔ CAM route
    ↔ Solidity function
    ↔ source state
    ↔ effect and settlement reason
```

## Agreement Identity

Use a deployment-scoped, client-scoped deterministic ID:

```solidity
bytes32 private constant AGREEMENT_ID_DOMAIN =
    keccak256("CamEscrow.agreement.v1");

agreementId = keccak256(
    abi.encode(
        AGREEMENT_ID_DOMAIN,
        address(this),
        client,
        keccak256(bytes(agreementRef))
    )
);
```

Expose:

```solidity
function agreementIdOf(
    address client,
    string calldata agreementRef
) external view returns (bytes32);
```

Properties:

- different clients may use the same readable reference;
- different escrow deployments produce different IDs;
- the ID can be previewed before creation;
- every stored-machine mutation uses one `bytes32`;
- the same client cannot reuse a reference after any outcome;
- CAM does not need a transaction return value for later lookup.

The ID intentionally binds only the escrow deployment, client, and exact
reference bytes. It does **not** commit to contractor, arbitrator, amount,
durations, or documents. Those terms are reviewed in calldata and stored in the
agreement. Do not claim that the ID is a terms hash.

Do not include `block.chainid` in the storage-key formula. A chain-ID change must
not make reference lookup compute a new key for existing storage. The externally
complete identity remains:

```text
chain ID + escrow contract address + agreement ID
```

References are byte-exact. The contract does not trim, case-fold, or Unicode
normalize them.

## Creation Is a Factory Operation

Creation is not a transition in the stored agreement machine.

Use:

```solidity
function createAgreement(
    CreateAgreementParams calldata params
) external payable returns (bytes32 agreementId);
```

The contract derives the agreement ID from `msg.sender` and
`params.agreementRef`, validates the terms, stores the agreement directly in
`Funded`, increases active liabilities, emits the creation event, and returns
the ID for ordinary direct callers.

No `expectedAgreementId` argument is needed. Such an argument would only bind
the caller to the client/reference-derived key, not to the full agreement terms,
and would complicate CAM authoring without adding material contract safety.

The CAM continuation can look up the created agreement by the same client and
reference used in the call. A future machine-aware viewer can compare the
prospective ID returned by the preview with the ID observed after creation.

## Bind Declared Amount to Native Value

Keep one amount inside the creation tuple and require exact native value:

```solidity
if (params.amount == 0) revert ZeroAmount();
if (msg.value != params.amount) {
    revert UnexpectedNativeAmount(params.amount, msg.value);
}
```

The future CAM route uses the same nested value for both channels:

```json
{
  "inputs": ["params"],
  "value": "$inputs.params.amount",
  "call": {
    "args": {
      "params": "$inputs.params"
    }
  }
}
```

Do not add a second top-level `amount` route input. A single expression source is
stronger and simpler than relying on conformance or runtime code to prove two
independent inputs equal.

## Content-Committed Evidence

Do not store mutable external documents as bare URIs.

Use:

```solidity
struct DocumentRef {
    string uri;
    bytes32 sha256Digest;
}
```

The digest identifies the canonical application document bytes agreed by the
parties, independent of HTTP compression or other transport encoding. The URI
is a locator only. The contract cannot retrieve or verify the bytes; viewers and
participants must verify the digest before relying on the document.

Each agreement may store:

```solidity
DocumentRef terms;
DocumentRef submission;
DocumentRef dispute;
DocumentRef resolution;
```

Pin limits:

```solidity
uint256 public constant MAX_AGREEMENT_REF_BYTES = 128;
uint256 public constant MAX_DOCUMENT_URI_BYTES = 512;
```

Validate every supplied document:

```text
URI nonempty
URI byte length <= MAX_DOCUMENT_URI_BYTES
sha256Digest != bytes32(0)
```

Absent documents use the default empty URI and zero digest.

The contract does not parse URI schemes. Navigation policy belongs to clients;
the digest, not the locator, is the content authority.

All actors, amounts, references, deadlines, URIs, and digests are public.
Sensitive material should be encrypted off-chain before publication.

Storing the locators on-chain is intentionally expensive. Event-only locators
would reduce storage but would force generic viewers to depend on an indexer.
The 512-byte cap keeps the direct-state design bounded.

Document commitments prove content identity, not comprehension, validity, or
consent. The client signals terms by creation and the contractor signals
acceptance by `acceptAgreement`; the arbitrator gives no on-chain consent in V1.

## Creation Tuple

Use nested tuples rather than a long positional signature:

```solidity
struct CreateAgreementParams {
    string agreementRef;
    address contractor;
    address arbitrator;
    uint256 amount;
    uint64 acceptanceDuration;
    uint64 workDuration;
    uint64 reviewDuration;
    uint64 arbitrationDuration;
    DocumentRef terms;
}
```

Creation validation requires:

```text
agreement reference nonempty and <= 128 bytes
contractor nonzero
arbitrator nonzero
client, contractor, and arbitrator role addresses pairwise distinct
contractor != address(this)
arbitrator != address(this)
amount > 0
msg.value == amount
each duration in [1, MAX_PHASE_DURATION]
terms document valid
agreement ID unused
```

Pairwise address distinction prevents one address from exercising multiple
contract roles, but it does not prove organizational independence.

The agreement immediately enters `Funded`; there is no separate unfunded
`Created` state or funding transaction.

## Client Cancellation Before Acceptance

Expose:

```solidity
function cancelAgreement(bytes32 agreementId) external;
```

It is available only when:

```text
state == Funded
caller == client
block.timestamp < acceptance deadline
```

The client receives a withdrawal credit and the settlement reason is
`ClientCancellation`.

No contractor-decline transition is needed in V1. The contractor may leave the
offer unaccepted; the client may cancel before the deadline or anyone may
finalize the acceptance-timeout refund afterward.

## Creation Preview

Creation availability depends on the prospective parameter tuple and therefore
belongs to the factory workflow, not `AgreementActions`.

Expose a non-reverting preview:

```solidity
struct CreateAgreementPreview {
    bytes32 agreementId;
    uint256 requiredValue;
    bool agreementRefValid;
    bool partiesValid;
    bool amountValid;
    bool durationsValid;
    bool termsValid;
    bool idAvailable;
    bool canCreate;
}

function previewCreateAgreement(
    address actor,
    CreateAgreementParams calldata params
) external view returns (CreateAgreementPreview memory);
```

`canCreate` checks current contract state and all structural preconditions except
facts outside the read call:

- the eventual `msg.value` equals `requiredValue`;
- the wallet has sufficient funds;
- the preview remains current until execution;
- no competing transaction creates the same ID first.

`createAgreement` uses the same validation predicates, then checks exact native
value and revalidates current state.

The preview is a diagnostic factory view. Do not fabricate an agreement-machine
`none` state or include `createAgreement` in the stored machine transition set.

## Read-Only ERC-165 Interface

Add:

```text
dapps/escrow/src/ICamEscrowView.sol
```

The interface extends `IERC165` and owns reader-facing enums, structs, and read
functions:

- `DocumentRef`;
- `CreateAgreementParams`;
- `CreateAgreementPreview`;
- `AgreementState`;
- `SettlementReason`;
- `AgreementAction`;
- `AgreementView`;
- `AgreementActions`;
- identity, preview, observation, action, credit, and liability reads.

`CamEscrow` advertises:

```solidity
type(ICamEscrowView).interfaceId
type(IERC165).interfaceId
```

The later projection constructor verifies this interface before accepting its
backing escrow contract.

## Agreement Observation

Use:

```solidity
struct AgreementView {
    bytes32 agreementId;
    bool exists;
    AgreementState state;
    SettlementReason settlementReason;
    address client;
    address contractor;
    address arbitrator;
    uint256 amount;
    uint64 acceptanceDuration;
    uint64 workDuration;
    uint64 reviewDuration;
    uint64 arbitrationDuration;
    uint256 createdAt;
    uint256 updatedAt;
    uint256 deadline;
    bool deadlineReached;
    string agreementRef;
    DocumentRef terms;
    DocumentRef submission;
    DocumentRef dispute;
    DocumentRef resolution;
}
```

Expose:

```solidity
function agreementById(
    bytes32 agreementId
) external view returns (AgreementView memory);

function agreementByReference(
    address client,
    string calldata agreementRef
) external view returns (AgreementView memory);
```

Lookup does not apply creation validation to the reference. Empty, oversized, or
otherwise non-creatable references may be queried and simply produce an absent
observation.

A missing agreement is valid data and must not revert:

```text
agreementId = requested or computed ID
exists = false
state = None
all remaining fields = defaults
```

## Core-Owned Transition Availability

The projection must not reimplement actor, state, deadline, or terminality
rules.

The read interface exposes one boolean per stored-machine transition:

```solidity
struct AgreementActions {
    bool cancelAgreement;
    bool acceptAgreement;
    bool submitAgreement;
    bool approveAgreement;
    bool disputeAgreement;
    bool finalizeAcceptanceTimeout;
    bool finalizeWorkTimeout;
    bool finalizeReviewTimeout;
    bool resolveForClient;
    bool resolveForContractor;
    bool finalizeArbitrationTimeout;
}
```

Expose:

```solidity
function actionsFor(
    bytes32 agreementId,
    address actor
) external view returns (AgreementActions memory);
```

Action matrix:

| State/time | Actor | Enabled transition |
|---|---|---|
| `Funded`, before deadline | client | `cancelAgreement` |
| `Funded`, before deadline | contractor | `acceptAgreement` |
| `Funded`, deadline reached | any nonzero actor | `finalizeAcceptanceTimeout` |
| `Accepted`, before deadline | contractor | `submitAgreement` |
| `Accepted`, deadline reached | any nonzero actor | `finalizeWorkTimeout` |
| `Submitted`, before deadline | client | `approveAgreement`, `disputeAgreement` |
| `Submitted`, deadline reached | any nonzero actor | `finalizeReviewTimeout` |
| `Disputed`, before deadline | arbitrator | `resolveForClient`, `resolveForContractor` |
| `Disputed`, deadline reached | any nonzero actor | `finalizeArbitrationTimeout` |
| terminal, absent, or actor zero | any | none |

Use one canonical predicate rather than materializing all booleans in every
write:

```solidity
function _isActionAvailable(
    Agreement storage agreement,
    AgreementAction action,
    address actor,
    uint256 now_
) private view returns (bool);
```

`actionsFor` calls this predicate for each action. Each write calls it only for
its own action and reverts with a structured error when false:

```solidity
error ActionUnavailable(
    bytes32 agreementId,
    AgreementAction action,
    address actor,
    AgreementState state,
    uint256 deadline,
    uint256 currentTime
);
```

For evidence-bearing transitions, check action availability before validating
the submitted `DocumentRef`. This pins the equivalence between projected action
availability and actor/state/time call availability; payload validity remains a
separate error surface.

## Contract API

```solidity
function createAgreement(
    CreateAgreementParams calldata params
) external payable returns (bytes32 agreementId);

function cancelAgreement(bytes32 agreementId) external;
function acceptAgreement(bytes32 agreementId) external;

function submitAgreement(
    bytes32 agreementId,
    DocumentRef calldata submission
) external;

function approveAgreement(bytes32 agreementId) external;

function disputeAgreement(
    bytes32 agreementId,
    DocumentRef calldata dispute
) external;

function finalizeAcceptanceTimeout(bytes32 agreementId) external;
function finalizeWorkTimeout(bytes32 agreementId) external;
function finalizeReviewTimeout(bytes32 agreementId) external;

function resolveForClient(
    bytes32 agreementId,
    DocumentRef calldata resolution
) external;

function resolveForContractor(
    bytes32 agreementId,
    DocumentRef calldata resolution
) external;

function finalizeArbitrationTimeout(bytes32 agreementId) external;

function withdrawTo(address payable recipient) external;
```

`withdrawTo` uses `ReentrancyGuard`.

No overloads. No generic timeout function. No owner. No pause. No
upgradeability. No external calls during creation, agreement transitions, or
settlement. The only external native-value call occurs during withdrawal.

## Settlement Reasons

```solidity
enum SettlementReason {
    None,
    ClientCancellation,
    AcceptanceTimeout,
    WorkTimeout,
    ClientApproval,
    ReviewTimeout,
    ArbitratorToClient,
    ArbitratorToContractor,
    ArbitrationTimeout
}
```

Terminal state and reason must agree:

```text
Refunded:
    ClientCancellation
    AcceptanceTimeout
    WorkTimeout
    ArbitratorToClient

Released:
    ClientApproval
    ReviewTimeout
    ArbitratorToContractor
    ArbitrationTimeout
```

Use two private terminal helpers:

```solidity
function _refundClient(
    bytes32 agreementId,
    Agreement storage agreement,
    AgreementAction action,
    SettlementReason reason,
    address actor
) private;

function _releaseContractor(
    bytes32 agreementId,
    Agreement storage agreement,
    AgreementAction action,
    SettlementReason reason,
    address actor
) private;
```

Do not use one generic helper that accepts arbitrary terminal state/reason
combinations.

## Accounting

Store:

```solidity
mapping(address => uint256) private _withdrawable;
uint256 public totalEscrowed;
uint256 public totalWithdrawable;
```

Expose:

```solidity
function withdrawable(address account) external view returns (uint256);
function totalLiabilities() external view returns (uint256);
```

Creation:

```text
contract balance increases by amount
totalEscrowed increases by amount
```

Settlement:

```text
totalEscrowed decreases by amount
beneficiary credit increases by amount
totalWithdrawable increases by amount
```

Withdrawal:

```text
caller credit becomes zero
totalWithdrawable decreases by amount
exact amount is sent to the selected recipient
```

The solvency invariant is:

```solidity
totalEscrowed + totalWithdrawable <= address(this).balance;
```

The inequality permits forcibly sent native value.

Reject withdrawal when:

```text
recipient == address(0)
recipient == address(this)
caller has no withdrawal credit
```

The caller withdraws its complete aggregated credit but may choose another
recipient. This helps smart-account beneficiaries whose own receive function
rejects native value, provided the smart account can call `withdrawTo`.

Use checks-effects-interactions. A failed native transfer reverts and restores
the credit and totals atomically.

## Direct Native Value and Unknown Calls

Accept native value only through `createAgreement`:

```solidity
receive() external payable {
    revert DirectNativeTransferDisabled();
}

fallback() external payable {
    revert UnknownFunction(msg.sig);
}
```

Forced native value remains inert. Do not introduce an administrator solely to
sweep unsolicited surplus.

## Canonical Transition Evidence

Latest-state reobservation is not an exact postcondition proof. After one
transaction succeeds, another transaction may legitimately advance the same
agreement before the viewer reobserves it.

Emit one canonical transition event for every stored-machine transition:

```solidity
event AgreementTransitioned(
    bytes32 indexed agreementId,
    bytes32 indexed transitionId,
    address indexed actor,
    AgreementState fromState,
    AgreementState toState,
    SettlementReason settlementReason,
    uint256 deadline
);
```

Use:

```solidity
transitionId = keccak256(bytes(<exact CAM transition/route name>));
```

Examples:

```text
keccak256("acceptAgreement")
keccak256("finalizeReviewTimeout")
keccak256("resolveForClient")
```

Emit exactly one `AgreementTransitioned` event per successful stored-machine
transition. Creation is a factory operation and emits `AgreementCreated`, not a
fictional transition from `None`.

Also emit document-specific and accounting events:

```solidity
event AgreementCreated(...);
event AgreementDocumentRecorded(...);
event AgreementCreditCreated(...);
event Withdrawal(...);
```

`AgreementCreated` includes the initial funded deadline and terms commitment.
`AgreementDocumentRecorded` identifies submission, dispute, or resolution.
`AgreementCreditCreated` identifies beneficiary, amount, and settlement reason.

The canonical transition event supports indexers, model-based tests, and future
receipt-time machine verification without forcing the viewer to interpret
latest state as the exact receipt-time state.

## Machine-Shaped Projection

A later `CamEscrowUI` returns:

```solidity
struct MachineView {
    string machineId;
    bytes32 instanceId;
    bool instantiated;
    string stateId;
    string[] transitionIds;
    bool terminal;
}

struct AppView {
    MachineView machine;
    address account;
    AgreementView agreement;
    AgreementActions actions;
    uint256 accountWithdrawable;
    string viewId;
    string authorityId;
}
```

Stable machine ID:

```text
escrow.agreement.v1
```

Stable state IDs:

```text
funded
accepted
submitted
disputed

refunded.clientCancellation
refunded.acceptanceTimeout
refunded.workTimeout
refunded.arbitratorToClient

released.clientApproval
released.reviewTimeout
released.arbitratorToContractor
released.arbitrationTimeout
```

Stable stored-machine transition IDs:

```text
cancelAgreement
acceptAgreement
submitAgreement
approveAgreement
disputeAgreement
finalizeAcceptanceTimeout
finalizeWorkTimeout
finalizeReviewTimeout
resolveForClient
resolveForContractor
finalizeArbitrationTimeout
```

`createAgreement` is not in this list. It belongs to the factory workflow.
`withdrawTo` belongs to the account-credit workflow.

For an absent ID:

```text
instantiated = false
stateId = ""
transitionIds = []
terminal = false
```

Do not invent a formal `none` state in the stored machine.

The projection maps exact core action booleans to exact transition IDs. It may
map enums to semantic IDs, choose display views, and identify the current actor
role. It performs no actor/state/deadline authorization calculation.

Creation preview has a separate projection/view shape. It may display the
prospective ID and structural checks and render the factory `createAgreement`
action when `preview.canCreate` is true, but it does not claim the agreement
machine is instantiated.

## Canonical CAM 1.1 Routes

The bundle should contain three route groups.

### Factory routes

```text
createAgreementPreview(params)
createAgreement(params)
```

Creation uses one nested source value:

```json
{
  "createAgreement": {
    "kind": "write",
    "inputs": ["params"],
    "value": "$inputs.params.amount",
    "call": {
      "namespace": "contracts.CamEscrow",
      "function": "createAgreement",
      "args": {
        "params": "$inputs.params"
      }
    },
    "then": {
      "namespace": "routes",
      "function": "lookupAgreement",
      "args": {
        "client": "$account.address",
        "agreementRef": "$inputs.params.agreementRef"
      }
    }
  }
}
```

The contract checks `msg.value == params.amount`. The continuation uses the same
client/reference identity inputs and observes the resulting ID.

### Observation routes

```text
lookupAgreement(client, agreementRef)
agreement(agreementId)
```

`agreement(agreementId)` is the canonical stored-instance observation used by
all stored-machine transition continuations.

`lookupAgreement` supports readable navigation and the special post-create
handoff.

### Stored-machine transition routes

Each transition route has the same name as the transition ID, calls the exact
Solidity function, and continues to:

```text
agreement(agreementId)
```

Example:

```json
{
  "acceptAgreement": {
    "kind": "write",
    "inputs": ["agreementId"],
    "call": {
      "namespace": "contracts.CamEscrow",
      "function": "acceptAgreement",
      "args": {
        "agreementId": "$inputs.agreementId"
      }
    },
    "then": {
      "namespace": "routes",
      "function": "agreement",
      "args": {
        "agreementId": "$inputs.agreementId"
      }
    }
  }
}
```

### Credit routes

`withdrawTo` and account-credit observation remain auxiliary routes outside the
agreement machine.

## What CAM 1.1 Provides

CAM 1.1 already provides:

- hash-pinned route and UI declarations;
- closed-world route/resource parsing;
- ABI-compatible nested tuple arguments;
- exact native transaction value;
- simulation and wallet submission;
- declared post-write continuations;
- dispatch only from currently rendered actions;
- current-state reobservation.

The application can therefore expose a disciplined machine envelope by
convention:

```text
machine ID
instance ID
instantiated flag
state ID
enabled transition IDs
```

CAM 1.1 does not yet declare the graph or verify transition witnesses.

## Future CAM Machine Resource

After the escrow bundle works under CAM 1.1, introduce a hash-pinned machine
resource in a new CAM version.

The first machine resource should model only stored agreements. Its initial
state is `funded`; creation is an external instantiation/factory operation.

Illustrative shape:

```json
{
  "machine": "1.0.0",
  "id": "escrow.agreement.v1",
  "observe": {
    "route": "agreement",
    "instance": "$outputs.0.machine.instanceId",
    "instantiated": "$outputs.0.machine.instantiated",
    "state": "$outputs.0.machine.stateId",
    "enabled": "$outputs.0.machine.transitionIds"
  },
  "transitionEvent": {
    "namespace": "contracts.CamEscrow",
    "event": "AgreementTransitioned",
    "instanceField": "agreementId",
    "transitionField": "transitionId"
  },
  "states": {
    "funded": {"initial": true},
    "accepted": {},
    "submitted": {},
    "disputed": {},
    "refunded.clientCancellation": {"terminal": true},
    "refunded.acceptanceTimeout": {"terminal": true},
    "refunded.workTimeout": {"terminal": true},
    "refunded.arbitratorToClient": {"terminal": true},
    "released.clientApproval": {"terminal": true},
    "released.reviewTimeout": {"terminal": true},
    "released.arbitratorToContractor": {"terminal": true},
    "released.arbitrationTimeout": {"terminal": true}
  },
  "transitions": {
    "acceptAgreement": {
      "route": "acceptAgreement",
      "from": ["funded"],
      "to": ["accepted"]
    }
  }
}
```

Factory/instantiation metadata may be added later, but it should not be forced
into the first graph schema.

Do not add executable actor/time guards to the resource. The division remains:

```text
machine resource declares possible labelled edges
actor-specific observation declares currently enabled edges
contract write functions enforce guards and effects
receipt event witnesses the transition that actually executed
```

The graph is actor-independent; the enabled set is actor- and observation-
specific. A future resource/runtime must preserve that distinction rather than
mistaking one account's disabled edge for a globally impossible transition.

## Honest Static-Conformance Boundary

Machine-aware conformance can prove graph and declaration properties:

### Graph integrity

- state and transition IDs are unique;
- all source/target states exist;
- exactly one initial stored state exists;
- terminal states have no declared outgoing edges;
- all states and transitions are graph-reachable.

### Route and ABI binding

- the observation route exists and is read-only;
- every transition references an existing write route;
- each route calls the expected exact function;
- each transition route continues to the canonical observation route;
- continuation inputs preserve the agreement ID;
- payable routes satisfy CAM value and ABI rules;
- observation expressions resolve to the required ABI shapes;
- the declared transition event exists in the ABI with compatible fields.

### UI declaration binding

- every transition ID has a corresponding UI action node;
- each such node calls the declared route;
- statically known action names are declared transitions.

Static conformance cannot prove that a dynamic contract output never contains an
unknown transition, that terminal observations emit no actions, or that the
Solidity implementation reaches only declared targets. Those require runtime
checks and contract tests.

Creation instance preservation also cannot be reduced to one stored-machine
continuation check. Static conformance can verify that the create continuation
threads the same actor/reference inputs; runtime can compare previewed and
observed IDs.

## Future Runtime Verification Under Concurrency

A machine-aware viewer must remain observation-driven and race-aware.

Before submission:

1. observe the current stored instance for the current actor;
2. verify the machine, state, and transition IDs are declared;
3. verify the selected transition is declared from the observed state;
4. verify it is in the contract-projected enabled set;
5. verify it is currently rendered;
6. prepare, disclose, and simulate the exact call/value.

After submission:

1. wait for a successful receipt;
2. verify that the expected escrow contract emitted exactly one matching
   `AgreementTransitioned` event for the instance and transition ID;
3. verify the event's from/to/reason fields match the declared edge;
4. refresh through the declared continuation;
5. treat the refreshed observation as latest UI state, not necessarily the exact
   receipt-time target;
6. emit a structured trace containing both the witnessed transition and the
   latest observed state.

Another transaction may advance the agreement between the receipt and latest
reobservation. Therefore, do not require latest state to equal the immediate
target. An optional historical `eth_call` at the receipt block may provide
additional corroboration when the RPC supports it, but the canonical transition
event is the portable receipt-time witness.

A structured trace may contain:

```json
{
  "machine": "escrow.agreement.v1",
  "instance": "0x...",
  "transition": "approveAgreement",
  "from": "submitted",
  "witnessedTo": "released.clientApproval",
  "latestObserved": "released.clientApproval",
  "transaction": "0x...",
  "receiptStatus": "success"
}
```

The viewer does not become an authorization authority. The contract remains
final.

## Contract-Level Proof Obligations

Even an explicit CAM machine resource cannot prove that the bytecode implements
the declared graph.

Contract tests and invariants must prove:

- `actionsFor` is sound and complete for actor/state/time availability;
- every public transition produces the intended state, reason, beneficiary, and
  deadline;
- exact timeout functions reject all other source states;
- every stored transition emits exactly one correct canonical transition event;
- active states have deadlines bounded by `MAX_PHASE_DURATION` from phase entry;
- terminal states are irreversible;
- liabilities are conserved;
- one funded amount is not both active escrow and withdrawal credit;
- reference-derived IDs are unique under the documented scope;
- factory preview predicates agree with exact-value creation in unchanged test
  state;
- arbitration and fallback economics match the documented trust model.

The future descriptor may become common input for conformance, receipt
verification, graph visualization, and model-based tests. It does not become an
on-chain executor.

## Delivery Sequence

### Slice 1: core deterministic escrow

Branch:

```text
agent/cam-escrow-core
```

Add:

```text
dapps/escrow/
├── README.md
├── src/
│   ├── ICamEscrowView.sol
│   └── CamEscrow.sol
└── test/
    ├── support/
    │   ├── CamEscrowTestBase.sol
    │   └── NativeReceiverMocks.sol
    ├── unit/
    │   └── CamEscrow/
    │       ├── CamEscrowCreation.t.sol
    │       ├── CamEscrowActions.t.sol
    │       ├── CamEscrowSettlement.t.sol
    │       └── CamEscrowWithdrawal.t.sol
    └── scenario/
        └── CamEscrow/
            └── CamEscrowWorkflow.t.sol
```

Scope:

- view interface and core contract;
- economic/trust README;
- factory preview and exact-value creation;
- deterministic identity, action, timing, settlement, event, and accounting
  tests;
- complete workflows;
- malicious withdrawal receivers and forced-native tests.

Do not change generic CAM packages, projection code, CAM JSON, deployment
scripts, Makefile, or Compose.

### Slice 2: fuzz and stateful invariants

Branch:

```text
agent/cam-escrow-invariants
```

Prove:

```text
totalEscrowed + totalWithdrawable <= contract balance
sum(tracked active agreement amounts) == totalEscrowed
sum(tracked credits) == totalWithdrawable
active agreement => deadline != 0 and settlementReason == None
terminal agreement => deadline == 0 and settlementReason != None
terminal state and reason agree
one amount is not both active and credited
terminal states never transition again
actionsFor agrees with valid calls
transition events agree with state changes
preview agrees with exact-value creation in unchanged state
```

### Slice 3: machine-shaped projection

Branch:

```text
agent/cam-escrow-projection
```

Add `CamEscrowUI` with:

- ERC-165 backing-contract verification;
- stored `MachineView` with `instantiated` flag;
- separate factory preview view;
- stable machine/state/transition IDs;
- exact mapping from core action booleans;
- state × actor × time projection tests;
- no copied authorization logic.

### Slice 4: CAM 1.1 bundle

Branch:

```text
agent/cam-escrow-bundle
```

Add:

- CAM 1.1 root manifest;
- ABI and UI resources;
- integrity digests;
- nested creation tuple;
- `value: $inputs.params.amount`;
- factory, observation, transition, and credit routes;
- canonical stored-instance continuations;
- post-create client/reference lookup;
- publication-preflight and focused conformance tests.

### Slice 5: local vertical workflow

Branch:

```text
agent/cam-escrow-local
```

Add:

- deployment script;
- local resource service;
- browser and terminal scenarios;
- real payable creation;
- account switching;
- acceptance, submission, approval, dispute, arbitration, timeout, and
  withdrawal paths;
- stale-view/race regressions where practical.

### Slice 6: generic machine resource

Branch:

```text
agent/cam-machine-resource
```

Add a new CAM version with:

- machine namespace and resource parser;
- stored-machine graph conformance;
- route, ABI, UI, continuation, and event joins;
- actor-specific enabled-transition observation;
- receipt-event verification;
- structured traces;
- graph export;
- model-based walks.

Factory/instantiation formalization should be a separate extension unless the
stored-machine implementation demonstrates a minimal, generic shape.

## Core Deterministic Test Matrix

### Creation and identity

Test:

- exact agreement-ID formula;
- different deployments produce different IDs;
- same reference under different clients produces different IDs;
- one client cannot reuse a reference after any outcome;
- ID remains reference-scoped rather than terms-scoped;
- exact amount, underpayment, and overpayment;
- one nested amount source in the eventual route model;
- invalid and pairwise-equal role addresses;
- contractor/arbitrator equal to the escrow contract;
- contract accounts as valid contractor/arbitrator addresses;
- empty and oversized references, measured in bytes;
- empty, oversized, and zero-digest documents;
- zero and over-maximum duration for each phase;
- successful storage of immutable creation terms;
- initial deadline and accounting;
- preview field correctness and preview/create agreement in unchanged state;
- ERC-165 support and random-interface rejection.

### Action equivalence

For every active state, test at:

```text
deadline - 1
deadline
deadline + 1
```

for:

```text
client
contractor
arbitrator
unrelated account
address(0) read context
```

Using a fresh fixture per attempted transition, assert:

1. `actionsFor` returns the exact booleans;
2. the corresponding call succeeds exactly when its boolean is true, assuming a
   separately valid payload;
3. evidence-payload errors occur only after action availability succeeds.

### Complete outcomes

Test:

```text
create → cancel → client withdrawal
create → accept → submit → approve → contractor withdrawal
create → acceptance timeout → unrelated finalizer → client withdrawal
create → accept → work timeout → unrelated finalizer → client withdrawal
create → accept → submit → review timeout → unrelated finalizer → contractor withdrawal
create → accept → submit → dispute → arbitrator refunds client
create → accept → submit → dispute → arbitrator releases contractor
create → accept → submit → dispute → arbitration timeout → contractor release
```

For every path, assert state, reason, deadline, beneficiary, liabilities,
documents, and canonical event fields.

### Accounting and adversarial withdrawal

Test:

- several concurrent independent agreements;
- aggregated withdrawal credits;
- exact escrow and credit totals after every transition;
- one agreement cannot alter another;
- terminal agreements reject all transitions;
- failed recipient transfers restore accounting;
- reentrant recipients cannot double-withdraw;
- alternate withdrawal recipient;
- zero/self recipient rejection;
- beneficiary contract that can redirect but cannot receive directly;
- direct transfer rejection;
- unknown-selector rejection;
- forced native value increases balance but not liabilities.

### Transition-event witness

Test:

- exactly one canonical transition event per stored transition;
- exact transition ID hash;
- exact source and target states;
- exact settlement reason;
- exact actor and next deadline;
- no stored-machine transition event for factory creation;
- no agreement transition event for withdrawal.

## First-Slice Acceptance Gate

The core slice is ready only when:

1. Creation uses one nested amount source and binds calldata amount to native
   value.
2. Creation is treated as factory instantiation, not a fake `none`-state edge.
3. Agreement IDs are documented accurately as client/reference keys, not terms
   commitments.
4. Every phase duration is bounded by explicit V1 policy.
5. Every active state has one exact deadline.
6. Every timeout has its own public function and outcome.
7. Arbitrator inactivity cannot lock funds indefinitely.
8. Client cancellation protects mistaken unaccepted offers.
9. External evidence is content-committed with SHA-256.
10. Core action availability and write guards share one predicate.
11. `actionsFor` and actual actor/state/time availability agree.
12. Missing agreements are ordinary absent observations.
13. Terminal state and settlement reason cannot disagree.
14. Settlement moves liabilities exactly once.
15. Failed or reentrant withdrawals cannot lose or duplicate credit.
16. Forced native value cannot corrupt liabilities.
17. Every stored transition emits one canonical receipt-time witness.
18. The read interface is ERC-165 discoverable.
19. No generic CAM package changes appear in the branch.

## Explicit Non-Goals

V1 intentionally omits:

- decentralized or neutral arbitration guarantees;
- arbitrator consent/acknowledgement;
- arbitrator compensation;
- appeals;
- partial or split awards;
- multiple milestones;
- ERC-20 payments;
- application fees;
- amendments;
- contractor resubmission or counter-evidence rounds;
- contractor decline;
- relayers or meta-transactions;
- agreement enumeration and search;
- reputation;
- privacy;
- automatic execution;
- administrative recovery;
- emergency pause;
- upgrades.

## Rejected Alternatives

### Unfunded `Created` state

Rejected because it creates permanent unfunded records, adds a transaction, and
weakens the payable CAM test.

### Generic timeout function

Rejected because it weakens route/effect binding and future graph verification.

### Terms-bound agreement ID

Rejected because readable reference lookup and permanent reference uniqueness
are more useful for V1. Terms remain stored and reviewed separately. Revisit
only if content-addressed agreements become a product requirement.

### `expectedAgreementId` creation argument

Rejected because it binds only the reference-derived key, adds stale-preview
failure modes, and is unnecessary when the continuation uses client/reference
lookup.

### Duplicate top-level amount route input

Rejected because `$inputs.params.amount` can source both calldata and native
value directly.

### Executable CAM guard language

Rejected because it would duplicate contract authorization, timestamp,
comparison, and error semantics.

### Latest-state equality as transition proof

Rejected because concurrent transactions may validly advance the instance before
reobservation. Use receipt-time transition evidence and latest-state refresh for
different purposes.

### Treating withdrawal as an agreement state

Rejected because withdrawal credits aggregate across agreements and belong to an
account-level workflow.

## Final Architectural Position

The target relationship is:

> CAM declares the stored labelled transition system; an actor-specific contract
> observation declares currently enabled edges; the contract enforces guards,
> effects, and accounting; a canonical receipt event witnesses the executed edge;
> and the generic viewer refreshes latest state without confusing it with the
> exact receipt-time postcondition.

Under CAM 1.1, this is a disciplined application convention. The escrow core,
projection IDs, exact routes, canonical events, and observations should be built
so a later machine resource makes the convention explicit rather than requiring
an application rewrite.
