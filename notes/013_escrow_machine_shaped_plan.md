# Machine-Shaped Escrow and CAM State-Machine Path

Date: 2026-07-26

Status: proposed implementation plan and current next-work note.

Purpose: define a second contract-defined application that exercises CAM 1.1
native transaction values, multi-actor timed workflows, pull-payment accounting,
and dynamic action projection. Shape the application so it can later become the
first explicit CAM machine fixture without redesigning the Solidity API or CAM
bundle.

## Decision Summary

Build a single-milestone native-asset escrow as a machine-shaped CAM 1.1
application.

The responsibility boundary is:

```text
CamEscrow
    owns state, deadlines, authorization, settlement, accounting, and exact
    transition availability

CamEscrowUI
    reads CamEscrow and maps contract facts to stable semantic machine, state,
    view, authority, and transition IDs

CAM 1.1 bundle
    binds transition IDs to explicit routes, contract calls, native values,
    inputs, and canonical post-write continuations

Generic viewer
    permits only actions rendered from the current observation, prepares and
    simulates the declared call, submits it, then re-observes the agreement

Future CAM machine resource
    declares the labelled transition graph and lets conformance/viewers verify
    source states, target states, terminality, instance preservation, and
    observed enabled transitions
```

Do not add the CAM machine resource before the escrow works end to end under CAM
1.1. Do choose all application IDs and route boundaries now so the later machine
resource is additive.

## Why Escrow Is the Next Application

Bike NFT exercises read projections, permissions, dynamic views, ordinary write
routes, and local deployment. Escrow adds materially different pressure:

- a payable CAM 1.1 creation route;
- the same amount crossing both calldata and the transaction-value envelope;
- multiple actors with different enabled transitions;
- state-dependent deadlines and permissionless timeout finalization;
- externally referenced evidence with immutable content commitments;
- liabilities that move from active escrow to withdrawal credits;
- workflow state that may change outside the current viewer;
- a clear future labelled-transition-system model.

The escrow is a protocol-validation application, not a complete commercial
arbitration product.

## Product Model

The application is a:

> Single-milestone, native-asset, trusted-arbitrator escrow with client
> cancellation before acceptance and bounded optimistic settlement.

Participants:

- **client**: creates and funds the agreement;
- **contractor**: accepts, performs, submits, and receives payment on approval or
  contractor-favoring timeout;
- **arbitrator**: chooses the beneficiary only after a client dispute;
- **finalizer**: any connected account may execute an already predetermined
  timeout outcome.

The arbitrator is selected by the client and accepted implicitly by the
contractor when the contractor accepts. The contract cannot establish the
arbitrator's neutrality, competence, or availability. The arbitrator may be an
EOA, Safe, DAO executor, or another contract; do not require deployed code.

The contract is:

- non-upgradeable;
- administrator-free;
- native-asset only;
- single-milestone;
- pull-payment based;
- explicit about every timeout outcome.

## State Machine

```text
None
  │
  │ createAgreement + exact native value
  ▼
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
agreement amount has been credited to a beneficiary for withdrawal, not
necessarily that the beneficiary has already transferred the native value out of
the contract.

### Arbitration timeout outcome

An arbitration timeout releases the amount to the contractor.

This is deliberate:

- before a dispute, client inaction after submission already leads to contractor
  payment;
- the client must not gain an indefinite veto merely by opening a dispute;
- refund-on-arbitrator-inactivity would let a client choose an inert arbitrator,
  dispute every submission, and recover the amount;
- a split fallback is arbitrary and introduces partial-settlement accounting
  without an objective rule.

The contractor sees the arbitrator and arbitration duration before accepting.

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
and all timeout functions.

Every nonterminal stored state has exactly one finite active deadline:

| State | Active deadline |
|---|---|
| `Funded` | acceptance deadline |
| `Accepted` | work deadline |
| `Submitted` | review deadline |
| `Disputed` | arbitration deadline |
| terminal | zero |

Read the current timestamp once per transition:

```solidity
uint48 now_ = _now48();
agreement.updatedAt = now_;
agreement.deadline = _deadlineAfter(now_, duration);
```

Do not call separate timestamp helpers for `updatedAt` and `deadline` even though
the block timestamp cannot change within one transaction.

## Use Exact Public Timeout Functions

Expose one public Solidity function per semantic timeout transition:

```solidity
function finalizeAcceptanceTimeout(bytes32 agreementId) external;
function finalizeWorkTimeout(bytes32 agreementId) external;
function finalizeReviewTimeout(bytes32 agreementId) external;
function finalizeArbitrationTimeout(bytes32 agreementId) external;
```

The functions may share private machinery, but each public function validates
one exact source state and produces one exact settlement reason.

Do not expose only a generic `finalizeExpiredAgreement` function. A generic
function would weaken the binding between a CAM route name and its actual effect:
a route named `finalizeReviewTimeout` could invoke the generic function while the
agreement was `Funded` and produce an acceptance-timeout refund.

The exact API gives a one-to-one relationship:

```text
CAM transition ID
    ↔ CAM route
    ↔ Solidity function
    ↔ source state
    ↔ settlement outcome
```

## Agreement Identity

Use a deployment-scoped, client-scoped deterministic agreement ID:

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
- the ID is available before creation executes;
- every later mutation uses one compact `bytes32`;
- CAM continuations do not depend on transaction return values;
- the same client cannot reuse a reference, including after settlement.

Do not include `block.chainid` in the storage-key formula. A later chain-ID
change must not make reference lookup compute a different key for existing
storage. The externally complete identity remains:

```text
chain ID + escrow contract address + agreement ID
```

Agreement references are exact byte strings. The contract does not trim,
case-fold, or Unicode-normalize them.

## Bind Creation to the Expected Machine Instance

Creation accepts the prospective instance ID:

```solidity
function createAgreement(
    bytes32 expectedAgreementId,
    CreateAgreementParams calldata params
) external payable;
```

The contract recomputes the ID from `address(this)`, `msg.sender`, and
`params.agreementRef`, and rejects a mismatch:

```solidity
error UnexpectedAgreementId(bytes32 expected, bytes32 actual);
```

The same ID is used by the future CAM route for:

1. the contract call;
2. the post-write continuation;
3. the machine instance being observed.

If a manifest, caller, or integration error supplies an ID that does not
correspond to the terms, creation reverts instead of creating one instance and
navigating to another.

## Bind Declared Amount to Native Value

Retain an explicit amount in the creation parameters and require exact native
value:

```solidity
if (params.amount == 0) revert ZeroAmount();

if (msg.value != params.amount) {
    revert UnexpectedNativeAmount(params.amount, msg.value);
}
```

The redundancy is useful. It binds the economic term declared in calldata to
the transaction envelope. The future CAM route carries the same input through
both channels:

```json
{
  "value": "$inputs.amount",
  "call": {
    "args": {
      "params": {
        "amount": "$inputs.amount"
      }
    }
  }
}
```

A disagreement between the reviewed terms and the native value must fail at the
contract boundary.

## Content-Committed Evidence

Do not store mutable external documents as bare URIs.

Use:

```solidity
struct DocumentRef {
    string uri;
    bytes32 sha256Digest;
}
```

The digest is SHA-256 over the exact referenced bytes. The contract cannot fetch
or verify the document, but it records an immutable content commitment that
participants and generic clients can verify.

Each agreement may store:

```solidity
DocumentRef terms;
DocumentRef submission;
DocumentRef dispute;
DocumentRef resolution;
```

Recommended limits:

```solidity
uint256 public constant MAX_AGREEMENT_REF_BYTES = 128;
uint256 public constant MAX_DOCUMENT_URI_BYTES = 512;
```

Validate every supplied document:

```text
URI nonempty
URI byte length <= MAX_DOCUMENT_URI_BYTES
digest != bytes32(0)
```

Absent documents use the default empty URI and zero digest.

The contract does not parse or restrict URI schemes. Navigation and supported
scheme policy belong to clients; the digest is the immutable authority.

All actors, amounts, references, deadlines, URIs, and digests are public.
Sensitive material should be encrypted off-chain before publication.

## Creation Tuple

Use nested tuples rather than a long positional signature:

```solidity
struct CreateAgreementParams {
    string agreementRef;

    address contractor;
    address arbitrator;

    uint256 amount;

    uint48 acceptanceDuration;
    uint48 workDuration;
    uint48 reviewDuration;
    uint48 arbitrationDuration;

    DocumentRef terms;
}
```

Creation validation requires:

```text
agreement reference nonempty and <= 128 bytes
contractor nonzero
arbitrator nonzero
client, contractor, and arbitrator pairwise distinct
contractor != address(this)
arbitrator != address(this)
amount > 0
msg.value == amount
all four durations > 0
terms document valid
agreement ID unused
first deadline representable as uint48
expected agreement ID exact
```

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

This protects the client from a mistaken contractor, arbitrator, amount, or
terms reference before the contractor accepts. Once accepted, unilateral
cancellation is no longer available.

No contractor-decline operation is needed in V1. The contractor may leave the
offer unaccepted; the client may cancel before the deadline or finalize an
acceptance-timeout refund afterward.

## Core-Owned Transition Availability

The projection must not reimplement actor, state, deadline, or terminality
rules.

The read interface exposes action availability with one field per agreement
transition:

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

### `Funded`, before deadline

```text
client      → cancelAgreement
contractor  → acceptAgreement
```

### `Funded`, deadline reached

```text
any nonzero actor → finalizeAcceptanceTimeout
```

### `Accepted`, before deadline

```text
contractor → submitAgreement
```

### `Accepted`, deadline reached

```text
any nonzero actor → finalizeWorkTimeout
```

### `Submitted`, before deadline

```text
client → approveAgreement
client → disputeAgreement
```

### `Submitted`, deadline reached

```text
any nonzero actor → finalizeReviewTimeout
```

### `Disputed`, before deadline

```text
arbitrator → resolveForClient
arbitrator → resolveForContractor
```

### `Disputed`, deadline reached

```text
any nonzero actor → finalizeArbitrationTimeout
```

### Terminal, missing, or disconnected actor

All agreement-transition fields are false. In particular, `actor == address(0)`
means no connected account and therefore no write transition.

Use one internal action computation:

```solidity
function _actionsFor(
    Agreement storage agreement,
    address actor,
    uint48 now_
) private view returns (AgreementActions memory);
```

Every public transition calls the same function before mutation. This makes the
public `actionsFor` result and the actual actor/state/time preconditions share
one implementation.

Payload validation remains separate. For example, `submitAgreement == true`
means that actor, state, and time permit submission; an invalid `DocumentRef`
still produces a document-validation error.

A stable structured transition error may use:

```solidity
error ActionUnavailable(
    bytes32 agreementId,
    AgreementAction action,
    address actor,
    AgreementState state,
    uint48 deadline,
    uint48 currentTime
);
```

## Creation Preview

Creation is the one transition whose source is a prospective, not-yet-stored
instance.

Expose a non-reverting preview:

```solidity
struct CreateAgreementPreview {
    bytes32 agreementId;
    bool canCreateWithExactValue;
}

function previewCreateAgreement(
    address actor,
    CreateAgreementParams calldata params
) external view returns (CreateAgreementPreview memory);
```

It computes the prospective ID and checks all creation preconditions except the
transaction-envelope fact `msg.value == params.amount`.

The boolean means:

> This actor and parameter set are structurally creatable if the transaction
> supplies exactly `params.amount` native units.

`createAgreement` reuses the same internal validation and adds the native-value
check.

This lets the future projection represent a real prospective machine state:

```text
stateId       = none
instanceId    = prospective agreement ID
transitionIds = [createAgreement] only when preview allows it
```

## Read-Only ERC-165 Interface

Add:

```text
dapps/escrow/src/ICamEscrowView.sol
```

The interface extends `IERC165` and owns the reader-facing enums, structures,
and read functions:

- `DocumentRef`;
- `CreateAgreementParams`;
- `CreateAgreementPreview`;
- `AgreementState`;
- `SettlementReason`;
- `AgreementView`;
- `AgreementActions`;
- identity, preview, observation, action, withdrawal-credit, and liability reads.

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

    uint48 acceptanceDuration;
    uint48 workDuration;
    uint48 reviewDuration;
    uint48 arbitrationDuration;

    uint48 createdAt;
    uint48 updatedAt;
    uint48 deadline;
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

A missing agreement is a valid observation and must not revert:

```text
agreementId = requested or computed ID
exists = false
state = None
all remaining fields = defaults
```

## Contract API

```solidity
function createAgreement(
    bytes32 expectedAgreementId,
    CreateAgreementParams calldata params
) external payable;

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
upgradeability. No external calls during agreement transitions or settlement.
The only external native-value call occurs during withdrawal.

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

Use two private terminal helpers rather than one helper that accepts arbitrary
terminal state/reason combinations:

```solidity
function _refundClient(
    bytes32 agreementId,
    Agreement storage agreement,
    SettlementReason reason,
    address actor
) private;

function _releaseContractor(
    bytes32 agreementId,
    Agreement storage agreement,
    SettlementReason reason,
    address actor
) private;
```

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
beneficiary withdrawal credit increases by amount
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

The inequality is intentional because native value can be forcibly sent without
invoking `receive` or `fallback`.

Reject withdrawal when:

```text
recipient == address(0)
recipient == address(this)
caller has no withdrawal credit
```

The caller always withdraws its complete credit but may select another
recipient. This prevents a smart-account beneficiary from trapping funds merely
because its own receive function rejects native value.

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

## Events

Use lifecycle-specific evidence events and one canonical terminal event:

```solidity
event AgreementCreated(...);
event AgreementAccepted(...);
event AgreementSubmitted(...);
event AgreementDisputed(...);
event AgreementResolved(...);

event AgreementSettled(
    bytes32 indexed agreementId,
    address indexed actor,
    address indexed beneficiary,
    AgreementState terminalState,
    SettlementReason reason,
    uint256 amount
);

event Withdrawal(
    address indexed account,
    address indexed recipient,
    uint256 amount
);
```

Document-bearing events include URI and SHA-256 digest. Do not force optional
resolution data into timeout or cancellation events merely to maintain one
oversized signature.

## Machine-Shaped Projection

A later `CamEscrowUI` contract returns:

```solidity
struct MachineView {
    string machineId;
    bytes32 instanceId;
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
none
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

Stable transition IDs equal CAM write-route names:

```text
createAgreement
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

The projection maps exact core action booleans to the exact transition IDs. It
performs no role, state, deadline, or terminality calculation.

It may map Solidity enums to semantic IDs, choose display views, identify the
current actor role, and include account-level withdrawal information.

## Agreement and Withdrawal Are Separate Workflows

`withdrawTo` does not change one agreement's lifecycle state. One account credit
may aggregate settlements from several agreements.

Do not model:

```text
Released → Withdrawn
```

inside the agreement machine.

For CAM 1.1, treat `withdrawTo` as an auxiliary account-level route. A later
protocol may model it as a separate credit machine or as an orthogonal machine
region, but the first agreement machine should remain instance-local.

## Canonical CAM 1.1 Routes

The future bundle should contain:

### Canonical stored-instance observation

```text
agreement(agreementId)
```

Every stored agreement transition continues to this route with the same
`agreementId`.

### Readable lookup

```text
lookupAgreement(client, agreementRef)
```

It computes/displays the deterministic instance ID and the current agreement
observation.

### Prospective creation observation

```text
createAgreementPreview(params)
```

It returns the prospective instance ID, `none` machine state, and whether
creation is structurally available with exact value.

### Agreement transition routes

Each transition gets a CAM write route whose name equals its transition ID and
whose call targets the corresponding exact Solidity function.

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

Creation uses the same-instance rule:

```json
{
  "createAgreement": {
    "kind": "write",
    "inputs": ["agreementId", "params", "amount"],
    "value": "$inputs.amount",
    "call": {
      "namespace": "contracts.CamEscrow",
      "function": "createAgreement",
      "args": {
        "expectedAgreementId": "$inputs.agreementId",
        "params": "$inputs.params"
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

The reviewed `amount` must be the same value represented inside `params.amount`.
The contract equality check is the final authority if a malformed bundle or
direct caller supplies inconsistent values.

## What CAM 1.1 Provides

Without an explicit machine resource, CAM 1.1 still provides:

- hash-pinned route and UI declarations;
- closed-world route/resource parsing;
- ABI-compatible nested tuple arguments;
- exact native transaction value;
- simulation and wallet submission;
- a declared post-write continuation;
- dispatch only from the currently rendered action set;
- re-observation through the canonical agreement route.

The application can therefore expose a clean machine envelope today:

```text
machine ID
instance ID
state ID
enabled transition IDs
```

This is an operational state machine by convention, not yet a CAM-level formal
declaration.

## What CAM 1.1 Does Not Prove

CAM 1.1 does not declare or prove:

- that `funded` is a machine state;
- that `acceptAgreement` has source `funded`;
- that its target must be `accepted`;
- that terminal states have no outgoing transitions;
- that a transition's continuation observes the same machine instance;
- that every observed transition ID belongs to a declared graph;
- that a successful write reached one of the declared target states.

The contract and its tests remain the authority for state-machine correctness.

## Future CAM Machine Resource

After the CAM 1.1 escrow bundle works, introduce a hash-pinned machine namespace
in a new CAM version:

```json
{
  "machines.EscrowAgreement": {
    "type": "machine",
    "uri": "./escrow-agreement.machine.json",
    "integrity": "sha256:0x..."
  }
}
```

The machine resource declares:

- machine schema version and machine ID;
- canonical observation route;
- instance-expression binding;
- state-expression binding;
- enabled-transition-expression binding;
- initial state;
- terminal states;
- transition IDs;
- transition source states;
- transition target states;
- route binding.

Illustrative shape:

```json
{
  "machine": "1.0.0",
  "id": "escrow.agreement.v1",
  "observe": {
    "route": "agreement",
    "instance": "$outputs.0.machine.instanceId",
    "state": "$outputs.0.machine.stateId",
    "enabled": "$outputs.0.machine.transitionIds"
  },
  "states": {
    "none": {"initial": true},
    "funded": {},
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

Do not add executable actor/time guards to the machine resource. A CAM guard
language would duplicate Solidity authorization and require comparison,
arithmetic, timestamp, missing-value, and error semantics. The correct division
is:

```text
machine resource declares possible labelled edges
contract projection declares currently enabled edges for this actor and instance
contract write functions enforce guards and effects
viewer verifies observed execution against the declared graph
```

## Future Static Conformance

Machine-aware conformance should be able to prove:

### Graph integrity

- all state and transition IDs are unique;
- every source and target state exists;
- an initial state exists;
- terminal states have no outgoing transitions;
- nonterminal states are reachable from the initial state;
- dead states and transitions are reported.

### Route binding

- the observation route exists and is a read route;
- each transition references an existing write route;
- each transition route continues to the canonical observation route;
- route inputs can supply the observation instance input;
- payable transitions satisfy CAM value rules;
- transition route names and machine IDs are unambiguous.

### ABI and observation binding

- instance resolves to a supported stable identifier type;
- state resolves to `string`;
- enabled transitions resolve to `string[]`;
- route arguments and outputs remain ABI-compatible.

### UI binding

- every transition has a matching UI action node;
- each matching action calls the declared route;
- statically known actions do not call undeclared transitions;
- terminal state views do not expose agreement transitions.

### Instance preservation

- each transition continuation observes the same logical instance;
- creation binds the prospective instance used in the call to the instance used
  in the continuation.

## Future Runtime Verification

A machine-aware viewer should remain observation-driven. It must not treat local
workflow state as authoritative because another wallet may mutate the agreement.

A transition execution should:

1. run the canonical observation route;
2. extract machine ID, instance ID, state ID, and enabled transition IDs;
3. reject unknown state or transition IDs;
4. verify that the selected transition is declared from the observed state;
5. verify that it is contract-projected as enabled;
6. verify that it is present in the currently rendered UI;
7. prepare and disclose the declared call and native value;
8. simulate and submit it;
9. wait for a successful receipt;
10. execute the declared continuation;
11. reobserve the same instance;
12. verify that the resulting state is among the declared targets;
13. emit a structured transition trace.

Example trace:

```json
{
  "machine": "escrow.agreement.v1",
  "instance": "0x...",
  "transition": "approveAgreement",
  "from": "submitted",
  "to": "released.clientApproval",
  "transaction": "0x...",
  "receiptStatus": "success"
}
```

The viewer still does not become the authorization authority. The contract write
function remains final.

## Contract-Level Proof Obligations

Even an explicit CAM machine resource cannot prove that the Solidity bytecode
implements the declared graph.

Contract tests and invariants must prove:

- action projection is sound and complete;
- every transition produces the intended state and settlement reason;
- no hidden or invalid path mutates the agreement;
- active states always have finite deadlines;
- terminal states are irreversible;
- liabilities are conserved;
- one funded amount cannot be both active escrow and withdrawal credit;
- timeout functions match exact source states;
- the arbitrator and fallback economics match the documented model.

The future machine descriptor should become common input for conformance,
runtime verification, graph visualization, and model-based contract tests. It
does not become the on-chain state-machine executor.

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

- core interface and contract;
- economic and trust-assumption README;
- exhaustive deterministic action/state/time tests;
- complete workflow scenarios;
- malicious withdrawal receivers and forced-native tests.

Do not change generic CAM packages, projection code, CAM JSON, deployment scripts,
Makefile, or Compose.

### Slice 2: fuzz and stateful invariants

Branch:

```text
agent/cam-escrow-invariants
```

Prove:

```text
totalEscrowed + totalWithdrawable <= contract balance
sum(active agreement amounts) == totalEscrowed
sum(tracked withdrawal credits) == totalWithdrawable
active agreement => deadline != 0 and settlementReason == None
terminal agreement => deadline == 0 and settlementReason != None
terminal state and settlement reason agree
one funded amount is not both active and credited
terminal states never transition again
actionsFor agrees with actual call availability
previewCreateAgreement agrees with exact-value creation
```

### Slice 3: machine-shaped projection

Branch:

```text
agent/cam-escrow-projection
```

Add `CamEscrowUI` with:

- ERC-165 backing-contract verification;
- `MachineView`;
- stable machine/state/transition IDs;
- exact mapping from core action booleans;
- prospective `none` projection;
- state × actor × time projection tests;
- no copied authorization logic.

### Slice 4: CAM 1.1 bundle

Branch:

```text
agent/cam-escrow-bundle
```

Add:

- CAM 1.1 root manifest;
- ABI resources;
- UI resource;
- integrity digests;
- nested creation tuple;
- exact native value;
- one route per transition;
- canonical same-instance agreement continuations;
- auxiliary withdrawal route;
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
- acceptance, submission, approval, dispute, arbitration, timeout, and withdrawal
  paths.

### Slice 6: generic machine resource

Branch:

```text
agent/cam-machine-resource
```

Add a new CAM version with:

- machine namespace and resource parser;
- graph conformance;
- route, ABI, UI, and continuation joins;
- pre/post-observation runtime verification;
- structured transition traces;
- graph export;
- model-based walks.

## Core Deterministic Test Matrix

### Creation and identity

Test:

- exact agreement ID formula;
- different escrow deployments produce different IDs;
- same reference under different clients produces different IDs;
- one client cannot reuse a reference after any outcome;
- expected agreement ID mismatch;
- exact amount, underpayment, and overpayment;
- invalid or pairwise-equal actors;
- actor equal to the escrow contract;
- empty and oversized references;
- empty, oversized, or zero-digest documents;
- zero duration for each phase;
- deadline overflow;
- successful storage of all immutable creation terms;
- initial deadline and accounting;
- ERC-165 support and random-interface rejection.

### Action equivalence matrix

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

Assert both:

1. `actionsFor` returns the exact booleans;
2. a transition succeeds exactly when its corresponding boolean is true, subject
   only to separately valid payload data.

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

### Accounting and adversarial withdrawal

Test:

- several concurrent independent agreements;
- aggregated withdrawal credits;
- exact escrow and withdrawal totals after every transition;
- one agreement cannot alter another;
- terminal agreements reject all transitions;
- failed recipient transfers restore accounting;
- reentrant recipients cannot double-withdraw;
- alternate withdrawal recipient;
- zero/self recipient rejection;
- direct transfer rejection;
- unknown-selector rejection;
- forced native value increases balance but not liabilities.

## First-Slice Acceptance Gate

The core slice is ready only when:

1. Creation binds expected instance ID, declared amount, and native value.
2. Every active stored state has one exact finite deadline.
3. Every timeout has its own public function and exact documented outcome.
4. Arbitrator inactivity cannot lock funds indefinitely.
5. Client cancellation protects mistaken unaccepted offers.
6. External evidence is content-committed with SHA-256.
7. The core contract owns exact transition availability.
8. `actionsFor` and actual actor/state/time call availability agree.
9. Missing agreements are observable as `None` rather than exceptional.
10. Terminal state and settlement reason cannot disagree.
11. Settlement moves liabilities exactly once.
12. Failed or reentrant withdrawals cannot lose or duplicate credit.
13. Forced native value cannot corrupt liabilities.
14. The read interface is ERC-165 discoverable.
15. No generic CAM package changes appear in the branch.

## Explicit Non-Goals

V1 intentionally omits:

- decentralized or neutral arbitration guarantees;
- arbitrator compensation;
- appeals;
- partial or split awards;
- multiple milestones;
- ERC-20 payments;
- application fees;
- amendments;
- contractor resubmission;
- contractor decline;
- relayers or meta-transactions;
- agreement enumeration and search;
- reputation;
- privacy;
- automatic execution;
- administrative recovery;
- emergency pause;
- upgrades.

The absence of an arbitrator fee is explicit: V1 assumes that the arbitrator is
motivated or compensated out of band.

## Final Architectural Position

The target relationship is:

> CAM declares the labelled transition system; the contract projection declares
> the currently enabled edges; the contract enforces guards and effects; and the
> generic viewer verifies that successful executions refine the declared graph.

Under CAM 1.1, this remains a disciplined application convention. The escrow
core, projection IDs, exact routes, and canonical continuations should be built
so that a later machine resource makes the convention explicit rather than
requiring an application rewrite.
