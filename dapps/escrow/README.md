# CAM Escrow V1

`CamEscrow` is a non-upgradeable, single-milestone native-asset escrow. A client creates and funds an agreement in one payable transaction. The contractor may accept, submit committed work evidence, and receive payment after client approval, review timeout, or an arbitrator decision. The client may cancel before acceptance, dispute a submission, or recover funds after acceptance/work timeout or an arbitrator decision.

This package contains the core contract, the read-only `CamEscrowUI` semantic projection, the CAM 1.1 manifest/UI/ABI bundle, deterministic/fuzz/stateful verification, a local real-RPC vertical workflow, and explicit release deployment/verification lanes. It deliberately contains no generic CAM machine descriptor.

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

### Automated nine-path workflow

```bash
make escrow-local-scenario
```

The Make target owns the accepted checked-in CAM hash, internal resource URI, fixture broadcast path, Compose project, merged files, and teardown.

### Interactive real-RPC terminal

```bash
make escrow-viewer-terminal
```

The terminal starts as the client. Use:

```text
account <address>   switch to contractor, arbitrator, or finalizer
account none        render an anonymous account context
```

The terminal prepares writes but does not sign or submit them. It is useful for inspecting role-specific rendered actions and exact calldata/value preparation.

The target cleans up when the terminal exits. To clean up a separately interrupted project, run:

```bash
make escrow-viewer-terminal-down
```

### Browser viewer

```bash
make escrow-viewer-gui
```

The browser query starts with the client as the viewer identity. Actual writes remain controlled by the injected browser wallet. Import only the explicit local fixture accounts and switch wallet accounts to exercise contractor and arbitrator actions.

The target cleans up when the viewer exits. To clean up a separately interrupted project, run:

```bash
make escrow-viewer-gui-down
```

The default listener is `127.0.0.1:5174`. To admit another browser host, pass an explicit bind and matching origin:

```bash
ESCROW_GUI_BIND_HOST=0.0.0.0 \
ESCROW_GUI_ORIGIN=http://host:5174 \
make escrow-viewer-gui
```

## Release deployment

A release deployment is deliberately separate from the local fixture. It has no default chain, accepts no local fixture chain ID, obtains no private key from the process environment, and refuses a dirty source tree. The offline planning step validates the complete checked-in CAM bundle and computes the exact `keccak256` root hash stored in `CamRoot`.

For the first public rehearsal, prepare Ethereum Sepolia (`11155111`) but do not conflate it with the local Anvil workflow. Anvil is a disposable process on the operator's machine; Sepolia is a persistent public test network with externally funded accounts, provider RPC, public CAM hosting, wallet interaction, explorer records, and an explicit finality decision.

Publish the exact checked-in CAM bytes at the chosen URI before deployment. The release planner binds the URI and checked-in root hash; it does not fetch the remote publication. Viewers will reject the publication if the bytes served there do not match the hash stored in `CamRoot`.

Prepare two absolute, non-symlink secret files. Both files may contain credentials and must not be group- or world-readable:

```bash
umask 077
printf '%s\n' 'https://rpc.example.invalid' > /secure/escrow-rpc-url
printf '%s\n' '0x<32-byte-deployer-private-key>' > /secure/escrow-deployer-key
```

Choose a new normalized output directory outside the repository. It must not already exist; the deployment target creates it with mode `0700` and never deletes it on failure because an on-chain transaction may already have succeeded.

Run the release only from the exact clean commit intended for publication:

```bash
CONFIRM_ESCROW_RELEASE_DEPLOY=YES \
ESCROW_RELEASE_EXPECTED_CHAIN_ID=<chain-id> \
ESCROW_RELEASE_CAM_URI=https://published.example/escrow/cam/main.json \
ESCROW_RELEASE_INTENDED_CAM_ROOT_OWNER=0x<intended-root-owner> \
RPC_URL_FILE=/secure/escrow-rpc-url \
DEPLOYER_PRIVATE_KEY_FILE=/secure/escrow-deployer-key \
ESCROW_RELEASE_OUTPUT_DIR=/secure/releases/escrow-<chain>-<version> \
make escrow-release-deploy
```

The clean-tree check rejects visible uncommitted work that the selected commit archive would omit. The target then exports that exact commit into a private temporary ceremony directory; this archive owns the source used for dependency verification, release checks, compilation, planning, signing, and artifact generation. Each invocation derives unique Compose project names from the private directory. The snapshot is removed after successful teardown and retained for inspection if cleanup is incomplete. Docker daemon/context selection remains operator-owned.

The target writes:

```text
release-plan.json
broadcast/DeployEscrowRelease.s.sol/<chain-id>/run-latest.json
deployment.json
```

`release-plan.json` binds the source commit, expected chain, published CAM URI, computed CAM hash, and intended `CamRoot` owner. `deployment.json` records the three contract addresses, creation transaction hashes, deployed code hashes, deployer, final owner, and whether the ownership handoff has already been accepted.

`release-plan.json` is read directly by the signer, which independently compares its operator-owned fields to the authorized inputs and recomputes the CAM hash from the exact mounted bytes. `deployment.json` is the sole durable deployment artifact. Release files are staged and synced before no-clobber publication; a failed run preserves the output directory for forensic inspection.

The commit snapshot includes the installed npm tree after checking it against the archived lockfile and package graph. The repository does not yet prove every installed npm file byte against an independent checksum set; this lane therefore does not claim reproducible dependency-byte provenance.

The deployed `CamEscrow` and `CamEscrowUI` are immutable and have no owner, pause, upgrade, fee, sweep, or recovery authority. `CamRoot` remains mutable under its owner because it controls the published CAM URI/hash and contract-address bindings. If the intended root owner differs from the deployer, deployment starts an `Ownable2Step` transfer. The intended owner must review the addresses and artifact, then call `acceptOwnership()` independently. Do not treat the release as accepted while `pendingOwner()` is nonzero.

## Release verification

Run verification from the same exact clean source commit recorded in `deployment.json`:

```bash
RPC_URL_FILE=/secure/escrow-rpc-url \
ESCROW_DEPLOYMENT_ARTIFACT_FILE=/secure/releases/escrow-<chain>-<version>/deployment.json \
make escrow-release-verify
```

Verification begins offline. It strictly parses `deployment.json`, checks the current Git commit, validates the complete checked-in escrow CAM bundle, recomputes the root hash, and publishes one canonical container-volume snapshot. The receipt and Solidity checks then consume that same snapshot read-only. Only those later phases contact RPC.

The live verifier receives no signing key, has no transaction-submission RPC method, and does not use `--broadcast`. It checks:

- current chain ID and source commit;
- nonzero deployed code at all three addresses;
- exact runtime bytecode against contracts compiled from the current source tree;
- artifact code hashes;
- CAM URI and nonzero publication-derived CAM hash;
- final `CamRoot` ownership with no pending owner;
- exact `CamEscrow` and `CamEscrowUI` root bindings;
- the projection's immutable escrow address;
- ERC-165 interfaces;
- `totalLiabilities() <= address(CamEscrow).balance`.

A deployment whose two-step ownership transfer is still pending intentionally fails verification. The original `deployment.json` and companion remain immutable records of the post-deployment observation; they are not rewritten after ownership acceptance.

## Operational monitoring

Protect the final `CamRoot` owner as release authority; operationally, use an appropriately controlled account rather than the deployer hot key. Monitor:

- `OwnershipTransferStarted` and `OwnershipTransferred` on `CamRoot`;
- `CamUpdated` and `ContractAddressSet` on `CamRoot`;
- `AgreementCreated`, `AgreementStateChanged`, and `Withdrawal` on `CamEscrow`;
- `totalLiabilities()` against the escrow balance;
- active deadlines that require a public timeout transaction;
- arbitrator availability for disputed agreements.

No component automatically executes timeouts. The arbitrator is selected by each client and never acknowledges participation on-chain. A release process cannot turn those explicit V1 trust assumptions into neutrality or availability guarantees.

## Verification gates

The deterministic suite covers core creation, validation, absent reads, enabled-action boundaries, no-acknowledgement acceptance, exact timeout functions, complete terminal paths, document retention, pull-payment accounting, failed transfers, alternate recipients, reentrancy, direct-transfer rejection, unknown selectors, and forced surplus. Projection tests cover backing-interface verification, creation policy, absent and instantiated machine observations, all stable state IDs, actor/time transition mapping at every deadline boundary, risk disclosures, account credit, and the read-only native-value boundary.

The fuzz suite checks arbitrary valid creation economics and, for every active state, compares selected writes against `availableActions` at `deadline - 1`, `deadline`, and `deadline + 1`. It also fuzzes full-value arbitration-timeout settlement for both configured beneficiaries.

The stateful invariant handler drives up to sixteen concurrent agreements across a fixed actor pool. It proves active and terminal amount conservation, aggregate-credit ownership, solvency, deadline shape, terminal action emptiness, terminal irreversibility, event/storage agreement for every successful transition, and exact single-beneficiary settlement deltas.

The CAM conformance suite loads the checked-in escrow bundle from repository bytes. It validates resource integrity, manifest/UI/ABI joins, nested route/value shape, exact transition bindings, and post-write continuation ownership.

Run the ordinary repository gates before either a local scenario or release ceremony:

```bash
make format DAPP=escrow
make fmt
make abi
make cam-integrity
make cam-conformance-check
make escrow-release-check
make checks
make build
make script-build
make test
make package-test
```

`make abi` exports only manifest-declared contracts and then refreshes integrity pins. Its Compose service has write authority only over explicitly admitted CAM ABI directories; `cam-integrity` can rewrite only explicitly admitted manifests. A clean second `make abi` run is the generated-resource idempotence check.

## Explicit non-goals

V1 omits:

- arbitrator acknowledgement, consent proof, rationale, or compensation;
- neutral or decentralized arbitration guarantees;
- appeals, evidence rounds, partial awards, or milestones;
- amendments, deadline extension, or contractor resubmission;
- ERC-20 payments, fees, relayers, pause, ownership, upgrades, or recovery hooks;
- discovery, enumeration, privacy, reputation, or automatic timeout execution.
