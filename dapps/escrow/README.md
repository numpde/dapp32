# CAM Escrow V1

`CamEscrow` is a non-upgradeable, single-milestone native-asset escrow. A client creates and funds an agreement in one payable transaction. The contractor may accept, submit committed work evidence, and receive payment after client approval, review timeout, or an arbitrator decision. The client may cancel before acceptance, dispute a submission, or recover funds after acceptance/work timeout or an arbitrator decision.

This package contains the core contract, the read-only `CamEscrowUI` semantic projection, the CAM 1.1 manifest/UI/ABI bundle, deterministic/fuzz/stateful verification, and a local real-RPC vertical workflow with terminal and browser entrypoints. It deliberately contains no generic CAM machine descriptor.

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

## Projection boundary

`CamEscrowUI` verifies that its immutable backing address has code and advertises `ICamEscrowView` through ERC-165. It has no owner, roles, write forwarding, or native-value path.

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

## CAM 1.1 bundle

`cam/main.json` declares two contract namespaces, the route namespace, and the UI resource. Generated ABI resources live under `cam/abi/`; their byte identities and the UI byte identity are pinned in the manifest.

The bundle has three route groups:

- factory: `createAgreementForm` and payable `createAgreement`;
- observation: `lookupAgreement`, `agreement`, and `accountCredit`;
- writes: the eleven exact stored-machine transitions plus auxiliary `withdrawTo`.

Creation has one nested input, `params`. The same nested amount expression owns both calldata and native transaction value:

```json
{
  "inputs": ["params"],
  "value": "$inputs.params.amount",
  "call": {
    "function": "createAgreement",
    "args": {
      "params": "$inputs.params"
    }
  }
}
```

Every stored transition continues to the canonical `agreement(agreementId)` observation. Creation continues by client/reference lookup. Withdrawal continues to the caller's account-credit observation. The UI renders only transition IDs supplied by `CamEscrowUI`; it does not infer actor or deadline legality.

There is deliberately no generic CAM machine resource. `escrow.agreement.v1` and its stable state/transition IDs remain an application projection until another application demonstrates a small repeated protocol need.

## Local vertical workflow

The local fixture deploys:

```text
CamRoot
CamEscrow
CamEscrowUI
```

It serves the checked-in CAM bundle over HTTP and uses four obvious local-only accounts:

```text
client / CamRoot owner
contractor
arbitrator
public timeout finalizer
```

The deterministic runner exercises the generic stack rather than calling escrow writes directly:

```text
rendered CAM button
  -> CamViewerSession.dispatchAction
  -> prepared calldata and native value
  -> simulation
  -> wallet submission
  -> receipt
  -> declared route continuation
  -> refreshed projected state
```

It proves all nine terminal paths and complete withdrawal:

1. client cancellation;
2. contractor acceptance without arbitrator acknowledgement, submission, and client approval;
3. acceptance timeout;
4. work timeout;
5. review timeout;
6. arbitrator refund to client;
7. arbitrator release to contractor;
8. arbitration timeout configured for client;
9. arbitration timeout configured for contractor.

Each path uses a new agreement reference, switches the viewer account through `CamViewerSession.setAccount`, asserts the projected semantic state, verifies that terminal observations expose no machine transitions, withdraws the complete credit, and leaves no escrow balance at the end.

### Common local environment

The CAM hash below is the accepted hash of the checked-in root bytes:

```bash
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
export CAM_HASH=0x08f41b8991602fa55e28230933cf6642345a28d1bbf0c18215ae044608a6fb66
export ESCROW_BROADCAST_DIR=/foundry-broadcast
export ESCROW_BROADCAST_PATH=/foundry-broadcast/DeployEscrowLocal.s.sol/31337/run-latest.json
```

### Automated nine-path workflow

```bash
export COMPOSE_PROJECT_NAME=dapps-escrow-local
export CAM_URI=http://escrow-cam-http:8080/main.json
export CAM_VIEWER_RESOURCE_ORIGIN=http://escrow-cam-http:8080

files=(
  -f compose/escrow/local/deploy.yml
  -f compose/escrow/local/http.yml
  -f compose/escrow/local/scenario.yml
)

docker compose "${files[@]}" \
  up --build --abort-on-container-exit \
  --exit-code-from escrow-local-scenario \
  escrow-local-scenario

docker compose "${files[@]}" down --volumes --remove-orphans
```

### Interactive real-RPC terminal

```bash
export COMPOSE_PROJECT_NAME=dapps-escrow-terminal
export CAM_URI=http://escrow-cam-http:8080/main.json
export CAM_VIEWER_RESOURCE_ORIGIN=http://escrow-cam-http:8080

files=(
  -f compose/escrow/local/deploy.yml
  -f compose/escrow/local/http.yml
  -f compose/escrow/local/viewer-terminal.yml
)

docker compose "${files[@]}" run --build --rm escrow-viewer-terminal
```

The terminal starts as the client. Use:

```text
account <address>   switch to contractor, arbitrator, or finalizer
account none        render an anonymous account context
```

The terminal prepares writes but does not sign or submit them. It is useful for inspecting role-specific rendered actions and exact calldata/value preparation.

Clean up with:

```bash
docker compose "${files[@]}" down --volumes --remove-orphans
```

### Browser viewer

```bash
export COMPOSE_PROJECT_NAME=dapps-escrow-gui
export ESCROW_GUI_PORT=5174
export ESCROW_GUI_BIND_HOST=127.0.0.1
export ESCROW_GUI_ORIGIN=http://127.0.0.1:5174
export CAM_URI=http://127.0.0.1:5174/cam/main.json
export CAM_VIEWER_RESOURCE_ORIGIN=http://127.0.0.1:5174

files=(
  -f compose/escrow/local/deploy.yml
  -f compose/escrow/local/http.yml
  -f compose/escrow/local/viewer-gui.yml
)

docker compose "${files[@]}" up --build --detach escrow-anvil escrow-cam-http
docker compose "${files[@]}" run --build --rm --no-deps deploy-escrow-local
viewer_url="$(docker compose "${files[@]}" run --build --rm --no-deps -T escrow-viewer-url)"
printf '\n%s\n\n' "$viewer_url"
docker compose "${files[@]}" \
  up --build --force-recreate --abort-on-container-exit \
  cam-web escrow-browser-gateway
```

The browser query starts with the client as the viewer identity. Actual writes remain controlled by the injected browser wallet. Import only the explicit local fixture accounts and switch wallet accounts to exercise contractor and arbitrator actions.

Clean up with:

```bash
docker compose "${files[@]}" down --volumes --remove-orphans
```

## Verification

The deterministic suite covers core creation, validation, absent reads, enabled-action boundaries, no-acknowledgement acceptance, exact timeout functions, complete terminal paths, document retention, pull-payment accounting, failed transfers, alternate recipients, reentrancy, direct-transfer rejection, unknown selectors, and forced surplus. Projection tests cover backing-interface verification, creation policy, absent and instantiated machine observations, all stable state IDs, actor/time transition mapping at every deadline boundary, risk disclosures, account credit, and the read-only native-value boundary.

The fuzz suite checks arbitrary valid creation economics and, for every active state, compares selected writes against `availableActions` at `deadline - 1`, `deadline`, and `deadline + 1`. It also fuzzes full-value arbitration-timeout settlement for both configured beneficiaries.

The stateful invariant handler drives up to sixteen concurrent agreements across a fixed actor pool. It proves active and terminal amount conservation, aggregate-credit ownership, solvency, deadline shape, terminal action emptiness, terminal irreversibility, event/storage agreement for every successful transition, and exact single-beneficiary settlement deltas.

The CAM conformance suite loads the checked-in escrow bundle from repository bytes. It validates resource integrity, manifest/UI/ABI joins, nested route/value shape, exact transition bindings, and post-write continuation ownership.

Run the ordinary repository gates before the local real-RPC scenario:

```bash
make format DAPP=escrow
make fmt
make abi
make cam-integrity
make cam-conformance-check
make checks
make build
make script-build
make test
make package-test
```

`make abi` exports only manifest-declared contracts and then refreshes integrity pins. Its Compose service has write authority only over explicitly admitted CAM ABI directories; `cam-integrity` can rewrite only explicitly admitted manifests. A clean second `make abi` run is the generated-resource idempotence check.

The root Makefile does not yet expose escrow-specific wrappers for the three Compose workflows above. Until those wrappers are added, the commands in this section are the authoritative operator paths. No second Makefile is introduced.

## Explicit non-goals

V1 omits:

- arbitrator acknowledgement, consent proof, rationale, or compensation;
- neutral or decentralized arbitration guarantees;
- appeals, evidence rounds, partial awards, or milestones;
- amendments, deadline extension, or contractor resubmission;
- ERC-20 payments, fees, relayers, pause, ownership, upgrades, or recovery hooks;
- discovery, enumeration, privacy, reputation, or automatic timeout execution.
