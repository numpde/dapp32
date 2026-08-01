# CAM Escrow V1

`CamEscrow` is a non-upgradeable, single-milestone native-asset escrow. A client creates and funds an agreement in one payable transaction. The contractor may accept, submit committed work evidence, and receive payment after client approval, review timeout, or an arbitrator decision. The client may cancel before acceptance, dispute a submission, or recover funds after acceptance/work timeout or an arbitrator decision.

This package contains the core contract, the read-only `CamEscrowUI` semantic projection, and deterministic, fuzz, and stateful-invariant verification. It intentionally contains no CAM manifest, generated ABI bundle, deployment script, browser fixture, local vertical workflow, or generic machine descriptor yet.

## Roles and trust

Each agreement stores three pairwise-distinct addresses:

- `client`: creates and funds the agreement;
- `contractor`: may accept and submit;
- `arbitrator`: may resolve a dispute before its arbitration deadline.

The client selects the arbitrator. V1 does not prove neutrality, availability, compensation, or real-world independence.

### No arbitrator acknowledgement

The arbitrator does not sign, call, or acknowledge an agreement before contractor acceptance. `Funded` means only that native value is escrowed and the contractor has not accepted.

The shared `_isActionAvailable(..., AcceptAgreement, ...)` predicate is the only future-readiness seam. Both `availableActions()` and `acceptAgreement()` consume it. V1 stores and emits no acknowledgement fact.

A later acknowledgement-required design would be a new contract deployment and machine version.

## State machine

```text
create + exact native value
  -> Funded

Funded
  -> CancelledByClient
  -> Accepted
  -> RefundedAfterAcceptanceTimeout

Accepted
  -> Submitted
  -> RefundedAfterWorkTimeout

Submitted
  -> ReleasedByClientApproval
  -> Disputed
  -> ReleasedAfterReviewTimeout

Disputed
  -> RefundedByArbitrator
  -> ReleasedByArbitrator
  -> RefundedAfterArbitrationTimeout
  -> ReleasedAfterArbitrationTimeout
```

Ordinary actions require `block.timestamp < deadline`. Timeout actions require `block.timestamp >= deadline`. Every active state has exactly one deadline; terminal and absent observations have deadline zero. Timeouts require a transaction and never execute automatically.

## Arbitration-timeout policy

Creation fixes one immutable binary fallback:

```solidity
ArbitrationTimeoutBeneficiary.Client
ArbitrationTimeoutBeneficiary.Contractor
```

`None` is an in-range sentinel and is rejected. Out-of-range enum values are rejected by Solidity's ABI decoding boundary before the function body executes.

If the arbitrator does not act before the arbitration deadline, the configured party receives the complete agreement amount. V1 has no split, percentage, rounding rule, dual credit, or residual agreement liability.

## Native value and accounting

Creation requires:

```text
amount > 0
msg.value == params.amount
```

The accounting identities are:

```text
active agreement:
  totalEscrowed += amount

terminal transition:
  totalEscrowed -= amount
  withdrawable[beneficiary] += amount
  totalWithdrawable += amount

withdrawal:
  withdrawable[caller] = 0
  totalWithdrawable -= amount
  send complete credit to recipient
```

The public liability surface is owned by `ICamEscrowView`:

- `withdrawable(account)`;
- `totalEscrowed()`;
- `totalWithdrawable()`;
- `totalLiabilities()`.

The solvency invariant is:

```solidity
totalLiabilities() <= address(escrow).balance
```

Forced native surplus is inert. There is no owner or sweep function. Direct transfers and unknown selectors revert. `withdrawTo` is the only native-value send path and uses checks-effects-interactions plus `ReentrancyGuard`.

## Agreement identity and documents

The contract-scoped key is:

```solidity
keccak256(abi.encode(client, agreementRef))
```

The externally complete identity also includes chain ID and escrow contract address. The key is not a commitment to all agreement terms.

Terms, submission, and dispute evidence use:

```solidity
struct DocumentRef {
    string uri;
    bytes32 sha256Digest;
}
```

The digest commits to exact bytes. The URI is only a public retrieval hint. The contract does not fetch, decrypt, canonicalize, or verify referenced content. Sensitive material must be encrypted before publication.

## Read and write boundaries

Agreement storage is private. `ICamEscrowView` owns:

- absent/instantiated agreement observation;
- reference lookup;
- actor-specific available actions;
- policy caps;
- accounting reads.

Missing reads return `AgreementState.None`; missing writes revert `AgreementNotFound`.

`availableActions()` describes only actor/state/time legality for some valid payload. Submission/dispute document validation remains at the write boundary. Each evidence-bearing write checks action availability before payload validity.

## Projection boundary

`CamEscrowUI` verifies that its immutable backing address has code and advertises `ICamEscrowView` through ERC-165. It has no owner, roles, write forwarding, or native-value path.

It exposes four projection reads:

- creation policy and the authenticated `createAgreement` action;
- agreement observation by ID;
- agreement observation by client/reference;
- aggregate account credit and the conditional `withdrawTo` action.

The agreement projection returns the core `AgreementView` unchanged plus a small semantic envelope:

```text
machine ID: escrow.agreement.v1
instance ID: agreement ID
instantiated flag
stable state ID
actor role ID
core-provided enabled transitions mapped to stable route IDs
arbitration-timeout beneficiary disclosure
arbitrator acknowledgement: not required and not recorded on-chain
```

The projection does not recalculate authorization, deadline expiry, acceptance readiness, or terminal transitions. It calls `availableActions(agreementId, actor)` and maps the returned enum values in their core-defined order. Creation remains a factory action and withdrawal remains an account-credit action; neither is represented as an agreement-machine transition.

## Explicit non-goals

V1 omits:

- arbitrator acknowledgement, consent proof, rationale, or compensation;
- neutral or decentralized arbitration guarantees;
- appeals, evidence rounds, partial awards, or milestones;
- amendments, deadline extension, or contractor resubmission;
- ERC-20 payments, fees, relayers, pause, ownership, upgrades, or recovery hooks;
- discovery, enumeration, privacy, reputation, or automatic timeout execution.

## Tests

The deterministic suite covers core creation, validation, absent reads, enabled-action boundaries, no-acknowledgement acceptance, exact timeout functions, complete terminal paths, document retention, pull-payment accounting, failed transfers, alternate recipients, reentrancy, direct-transfer rejection, unknown selectors, and forced surplus. Projection tests cover backing-interface verification, creation policy, absent and instantiated machine observations, all stable state IDs, actor/time transition mapping at every deadline boundary, risk disclosures, account credit, and the read-only native-value boundary.

The fuzz suite checks arbitrary valid creation economics and, for every active state, compares selected writes against `availableActions` at `deadline - 1`, `deadline`, and `deadline + 1`. It also fuzzes full-value arbitration-timeout settlement for both configured beneficiaries.

The stateful invariant handler drives up to sixteen concurrent agreements across a fixed actor pool. It proves active and terminal amount conservation, aggregate-credit ownership, solvency, deadline shape, terminal action emptiness, terminal irreversibility, event/storage agreement for every successful transition, and exact single-beneficiary settlement deltas.

The repository-wide `make fmt` lane checks every dapp. At the base commit used for this branch, unrelated existing bike and deposit sources are not clean under the currently pinned Forge formatter. Do not mix that repository-wide normalization into this escrow slice.

Build the pinned Foundry image and apply formatting only to this dapp through a writable mount:

```bash
docker build --tag cam-escrow-foundry-local containers/foundry

docker run --rm --network none \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp/home \
  --volume "$PWD/dapps:/work/dapps:rw" \
  --workdir /work/dapps \
  cam-escrow-foundry-local \
  sh -eu -c 'mkdir -p "$HOME"; forge fmt escrow/src escrow/test'
```

Check only the escrow formatting without rewriting files:

```bash
docker run --rm --network none \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp/home \
  --volume "$PWD/dapps:/work/dapps:ro" \
  --workdir /work/dapps \
  cam-escrow-foundry-local \
  sh -eu -c 'mkdir -p "$HOME"; forge fmt --check escrow/src escrow/test'
```

Run the repository build and deterministic tests, then the heavy verification lanes:

```bash
make build
make test
make fuzz
make invariant
```

To isolate only this dapp's deterministic tests inside the repository Foundry image:

```bash
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \
  docker compose -f compose/forge.yml run --build --rm forge-test \
  sh -eu -c 'forge test --offline --match-path "escrow/test/unit/**/*.sol" -vvv; forge test --offline --match-path "escrow/test/scenario/**/*.sol" -vvv'
```

The ordinary `forge-test` service already discovers `escrow/test/unit` and `escrow/test/scenario`; `make test` remains the authoritative deterministic repository lane. Fuzz and invariant tests remain in their dedicated heavier lanes. Repository-wide formatting normalization should be handled separately from this branch.