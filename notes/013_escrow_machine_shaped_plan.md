# Machine-Shaped Escrow and CAM State-Machine Path

Date: 2026-07-27

Status: audited implementation plan and current next-work note.

Purpose: define the smallest credible second dapp that exercises CAM 1.1 native
transaction values, nested ABI inputs, actor-specific actions, timed transitions,
and pull-payment accounting. Shape the stored agreement workflow so a future CAM
machine resource can describe it without making the Solidity contract depend on
CAM route names or speculative protocol syntax.

## Design Standard

Prefer the smallest truthful model:

- one owner for each business fact;
- no second validation API when simulation already owns the write boundary;
- no derived read field without a current caller;
- no configurable generalization without a demonstrated use case;
- no CAM-specific concepts in the Solidity contract;
- no generic CAM extension until a working second application proves the need.

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
    may declare the stored state graph after the CAM 1.1 vertical slice proves
    that a generic descriptor is useful and small
```

## Quantified Uncertainty

These are subjective engineering-confidence estimates, not statistical or
security guarantees. Each percentage estimates whether the decision will survive
the core contract, projection, and CAM 1.1 bundle without material redesign.
Technical estimates are roughly ±10 percentage points; product-policy estimates
are closer to ±20.

| Decision | Confidence | Main reason it may change |
|---|---:|---|
| Escrow is the best second dapp | 85% | Another app may test generic CAM reuse with less product policy. |
| Retain designated arbitration in V1 | 65% | It materially enlarges the state machine and test surface. |
| Let parties pre-agree which party receives funds after arbitration timeout | 85% | It removes the protocol's arbitrary choice while keeping settlement binary. |
| Reject arbitrary timeout splits in V1 | 85% | No current use requires partial settlement; it adds incentives, dual credits, rounding, and UI surface. |
| Permit client cancellation before acceptance | 85% | It adds a race and terminal state but prevents obvious mistaken-offer locks. |
| Encode terminal outcomes directly in the state enum | 85% | The enum is larger, but invalid state/reason combinations become impossible. |
| Use one exact public function per timeout phase | 90% | A generic finalizer can succeed with a different semantic outcome under stale state. |
| Store URI plus SHA-256 for terms/submission/dispute | 65% | Direct state is expensive; event-only or content-addressed designs may suffice. |
| Omit an arbitrator-rationale document | 80% | Some users may require one, but it changes neither authority nor settlement. |
| Omit creation preview | 90% | Simulation already owns exact write validation; preview would be stale and incomplete. |
| Expose enabled actions as an enum array | 70% | A bitmask may prove simpler after the projection and ABI are implemented. |
| Use 128-byte references and 512-byte URI caps | 60% | These are defensive V1 limits without product data. |
| Use a 365-day maximum per phase | 55% | It prevents absurd locks but is inherently arbitrary. |
| A generic CAM machine resource will be worth adding | 40% | One application may not justify a protocol extension. |

### Stop gates

- If arbitration dominates the core implementation or deterministic tests, split
  it into a later application revision rather than expanding generic CAM.
- If `CamEscrowUI` must duplicate an actor, state, or deadline predicate, stop and
  repair the core read boundary.
- If the CAM bundle cannot express the nested creation form without escrow-specific
  viewer code, isolate the exact generic gap before changing the application.
- Do not start a generic machine resource from this note. Require the working CAM
  1.1 escrow plus a repeated machine need or a failing generic invariant.
- Keep the three numeric caps as fixed V1 policy. Do not parameterize them until a
  concrete deployment needs different values.

## Arbitration and Pre-Agreed Failure Risk

A two-party optimistic payment would be simpler, but it would not be a credible
escrow: after a bad submission, the client would have no unilateral way to stop
payment.

A designated arbitrator is therefore retained as a domain concept. V1 does not
claim neutral arbitration:

- the client chooses the arbitrator;
- the contractor accepts that choice by accepting the agreement;
- the arbitrator gives no on-chain acknowledgement;
- distinct addresses do not prove organizational independence;
- arbitrator compensation is out of band;
- there is no appeal or partial award.

Arbitrator inactivity has no universally fair outcome. The agreement therefore
contains one immutable, structured term:

```solidity
enum ArbitrationTimeoutBeneficiary {
    Client,
    Contractor
}
```

The client proposes the beneficiary at creation. Before acceptance, the contractor
must be shown:

```text
arbitrator address
arbitration duration
arbitration-timeout beneficiary
```

Calling `acceptAgreement` accepts those stored terms. If the arbitrator does not
rule before the deadline, `finalizeArbitrationTimeout` credits the pre-agreed
beneficiary.

This does not make the rule neutral; it makes the risk allocation explicit. A
client-favoring fallback can make opportunistic disputes attractive. A
contractor-favoring fallback can pay a contractor after poor work when the
arbitrator fails to act. Both parties see the choice before work begins.

Do not support arbitrary percentages in V1. Binary choice already expresses who
bears arbitrator-inactivity risk. Arbitrary splits would add partial-settlement
semantics, two credits from one agreement, rounding policy, broader UI disclosure,
more invariants, and a new incentive parameter without a current caller.

## Stored Agreement State Machine

Use one state enum whose terminal members encode the outcome directly. Do not
store a generic terminal state plus a separate settlement-reason enum; that would
permit invalid combinations.

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
    RefundedAfterArbitrationTimeout,
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
  └── arbitration deadline reached
       ├── agreed beneficiary: Client ──────────────────► RefundedAfterArbitrationTimeout
       └── agreed beneficiary: Contractor ──────────────► ReleasedAfterArbitrationTimeout
```

All outcome states are terminal. A terminal state means the agreement amount has
become a beneficiary's withdrawal credit; it does not mean the native value has
already left the contract.

One semantic transition, `finalizeArbitrationTimeout`, has two possible target
states selected by an immutable agreement term. This is not nondeterminism for a
particular agreement: its beneficiary is fixed before contractor acceptance.

### Time semantics

Use one boundary everywhere:

```text
ordinary transition available: block.timestamp < deadline
timeout transition available:  block.timestamp >= deadline
```

Ordinary and timeout transitions are never simultaneously valid.

Every active stored state has exactly one deadline:

| State | Deadline |
|---|---|
| `Funded` | acceptance deadline |
| `Accepted` | work deadline |
| `Submitted` | review deadline |
| `Disputed` | arbitration deadline |
| terminal or absent | zero |

Pin a V1 accident-prevention limit:

```solidity
uint64 public constant MAX_PHASE_DURATION = 365 days;
```

Each configured duration must be in `[1, MAX_PHASE_DURATION]`. Store durations as
`uint64` and the active deadline as `uint256`:

```solidity
agreement.deadline = block.timestamp + duration;
```

The one-year value is product policy, not an EVM or CAM requirement. Four phases
can still span almost four years in total.

### Transaction ordering

Client cancellation and contractor acceptance intentionally compete while the
agreement is `Funded`. If both are submitted, chain ordering decides which
succeeds; the second transaction observes a changed state and reverts.

Simulation and wallet review reduce stale-action risk but do not reserve a state.
Contractors should rely on confirmed acceptance, not an unconfirmed transaction or
a rendered button.

## Agreement Identity

Use a client-scoped deterministic key inside the escrow contract:

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

The contract already scopes storage. Including `address(this)`, a domain constant,
or `block.chainid` in the storage key would be redundant.

The externally complete identity is:

```text
chain ID + escrow contract address + agreement ID
```

The ID is a lookup key, not a commitment to all terms. It binds only the client
and exact reference bytes. Contractor, arbitrator, timeout beneficiary, amount,
durations, and documents are separately reviewed calldata and stored state.

References are byte-exact. The contract does not trim, case-fold, or Unicode-
normalize them. The same client cannot reuse a reference after any outcome;
different clients may use the same reference.

## Content-Committed Documents

Terms, submissions, and disputes use:

```solidity
struct DocumentRef {
    string uri;
    bytes32 sha256Digest;
}
```

The parties choose an exact byte sequence and record its SHA-256 digest. The URI
is only a retrieval hint. The contract does not retrieve, canonicalize, or verify
the bytes and does not claim that content later fetched from the URI matches the
digest. A viewer may verify fetched bytes before displaying or relying on them.

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

Before the corresponding transition, an optional document field is the zero
struct.

The commitment proves byte identity, not legal validity, comprehension, consent,
or availability. All addresses, values, references, deadlines, URIs, and digests
are public. Sensitive material must be encrypted before publication.

Store document locators directly so a generic client can render current state
without an indexer. This is expensive and remains a medium-confidence decision.
Do not duplicate the same locators in events without an indexer requirement.

Do not store an arbitrator-rationale document in V1. The binary state transition
is the settlement authority. A rationale may be useful but changes neither
authorization nor accounting, while terms/submission/dispute already exercise
content-committed documents.

## Creation

Creation is a payable factory operation, not a transition from a fictional stored
`None` state.

```solidity
struct CreateAgreementParams {
    string agreementRef;
    address contractor;
    address arbitrator;
    ArbitrationTimeoutBeneficiary arbitrationTimeoutBeneficiary;
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
could not prove wallet balance, future `msg.value`, or transaction ordering.

The create UI may render a preparation action while fields are incomplete.
Preparation and simulation then return the contract's validation error. A rendered
form action is not a claim that arbitrary current field contents will succeed.

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

It owns reader-facing enums and structs and exposes only the reads required by the
projection. `CamEscrow` advertises both `ICamEscrowView` and `IERC165`; the later
projection verifies that interface before accepting its backing contract.

A compact observation is:

```solidity
struct AgreementView {
    bytes32 agreementId;
    AgreementState state;
    address client;
    address contractor;
    address arbitrator;
    ArbitrationTimeoutBeneficiary arbitrationTimeoutBeneficiary;
    uint256 amount;
    uint64 acceptanceDuration;
    uint64 workDuration;
    uint64 reviewDuration;
    uint64 arbitrationDuration;
    uint256 deadline;
    string agreementRef;
    DocumentRef terms;
    DocumentRef submission;
    DocumentRef dispute;
}
```

Do not add `exists`, `deadlineReached`, `createdAt`, or `updatedAt` initially:

- `state == None` is the absence signal;
- deadline expiry is derived from the current block timestamp;
- the active deadline is the only stored timestamp needed by the workflow;
- historical timing belongs to blocks and events;
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
computed ID, `state == None`, and default remaining fields. Lookup need not apply
creation-length policy to the query string; non-creatable references simply map
to absent IDs.

## Core-Owned Enabled Actions

The projection must not reimplement actor, state, deadline, or terminality rules.
The core exposes the control-enabled edge set:

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

“Available” means that actor, state, and time permit the transition for some valid
payload. It does not certify that current form fields are valid. Submission and
dispute document validation remains at the write boundary and is exercised by
simulation.

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
actor/state/time legality without making writes allocate the full array.

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

function resolveForClient(bytes32 agreementId) external;
function resolveForContractor(bytes32 agreementId) external;
function finalizeArbitrationTimeout(bytes32 agreementId) external;

function withdrawTo(address payable recipient) external;
```

Keep exact timeout functions rather than one generic finalizer. Under a stale
view, a generic finalizer could succeed in a later expired phase and produce a
different outcome than the route the user reviewed. Exact functions bind route,
source state, and effect.

`finalizeArbitrationTimeout` is exact about its source and cause but branches to one
of two terminal states using the immutable timeout beneficiary. The user-visible
route must display the expected beneficiary before preparation.

Use no overloads, owner, pause, upgradeability, or external calls during creation,
agreement transitions, or settlement. `withdrawTo` is the only path that sends
native value and uses `ReentrancyGuard`.

## Accounting

Store:

```solidity
mapping(address => uint256) public withdrawable;
uint256 public totalEscrowed;
uint256 public totalWithdrawable;
```

Creation moves `amount` into active escrow:

```text
totalEscrowed += amount
```

Every terminal transition credits exactly one beneficiary:

```text
totalEscrowed -= amount
withdrawable[beneficiary] += amount
totalWithdrawable += amount
```

At arbitration timeout, the beneficiary is selected by the stored binary term.
There is no split, no rounding rule, and no second credit.

Withdrawal moves the caller's entire aggregated credit out:

```text
amount = withdrawable[caller]
withdrawable[caller] = 0
totalWithdrawable -= amount
send amount to recipient
```

Reject a zero recipient, the escrow contract itself, and zero credit. Permit an
alternate recipient so a smart-account beneficiary whose receive function rejects
native value can redirect its own credit.

Use checks-effects-interactions. A failed transfer reverts and restores credit and
totals atomically.

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
    uint256 deadline
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

The reference, timeout beneficiary, and documents are already stored in state. Do
not duplicate them in events without an indexer requirement.

Emit exactly one `AgreementStateChanged` for every successful stored-machine
transition. Creation emits `AgreementCreated`; withdrawal emits `Withdrawal` and
is not an agreement transition.

For this graph, `fromState` plus `toState` identifies the semantic edge, including
which arbitration-timeout beneficiary was applied. If a future graph admits
parallel edges with identical endpoints, revisit witness design then rather than
coupling this contract to speculative CAM transition IDs now.

## Machine-Shaped Projection

A later `CamEscrowUI` should expose only the machine envelope justified by the
working application:

```solidity
struct MachineView {
    string machineId;
    bytes32 instanceId;
    bool instantiated;
    string stateId;
    string[] transitionIds;
}
```

Do not add a redundant `terminal` flag. Terminality belongs to the state inventory,
and terminal observations already return no transition IDs.

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
cancelled.client
refunded.acceptanceTimeout
refunded.workTimeout
refunded.arbitratorToClient
refunded.arbitrationTimeout
released.clientApproval
released.reviewTimeout
released.arbitratorToContractor
released.arbitrationTimeout
```

Stable transition IDs equal CAM write-route names:

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

Before rendering `acceptAgreement`, the projection/UI must display the structured
arbitrator, arbitration duration, and arbitration-timeout beneficiary. This is a
presentation obligation, not a new contract guard.

For an absent ID:

```text
instantiated = false
stateId = ""
transitionIds = []
```

Creation uses a separate form/view and is not presented as a stored-machine edge.
`withdrawTo` is an auxiliary account-credit action and is not presented as an
agreement transition.

Do not prescribe the full `AppView` tuple before implementing the projection. Add
only fields required by actual UI nodes.

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
matching Solidity function, and continues to:

```text
agreement(agreementId)
```

`withdrawTo` is an auxiliary credit route outside the machine.

CAM 1.1 already supplies:

- hash-pinned route and UI declarations;
- closed-world resource and route parsing;
- nested tuple ABI validation and normalization;
- exact native transaction value;
- simulation and wallet review/submission;
- dispatch only from the current rendered action set;
- declared post-write refresh.

The machine envelope remains an application convention. CAM 1.1 does not declare
source/target states, terminality, or graph reachability.

## Future Machine Formalization

Do not predesign a full generic machine schema now. After the escrow works end to
end, the demonstrated minimum may include:

- stable machine, state, and transition IDs;
- initial and terminal state inventories;
- source and target states for each transition;
- binding from transitions to write routes;
- one canonical observation route;
- an actor-specific enabled-transition field;
- same-instance continuation checks;
- optional receipt-time verification using the domain state-change event.

`finalizeArbitrationTimeout` demonstrates that one declared transition may have
more than one possible target, selected by immutable instance data. A future
machine schema should support a target set without trying to reproduce the
contract's guard or payout logic.

The first descriptor, if justified, should model stored agreements only, with
`funded` as the initial state. Factory instantiation and aggregated credit
withdrawal remain separate unless the working application reveals a small generic
composition rule.

Do not add executable actor/time guards to CAM. The graph declares possible edges;
actor-specific contract observation declares currently enabled edges; Solidity
enforces guards, payload validity, effects, and accounting.

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

Do not pre-split tests or add a support directory. Keep small mocks beside the
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
arbitration timeout credits exactly the configured party
```

### Slice 3: projection

Implement `CamEscrowUI`, ERC-165 backing verification, semantic state/transition
IDs, mapping from `availableActions`, timeout-beneficiary disclosure, account
credit display, and state × actor × time tests. Copy no authorization logic.

### Slice 4: CAM 1.1 bundle

Add the manifest, generated ABIs, UI resource, integrity digests, nested creation
route/value, observation routes, exact transition routes, auxiliary withdrawal,
and publication-preflight/conformance coverage.

### Slice 5: local vertical workflow

Add deployment and local browser/terminal scenarios for payable creation, account
switching, acceptance, submission, approval, dispute, both arbitration outcomes,
both arbitration-timeout beneficiaries, other timeouts, and withdrawal. Add
multi-account runner machinery only if this concrete fixture shows that separate
role lanes are insufficient.

A generic CAM machine resource is not a scheduled implementation slice. Reopen
that work only after the CAM 1.1 vertical slice identifies stable, repeated needs.

## Deterministic Test Law

### Creation

Test:

- exact client/reference ID formula;
- same reference under different clients;
- permanent same-client reference uniqueness;
- reference and document byte limits;
- pairwise-distinct valid role addresses, including contract accounts;
- both arbitration-timeout beneficiary values;
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
create → accept → submit → dispute → timeout configured for client → client withdrawal
create → accept → submit → dispute → timeout configured for contractor → contractor withdrawal
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
- forced native value increasing balance but not liabilities;
- arbitration timeout creates exactly one full credit and no rounding residue.

### Policy-risk tests

Pin the non-neutral product rules explicitly:

- a dispute at `reviewDeadline - 1` can delay settlement by almost the full
  arbitration duration;
- the pre-agreed timeout beneficiary, not the protocol, determines inactivity risk;
- cancellation and acceptance races are resolved by transaction ordering;
- no caller can extend a phase deadline after entering that phase;
- no automatic settlement occurs without a transaction;
- accepting the agreement does not prove the arbitrator acknowledged the role.

## Acceptance Gate for the Core Slice

The first implementation is ready only when:

1. Creation uses one nested amount source and exact native value.
2. Creation instantiates `Funded`; it is not modeled as a fake stored-state edge.
3. IDs are client/reference keys, not terms commitments.
4. Every active state has one bounded deadline.
5. Every semantic timeout has an exact public function.
6. Arbitration inactivity cannot lock funds indefinitely.
7. Arbitration-timeout risk is an immutable binary term visible before acceptance.
8. No partial settlement or arbitrary split exists in V1.
9. Core observation owns the actor-specific control-enabled edge set.
10. Terminal outcomes are single enum states, so state/reason disagreement is
    unrepresentable.
11. Terms, submissions, and disputes are content-committed; arbitrator resolution
    requires no extra document.
12. Settlement moves one liability exactly once.
13. Failed or reentrant withdrawals cannot lose or duplicate credit.
14. Forced native value cannot corrupt liabilities.
15. Every stored transition emits one domain state-change event.
16. The read interface is ERC-165 discoverable and contains no speculative timing
    or reporting fields.
17. No generic CAM package changes appear in the branch.

## Explicit Non-Goals

V1 omits:

- neutral or decentralized arbitration guarantees;
- arbitrator acknowledgement, rationale document, or compensation;
- arbitrary timeout splits or arbitrator-selected partial awards;
- appeals, evidence rounds, or resubmission;
- amendments;
- multiple milestones;
- ERC-20 payments, fees, or relayers;
- discovery, enumeration, or reputation;
- privacy;
- administrative recovery, emergency pause, or upgrades;
- automatic timeout execution.

## Rejected Complexity

### No dispute path

Rejected because it would make the client unable to stop payment after a bad
submission. Arbitration remains a medium-confidence product choice.

### Globally fixed arbitration-timeout beneficiary

Rejected because neither client nor contractor is a universally neutral fallback.
The parties choose the risk bearer before contractor acceptance.

### Arbitrary timeout split

Rejected because binary choice already expresses who bears inactivity risk. A
basis-point split would add partial settlement, dual credits, rounding, broader
incentives, UI surface, and invariants without a demonstrated caller.

### Unfunded `Created` state

Rejected because it adds a transaction and permanent unfunded records while
weakening the payable CAM test.

### Creation preview

Rejected because it duplicates validation, becomes stale, and still cannot prove
wallet balance, future native value, or ordering. Write simulation owns this
boundary.

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

### Arbitrator-rationale document

Rejected for V1 because the binary on-chain ruling is sufficient for settlement,
and another locator/digest changes neither authorization nor accounting.

### CAM transition hashes in Solidity events

Rejected because the contract should emit domain state changes, not depend on one
manifest's route names.

### Derived read fields

`exists`, `deadlineReached`, `createdAt`, `updatedAt`, and a machine `terminal`
flag are omitted until a caller proves they are needed. Their meanings are already
represented by state, deadline, blocks, events, or the state inventory.

### Withdrawal as an agreement state

Rejected because credits aggregate across agreements and form a separate account
workflow.

### Full CAM machine schema now

Rejected because it would be speculative protocol work before the second app has
proved the minimum useful semantics.

## Architectural Position

The intended eventual relationship is:

> CAM may declare the stored labelled transition system; actor-specific contract
> observation declares control-enabled edges; Solidity enforces guards, payload
> validity, effects, and accounting; domain events record state changes; and the
> viewer refreshes current state without becoming an authorization authority.

Under CAM 1.1 this remains an application convention. The current goal is to make
that convention small, explicit, and testable—not to build the generic machine
protocol before the application creates concrete pressure for it.
