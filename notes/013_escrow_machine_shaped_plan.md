# Machine-Shaped Escrow and CAM State-Machine Path

Date: 2026-07-26

Status: audited implementation plan and current next-work note.

Purpose: define the smallest credible second dapp that exercises CAM 1.1 native
transaction values, nested ABI inputs, actor-specific actions, timed transitions,
and pull-payment accounting. Shape the stored agreement workflow so a future CAM
machine resource can describe it without making the Solidity contract depend on
CAM route names or speculative protocol syntax.

## Decision

Build a single-milestone, native-asset escrow with a designated arbitrator.

Keep three scopes separate:

1. **Factory operation**: the client creates and funds an agreement.
2. **Stored agreement machine**: one funded agreement moves through acceptance,
   submission, dispute, and settlement.
3. **Account credit workflow**: beneficiaries withdraw credits aggregated across
   agreements.

Only the stored agreement is the first explicit CAM-machine candidate. Creation
instantiates it in `Funded`; withdrawal is account-level and must not become an
agreement state.

The responsibility boundary is:

```text
CamEscrow
    owns agreement state, deadlines, actor authorization, enabled actions,
    document commitments, settlement, liabilities, and state-change events

CamEscrowUI
    reads CamEscrow and maps contract facts to stable machine, state, authority,
    view, and transition IDs

CAM 1.1 bundle
    binds UI actions to explicit routes, nested arguments, native value, and
    post-write observations

Generic viewer
    executes only currently rendered actions, reviews and simulates the exact
    call/value, submits it, and refreshes current chain state

Future CAM machine resource
    declares the stored state graph and binds observations and transition routes
    after the CAM 1.1 vertical slice proves the required shape
```

Do not implement the generic machine resource while building the escrow. Fix the
application's state IDs, transition IDs, route boundaries, and observation shape
now; let the working application reveal what a generic descriptor actually needs.

## Why Retain Arbitration

A simpler two-party optimistic payment would test CAM, but it would not be a
credible escrow: after a bad submission, the client would have no way to prevent
payment except by relying on the contractor's cooperation.

A designated arbitrator is therefore retained because it is an intrinsic domain
concept, not because CAM needs a third actor. It adds one active state and four
transitions, but gives the client a real dispute path and gives the application a
meaningful multi-actor workflow.

V1 does not establish neutral arbitration:

- the client chooses the arbitrator;
- the contractor accepts that choice by accepting the agreement;
- the arbitrator gives no on-chain acknowledgement;
- address separation does not prove organizational independence;
- arbitrator compensation is out of band;
- there is no appeal or partial award.

If the arbitrator does not rule before the arbitration deadline, payment is
released to the contractor. This is intentionally contractor-favoring. A dispute
must not turn the client's pre-existing review deadline into an indefinite veto,
and refund-on-arbitrator-inactivity would let a client select an inert arbitrator
and recover every disputed payment.

This policy is a product assumption, not a neutral theorem. The client must choose
an available arbitrator, and the contractor must decide whether to accept those
terms.

## Stored Agreement State Machine

Use one state enum whose terminal members encode the outcome directly. Do not
store a generic terminal state plus a second settlement-reason enum; that would
create representable but invalid combinations.

```solidity
enum AgreementState {
    None,
    Funded,
    Accepted,
    Submitted,
    Disputed,
    CancelledByClient,
    RefundedAfterAcceptanceTimeout,
    RefundedAfterWorkTimeout,
    RefundedByArbitrator,
    ReleasedByClientApproval,
    ReleasedAfterReviewTimeout,
    ReleasedByArbitrator,
    ReleasedAfterArbitrationTimeout
}
```

The graph is:

```text
Factory create + exact native value
  └────────────────────────────────────────────────────► Funded

Funded
  ├── client cancels before deadline ──────────────────► CancelledByClient
  ├── contractor accepts before deadline ──────────────► Accepted
  └── acceptance deadline reached ─────────────────────► RefundedAfterAcceptanceTimeout

Accepted
  ├── contractor submits before deadline ──────────────► Submitted
  └── work deadline reached ───────────────────────────► RefundedAfterWorkTimeout

Submitted
  ├── client approves before deadline ─────────────────► ReleasedByClientApproval
  ├── client disputes before deadline ─────────────────► Disputed
  └── review deadline reached ─────────────────────────► ReleasedAfterReviewTimeout

Disputed
  ├── arbitrator rules for client before deadline ─────► RefundedByArbitrator
  ├── arbitrator rules for contractor before deadline ─► ReleasedByArbitrator
  └── arbitration deadline reached ────────────────────► ReleasedAfterArbitrationTimeout
```

All outcome states are terminal. A terminal state means the agreement amount has
become a beneficiary's withdrawal credit; it does not mean the native value has
already left the contract.

### Time semantics

Use one boundary everywhere:

```text
ordinary transition available: block.timestamp < deadline
timeout transition available:  block.timestamp >= deadline
```

Thus ordinary and timeout transitions are never simultaneously valid.

Every active stored state has exactly one deadline:

| State | Deadline |
|---|---|
| `Funded` | acceptance deadline |
| `Accepted` | work deadline |
| `Submitted` | review deadline |
| `Disputed` | arbitration deadline |
| terminal or absent | zero |

Pin a V1 policy bound:

```solidity
uint64 public constant MAX_PHASE_DURATION = 365 days;
```

Each configured duration must be in `[1, MAX_PHASE_DURATION]`. Store durations as
`uint64` and the active deadline as `uint256`. When a transition starts a phase:

```solidity
agreement.deadline = block.timestamp + duration;
```

Checked Solidity arithmetic owns overflow rejection. No timestamp downcast or
custom timestamp range is needed.

### Transaction ordering

Client cancellation and contractor acceptance intentionally compete while the
agreement is `Funded`. If both transactions are submitted, chain ordering decides
which succeeds; the second sees a terminal or `Accepted` state and reverts.

The projection, simulation, and wallet review reduce stale-action risk but cannot
promise transaction ordering. This is ordinary optimistic-concurrency behavior,
not a condition to hide behind additional reservation states.

## Agreement Identity

Use a client-scoped deterministic key within the escrow contract:

```solidity
agreementId = keccak256(abi.encode(client, agreementRef));
```

Expose:

```solidity
function agreementIdOf(
    address client,
    string calldata agreementRef
) external pure returns (bytes32);
```

The contract address already scopes storage. Including `address(this)`, a domain
constant, or `block.chainid` inside the hash would be redundant for contract
storage and would complicate reasoning about external identity.

The externally complete identity is:

```text
chain ID + escrow contract address + agreement ID
```

The ID is a lookup key, not a commitment to all terms. It binds only the client
and exact reference bytes. Contractor, arbitrator, amount, durations, and
documents are separately reviewed calldata and stored state.

References are byte-exact. The contract does not trim, case-fold, or Unicode-
normalize them. The same client cannot reuse a reference after any outcome;
different clients may use the same reference.

## Content-Committed Documents

Terms, submissions, disputes, and explicit arbitration resolutions use:

```solidity
struct DocumentRef {
    string uri;
    bytes32 sha256Digest;
}
```

The URI is a locator. The digest identifies the exact canonical application bytes
that participants should verify before relying on the document. The contract does
not retrieve or verify those bytes and does not validate URI schemes.

Pin bounded state:

```solidity
uint256 public constant MAX_AGREEMENT_REF_BYTES = 128;
uint256 public constant MAX_DOCUMENT_URI_BYTES = 512;
```

Every supplied document requires:

```text
non-empty URI
URI byte length <= MAX_DOCUMENT_URI_BYTES
nonzero SHA-256 digest
```

Before the corresponding transition, an optional document field remains the
zero/default struct.

The commitment proves byte identity, not legal validity, comprehension, or
consent. All addresses, values, references, deadlines, URIs, and digests are
public. Sensitive material must be encrypted before publication.

Storing locators directly is deliberately more expensive than event-only storage,
but it lets generic clients render current state without an indexer. The cap keeps
that direct-state choice bounded.

## Creation

Creation is a payable factory operation, not a transition from a fictional stored
`None` state.

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

function createAgreement(
    CreateAgreementParams calldata params
) external payable returns (bytes32 agreementId);
```

Creation:

1. derives the ID from `msg.sender` and `params.agreementRef`;
2. validates the reference, parties, amount, durations, and terms document;
3. requires the ID to be unused;
4. requires `msg.value == params.amount` exactly;
5. stores the agreement directly as `Funded`;
6. starts the acceptance deadline;
7. increases `totalEscrowed`;
8. emits `AgreementCreated`;
9. returns the ID for direct callers.

Validation requires:

```text
reference byte length in [1, MAX_AGREEMENT_REF_BYTES]
contractor and arbitrator nonzero
client, contractor, and arbitrator pairwise distinct
contractor and arbitrator different from address(this)
amount > 0
msg.value == amount
each duration in [1, MAX_PHASE_DURATION]
valid terms document
unused client/reference ID
```

Contract accounts are valid contractor or arbitrator addresses. Do not require
code: an EOA may be intentional, and a counterfactual account may not yet have
code. Pairwise address distinction prevents one address from exercising several
contract roles but does not prove real-world independence.

There is no creation-preview contract API. Input validity is owned by the write
boundary, and CAM already simulates prepared writes before submission. A preview
would duplicate validation, become stale, enlarge the read interface, and still
could not prove wallet balance, exact future `msg.value`, or transaction ordering.

The create UI may render a preparation action for a connected account even while
fields are incomplete. Preparation/simulation then returns the contract's precise
validation error. A rendered form action is not a claim that arbitrary current
field contents will succeed.

### Native value has one source

Keep `amount` only inside the nested parameter tuple. The CAM route uses the same
expression for calldata and transaction value:

```json
{
  "kind": "write",
  "inputs": ["params"],
  "value": "$inputs.params.amount",
  "call": {
    "namespace": "contracts.CamEscrow",
    "function": "createAgreement",
    "args": {
      "params": "$inputs.params"
    }
  }
}
```

Do not add a duplicate top-level amount input. The contract's exact equality
check binds the reviewed economic term to the native-value envelope.

## Read Interface

Add a read-only ERC-165 interface:

```text
dapps/escrow/src/ICamEscrowView.sol
```

It owns reader-facing enums and structures and exposes only reads. `CamEscrow`
advertises both `ICamEscrowView` and `IERC165`; the later projection verifies that
interface before accepting its backing contract.

A compact observation is:

```solidity
struct AgreementView {
    bytes32 agreementId;
    AgreementState state;
    address client;
    address contractor;
    address arbitrator;
    uint256 amount;
    uint64 acceptanceDuration;
    uint64 workDuration;
    uint64 reviewDuration;
    uint64 arbitrationDuration;
    uint256 deadline;
    bool deadlineReached;
    string agreementRef;
    DocumentRef terms;
    DocumentRef submission;
    DocumentRef dispute;
    DocumentRef resolution;
}
```

Do not add `exists`, `createdAt`, or `updatedAt` initially:

- `state == None` is the absence signal;
- the active deadline is the only timestamp required by the workflow;
- block and event metadata already provide historical timing;
- extra reporting fields should wait for a real caller.

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

Missing agreement lookup is ordinary data, not an error. Return the requested or
computed ID, `state == None`, and default remaining fields. Lookup does not apply
creation-length policy to the query string; non-creatable references simply map
to absent IDs.

## Core-Owned Enabled Actions

The projection must not reimplement actor, state, deadline, or terminality rules.
The core exposes the enabled edge set directly:

```solidity
enum AgreementAction {
    CancelAgreement,
    AcceptAgreement,
    SubmitAgreement,
    ApproveAgreement,
    DisputeAgreement,
    FinalizeAcceptanceTimeout,
    FinalizeWorkTimeout,
    FinalizeReviewTimeout,
    ResolveForClient,
    ResolveForContractor,
    FinalizeArbitrationTimeout
}

function availableActions(
    bytes32 agreementId,
    address actor
) external view returns (AgreementAction[] memory);
```

Return actions in enum order. Missing agreements, terminal agreements, and
`actor == address(0)` return an empty array.

The matrix is:

| State/time | Actor | Enabled actions |
|---|---|---|
| `Funded`, before deadline | client | cancel |
| `Funded`, before deadline | contractor | accept |
| `Funded`, deadline reached | any nonzero actor | acceptance timeout |
| `Accepted`, before deadline | contractor | submit |
| `Accepted`, deadline reached | any nonzero actor | work timeout |
| `Submitted`, before deadline | client | approve, dispute |
| `Submitted`, deadline reached | any nonzero actor | review timeout |
| `Disputed`, before deadline | arbitrator | resolve for client, resolve for contractor |
| `Disputed`, deadline reached | any nonzero actor | arbitration timeout |

Use one action-specific predicate:

```solidity
function _isActionAvailable(
    Agreement storage agreement,
    AgreementAction action,
    address actor,
    uint256 now_
) private view returns (bool);
```

`availableActions` evaluates it in canonical order. Every write evaluates it for
its own action before payload validation and mutation. This gives one owner for
actor/state/time legality without making writes allocate the whole action array.

A structured public error may report:

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

Payload validity remains separate. For example, `SubmitAgreement` may be enabled
while a supplied `DocumentRef` is invalid; the call then fails at document
validation after passing the action guard.

## Write API

Expose one public function per semantic edge:

```solidity
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

Keep exact timeout functions rather than one generic finalizer. Under a stale
view, a generic finalizer could succeed in a later expired phase and produce a
different outcome than the route name the user reviewed. Exact functions instead
bind route, source state, and effect one-to-one.

Use no overloads, owner, pause, upgradeability, or external calls during creation,
agreement transitions, or settlement. `withdrawTo` is the only path that sends
native value and uses `ReentrancyGuard`.

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

Creation moves `amount` into active escrow:

```text
totalEscrowed += amount
```

Every terminal transition moves it exactly once to the client or contractor:

```text
totalEscrowed -= amount
withdrawable[beneficiary] += amount
totalWithdrawable += amount
```

Withdrawal moves the caller's entire aggregated credit out:

```text
amount = withdrawable[caller]
withdrawable[caller] = 0
totalWithdrawable -= amount
send amount to recipient
```

Reject a zero recipient, the escrow contract itself, and zero credit. Permit an
alternate recipient so a smart-account beneficiary whose receive function rejects
native value can still redirect its own credit.

Use checks-effects-interactions. A failed transfer reverts the transaction and
restores credit and totals atomically.

The solvency invariant is:

```solidity
totalEscrowed + totalWithdrawable <= address(this).balance;
```

The inequality permits native value forcibly sent by EVM mechanisms that bypass
`receive` and `fallback`. Forced surplus remains inert. Do not introduce an owner
solely to sweep it.

Accept ordinary native value only through creation:

```solidity
receive() external payable {
    revert DirectNativeTransferDisabled();
}

fallback() external payable {
    revert UnknownFunction(msg.sig);
}
```

## Events

Use domain events, not hashes of CAM route names. The Solidity contract must not
be coupled to one manifest's naming scheme.

Minimum events:

```solidity
event AgreementCreated(
    bytes32 indexed agreementId,
    address indexed client,
    address indexed contractor,
    address arbitrator,
    uint256 amount,
    uint256 deadline,
    string agreementRef
);

event AgreementStateChanged(
    bytes32 indexed agreementId,
    address indexed actor,
    AgreementState fromState,
    AgreementState toState,
    uint256 deadline
);

event Withdrawal(
    address indexed account,
    address indexed recipient,
    uint256 amount
);
```

Store documents in contract state; do not duplicate every URI in events until an
indexer or audit requirement demonstrates the need. Transaction calldata and the
state transition already provide the current application path.

Emit exactly one `AgreementStateChanged` for every successful stored-machine
transition. Creation emits `AgreementCreated`; withdrawal emits `Withdrawal` and
is not an agreement transition.

The state-change event is a domain-level audit fact. A future machine-aware viewer
may use it as a receipt-time witness under concurrent execution, but the current
contract does not encode CAM transition IDs.

## Machine-Shaped Projection

A later `CamEscrowUI` should return a stored-machine envelope:

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
    uint256 accountWithdrawable;
    string viewId;
    string authorityId;
}
```

Stable machine ID:

```text
escrow.agreement.v1
```

Stable state IDs map one-to-one to `AgreementState`:

```text
funded
accepted
submitted
disputed
cancelled.client
refunded.acceptanceTimeout
refunded.workTimeout
refunded.arbitratorToClient
released.clientApproval
released.reviewTimeout
released.arbitratorToContractor
released.arbitrationTimeout
```

Stable transition IDs equal the CAM write-route names:

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

The projection maps `availableActions` to those IDs. It may map enums to semantic
IDs, choose display views, and identify the current role. It must not recalculate
authorization or deadline rules.

For an absent ID:

```text
instantiated = false
stateId = ""
transitionIds = []
terminal = false
```

Creation uses a separate form/view and is not presented as a stored-machine edge.
`withdrawTo` is an auxiliary account-credit action and is not presented as an
agreement transition.

## CAM 1.1 Route Shape

Use three route groups.

### Factory

```text
createAgreementForm
createAgreement(params)
```

Creation has one nested input source:

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

### Observation

```text
lookupAgreement(client, agreementRef)
agreement(agreementId)
accountCredit(account)
```

`agreement(agreementId)` is the canonical post-write observation for every stored
agreement transition. `lookupAgreement` provides readable navigation and the
post-create handoff.

### Stored transitions

Each transition route has the same name as its semantic transition ID, calls the
matching exact Solidity function, and continues to:

```text
agreement(agreementId)
```

`withdrawTo` is an auxiliary credit route outside the machine.

CAM 1.1 already supplies the important operational guarantees:

- hash-pinned route and UI declarations;
- closed-world resource and route parsing;
- nested tuple ABI validation and normalization;
- exact native transaction value;
- simulation and wallet review/submission;
- dispatch only from the current rendered action set;
- declared post-write refresh.

The machine envelope is still an application convention. CAM 1.1 does not declare
source/target states, terminality, or graph reachability.

## Future Machine Formalization

Do not predesign a full generic machine schema now. After the escrow works end to
end, the demonstrated minimum is likely to include:

- a stable machine ID;
- stored state inventory, initial state, and terminal states;
- transition IDs with source and target states;
- binding from transitions to existing write routes;
- binding to one canonical observation route;
- an actor-specific enabled-transition field in the observation;
- same-instance continuation checks;
- optional receipt-time verification using a domain state-change event.

The first descriptor should model stored agreements only, with `funded` as the
initial state. Factory instantiation and aggregated credit withdrawal are separate
problems and should remain outside the first graph unless the working application
reveals a small generic composition rule.

Do not add executable actor/time guards to CAM. The graph declares possible edges;
actor-specific contract observation declares currently enabled edges; Solidity
enforces guards and effects.

## Implementation Slices

### Slice 1: core contract and deterministic tests

Branch:

```text
agent/cam-escrow-core
```

Initial shape:

```text
dapps/escrow/
├── README.md
├── src/
│   ├── ICamEscrowView.sol
│   └── CamEscrow.sol
└── test/
    ├── unit/
    │   └── CamEscrow.t.sol
    └── scenario/
        └── CamEscrowWorkflow.t.sol
```

Do not pre-split the tests or add a support directory. Keep small mocks beside the
tests initially; split only after concrete duplication or file pressure appears.

Scope:

- interface and contract;
- economic/trust README;
- deterministic identity, creation, action, timing, settlement, event, and
  accounting tests;
- complete outcome scenarios;
- malicious withdrawal receiver and forced-native tests.

Do not change generic CAM packages, projection code, CAM resources, deployment
scripts, Makefile, or Compose.

### Slice 2: fuzz and stateful invariants

Add only after the public contract shape survives deterministic review.

Prove:

```text
totalEscrowed + totalWithdrawable <= contract balance
sum(tracked active amounts) == totalEscrowed
sum(tracked credits) == totalWithdrawable
active state => deadline != 0
terminal or absent state => deadline == 0
one amount is not both active and credited
terminal states never transition
availableActions agrees with valid actor/state/time calls
state-change events agree with storage transitions
```

### Slice 3: projection

Implement `CamEscrowUI`, ERC-165 backing verification, semantic state/transition
IDs, mapping from `availableActions`, account credit display, and state × actor ×
time tests. Copy no authorization logic.

### Slice 4: CAM 1.1 bundle

Add the manifest, generated ABIs, UI resource, integrity digests, nested creation
route/value, observation routes, exact transition routes, auxiliary withdrawal,
and publication-preflight/conformance coverage.

### Slice 5: local vertical workflow

Add deployment and local browser/terminal scenarios for payable creation, account
switching, acceptance, submission, approval, dispute, arbitration, timeout, and
withdrawal paths. Add multi-account runner machinery only if this concrete fixture
shows that separate role lanes are insufficient.

A generic CAM machine resource is not a scheduled implementation slice yet. Reopen
that work only after the CAM 1.1 vertical slice identifies stable, repeated needs.

## Deterministic Test Law

### Creation

Test:

- exact client/reference ID formula;
- same reference under different clients;
- permanent same-client reference uniqueness;
- reference and document byte limits;
- pairwise-distinct valid role addresses, including contract accounts;
- zero, underpaid, and overpaid amount;
- zero and over-maximum durations;
- exact initial state, deadline, stored terms, and liability;
- missing agreement reads;
- ERC-165 support.

### Action equivalence

For each active state, test at `deadline - 1`, `deadline`, and `deadline + 1` for:

```text
client
contractor
arbitrator
unrelated account
address(0) read context
```

Using a fresh fixture per attempted transition, assert that `availableActions`
contains an action exactly when the corresponding call can pass its actor/state/
time guard. Evidence validation is tested separately after that guard passes.

### Complete outcomes

Test all paths:

```text
create → cancel → client withdrawal
create → accept → submit → approve → contractor withdrawal
create → acceptance timeout → client withdrawal
create → accept → work timeout → client withdrawal
create → accept → submit → review timeout → contractor withdrawal
create → accept → submit → dispute → arbitrator refunds client
create → accept → submit → dispute → arbitrator releases contractor
create → accept → submit → dispute → arbitration timeout → contractor withdrawal
```

For every path assert state, deadline, beneficiary credit, active/withdrawable
totals, documents, and emitted state changes.

### Adversarial accounting

Test:

- concurrent independent agreements;
- aggregated credits;
- terminal irreversibility;
- failed recipient transfer atomicity;
- withdrawal reentrancy resistance;
- alternate withdrawal recipient;
- zero/self recipient rejection;
- direct transfer and unknown-selector rejection;
- forced native value increasing balance but not liabilities.

## Acceptance Gate for the Core Slice

The first implementation is ready only when:

1. Creation uses one nested amount source and exact native value.
2. Creation instantiates `Funded`; it is not modeled as a fake stored-state edge.
3. IDs are documented as client/reference keys, not terms commitments.
4. Every active state has one bounded deadline.
5. Every semantic timeout has an exact public function and outcome.
6. Arbitration inactivity cannot lock funds indefinitely.
7. Core observation owns the actor-specific enabled edge set.
8. Terminal outcomes are single enum states, so state/reason disagreement is
   unrepresentable.
9. Settlement moves one liability exactly once.
10. Failed or reentrant withdrawals cannot lose or duplicate credit.
11. Forced native value cannot corrupt liabilities.
12. Every stored transition emits one domain state-change event.
13. The read interface is ERC-165 discoverable.
14. No generic CAM package changes appear in the branch.

## Explicit Non-Goals

V1 omits:

- neutral or decentralized arbitration guarantees;
- arbitrator acknowledgement or compensation;
- appeals, partial awards, or evidence rounds;
- amendments or contractor resubmission;
- multiple milestones;
- ERC-20 payments, fees, or relayers;
- discovery, enumeration, or reputation;
- privacy;
- administrative recovery, emergency pause, or upgrades;
- automatic timeout execution.

## Rejected Complexity

### No dispute path

Rejected because it would make the client unable to stop payment after a bad
submission. The arbitrator is retained as a real escrow concept.

### Unfunded `Created` state

Rejected because it adds a transaction and permanent unfunded records while
weakening the payable CAM test.

### Creation preview

Rejected because it duplicates validation, becomes stale, and still cannot prove
wallet balance, future native value, or ordering. Write simulation already owns
this boundary.

### `expectedAgreementId`

Rejected because the contract can derive the client/reference key itself; the
extra argument would not bind all terms.

### Terms-bound or deployment-bound ID

Rejected for V1. The contract-scoped client/reference key is sufficient and keeps
readable lookup simple. External identity already includes chain and contract.

### Duplicate top-level amount input

Rejected because `$inputs.params.amount` can source both calldata and native
value.

### Generic timeout function

Rejected because a stale semantic route could succeed in a later expired phase
and produce an outcome different from the route the user reviewed.

### Generic terminal state plus settlement reason

Rejected because it admits invalid combinations. Outcome-specific terminal states
make the machine graph and storage agree directly.

### CAM transition hashes in Solidity events

Rejected because the contract should emit domain state changes, not depend on one
manifest's route names.

### Withdrawal as an agreement state

Rejected because credits aggregate across agreements and form a separate account
workflow.

### Full CAM machine schema now

Rejected because it would be speculative protocol work before the second app has
proved the minimum useful semantics.

## Architectural Position

The intended eventual relationship is:

> CAM declares the stored labelled transition system; actor-specific contract
> observation declares enabled edges; Solidity enforces guards, effects, and
> accounting; domain events record state changes; and the viewer refreshes current
> state without becoming an authorization authority.

Under CAM 1.1 this remains an application convention. The current goal is to make
that convention small, explicit, and testable—not to build the generic machine
protocol before the application creates concrete pressure for it.
