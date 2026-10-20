# CAM Escrow V1

`CamEscrow` is a non-upgradeable, single-milestone native-asset escrow. A client creates and funds an agreement in one payable transaction. The contractor may accept and submit committed work evidence. Client approval, timeout finalization, or an arbitrator decision closes the agreement and credits the beneficiary; that account must withdraw separately to receive the funds. The client may cancel before acceptance, dispute a submission, or receive refund credit after acceptance/work timeout or an arbitrator decision.

This package contains the core contract, the read-only `CamEscrowUI` semantic projection, the CAM 1.2 manifest/UI/ABI bundle, deterministic/fuzz/stateful verification, a local real-RPC vertical workflow, and explicit release deployment/verification lanes. It deliberately contains no generic CAM machine descriptor.

## Roles and trust

Each agreement stores three pairwise-distinct addresses:

- `client`: creates and funds the agreement;
- `contractor`: may accept and submit;
- `arbitrator`: may resolve a dispute before its arbitration deadline.

The client selects the arbitrator. Agree on their participation and terms before funding.

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

If the arbitrator does not act before the arbitration deadline, anyone may finalize the timeout to credit the configured party with the complete agreement amount. The beneficiary must withdraw separately. V1 has no split, percentage, rounding rule, dual credit, or residual agreement liability.

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

Account credit aggregates settlements across this escrow contract. Only the credit owner can call `withdrawTo`, and it sends their complete current credit to the chosen recipient. Viewing another account's credit does not authorize withdrawal from it. If the recipient rejects payment, the transaction reverts and the credit remains available.

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

### Calculate a document digest in the browser

The terms, submission, and dispute forms use `DocumentHashField` for the existing scalar SHA-256 digest. Publish the document separately and enter its URI. Then choose one of three ways to supply the digest:

- Enter `0x` followed by 64 hexadecimal characters manually. Invalid format is reported beside the field without changing your entry; escrow also requires a nonzero digest.
- Select **Calculate from file** and choose the exact saved file. Calculation stays on the device and does not upload the file or check what the URI serves.
- Select **Calculate from URL** to read the current HTTP(S) URI and hash the bytes returned after HTTP decoding. This starts only when requested; rendering the form or editing a URI does not download a document.

Calculation is limited to 8 MiB and a 15-second deadline. URL access requires browser CORS permission, sends no credentials or referrer, and rejects redirects. If the URL is unreadable, choose a local file or enter a digest manually; the viewer does not switch methods automatically or use a server proxy. Larger documents can use a digest calculated externally.

A successful calculation replaces the digest. Failure or cancellation keeps the current digest. Editing the URI also keeps the digest, but clears the previous calculation's association with that URI and cancels work tied to the old source. Check the URI and digest together before preparing the transaction.

This field calculates a digest; it does not compare retrieved bytes with an existing expected digest. File calculation does not prove that the URI serves the file. URL calculation describes the response at that time, not what a mutable URL will serve later. Exact bytes are hashed without text conversion or JSON normalization; IPFS retrieval and canonical JSON hashing are not supported by this helper. Contract document checks and transaction authorization are unchanged.

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

## CAM 1.2 bundle

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

Every stored transition continues to the canonical `agreement(agreementId)` observation. Creation continues by client/reference lookup. Withdrawal continues to the caller's account-credit observation. In active agreement views, unavailable transition buttons and their input fields remain visible but disabled. Enabled transitions come from `CamEscrowUI`; the UI does not infer actor or deadline legality. The escrow contract checks authorization and deadlines again when a transaction executes.

There is deliberately no generic CAM machine resource. `escrow.agreement.v1` and its stable state/transition IDs remain an application projection until another application demonstrates a small repeated protocol need.

## Local vertical workflow

Install the locked dependencies first with `make dapps/deps/install` and `make js/deps/install` from the repository root. The local scenario and demo commands below deploy fresh disposable fixtures and attempt cleanup when they exit. Chain state is removed only when cleanup succeeds.

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
make escrow/local/scenario/run
```

The local deployment script hashes the exact mounted `cam/main.json` bytes before broadcasting. The Make target owns the internal resource URI, fixture broadcast path, Compose project, merged files, and teardown.

### Interactive real-RPC terminal

```bash
make escrow/local/demo/terminal/up
```

The terminal starts as the client. Use:

```text
account <address>   switch to contractor, arbitrator, or finalizer
account none        render an anonymous account context
```

The terminal prepares writes but does not sign or submit them. It is useful for inspecting role-specific rendered actions and exact calldata/value preparation.

The target attempts cleanup when the terminal exits. If interruption or cleanup failure leaves a project running, run:

```bash
make escrow/local/demo/terminal/down
```

### Browser viewer

```bash
make escrow/local/demo/gui/up
```

Open the full URL printed by the command. Its account parameter starts the viewer as the client; it grants no wallet access. You can read views without connecting a wallet. **Connect wallet** replaces the viewed account with the wallet account and refreshes the role-specific controls. Import only the explicit local fixture accounts to exercise contractor and arbitrator actions.

After connection, wallets that report account and network changes update the viewer automatically and clear unsent prepared calls. After an account change, wait for the refreshed view, check the account and chain, then prepare anew. A different wallet network does not change the viewer's configured chain or RPC; sending stays disabled until the wallet returns to that chain. Disconnecting retains the last successful read-only view. Wallet changes do not erase a submitted transaction hash or stop its receipt tracking. If your provider cannot report changes, use **Switch wallet** to reconnect after changing accounts or networks.

An agreement-changing button prepares and simulates a call. Check the viewed account and network, review the call's target, calldata, and native value, then use **Send with wallet** to request wallet submission. Preparation is not a transaction. Confirmation closes or advances the agreement; settlement funds remain account credit until a separate withdrawal transaction succeeds.

The address bar tracks the current read route and inputs, so copying its URL can reopen an agreement or account-credit view. It does not preserve unsent form edits, prepared calls, or wallet access, and reopening reads current chain state. The URL includes the RPC endpoint and viewed account: use a public read RPC when sharing links, and keep credentials out of it.

With the GUI running and a separate browser profile exposing CDP on loopback, run the optional live browser check in another terminal. CDP grants control of that browser profile. Replace the placeholders with the full URL printed by the GUI and the expected onchain CAM URI and nonzero hash:

```bash
CDP_ORIGIN=http://127.0.0.1:9222 \
VIEWER_URL='paste full printed GUI URL' \
EXPECTED_CAM_URI='paste expected CAM URI' \
EXPECTED_CAM_HASH='paste expected 0x-prefixed CAM hash' \
make escrow/live/browser/check
```

The check opens and closes its own tab. It verifies onchain resource identity, CAM integrity, read navigation, and failure messages and overflow at desktop and narrow widths. It performs no wallet-signed writes and is outside offline CI.

To exercise signed transactions on the disposable fixture chain, use the same four environment variables with `make escrow/live/browser/fixture-writes/check`. This separate opt-in lane requires the locked workspace dependencies installed by `make js/deps/install`. It verifies their installed dependency graph and builds `@cam/protocol` in container-local tmpfs to consume its public HTTP validators and bounded reader. It checks the actual RPC chain ID `31337`, the contract-anchored CAM bytes and ABI integrity, and the Escrow target before signing with the obvious fixture keys declared in `compose/escrow/local/deploy.yml`. It signs and sends real local transactions, including a complete dispute and credit withdrawal workflow; do not use it with a chain containing valuable state.

The write check injects a test provider into fresh tabs that it owns and closes. It checks recovery from wallet rejection, a held submission or receipt, a lost reply after broadcast, and a confirmed transaction whose following view refresh fails. Actions use DOM activation; this lane does not prove physical pointer input or wallet-extension approval behavior. Both browser lanes grant ordinary host-network egress to reach the operator's loopback endpoints and leave existing browser tabs and services running.

`make escrow/local/demo/gui/up` attempts fixture cleanup when its foreground command exits. Closing the browser check's tab does not stop the GUI. If interruption or cleanup failure leaves a project running, run:

```bash
make escrow/local/demo/gui/down
```

The default listener is `127.0.0.1:5174`. To admit another browser host, pass an explicit bind and matching origin:

```bash
ESCROW_GUI_BIND_HOST=0.0.0.0 \
ESCROW_GUI_ORIGIN=http://host:5174 \
make escrow/local/demo/gui/up
```

## Release deployment

For guided setup, run `make escrow/release/setup CONFIG=/absolute/private/escrow.json`,
then `make escrow/release/deploy CONFIG=/absolute/private/escrow.json`.
The [shared walkthrough](../../docs/release-ceremony.md#deploy-to-the-selected-chain)
saves every app input, concrete RPC URL, signing key and deployment confirmation
in one protected off-repo file. Use the same `CONFIG` for release verification.

A release deployment is deliberately separate from the local fixture. It has no default chain and accepts no local fixture chain ID. The offline planning step validates the complete checked-in CAM bundle and computes the exact-byte SHA-256 root digest stored in `CamRoot`.

Shared source-snapshot, secret-file, output, Compose-isolation, one-shot, and verification-snapshot rules are documented in [the release ceremony guide](../../docs/release-ceremony.md).

For the first public rehearsal, prepare Ethereum Sepolia (`11155111`) but do not conflate it with the local Anvil workflow. Anvil is a disposable process on the operator's machine; Sepolia is a persistent public test network with externally funded accounts, provider RPC, public CAM hosting, wallet interaction, explorer records, and an explicit finality decision.

Publish the exact checked-in CAM bytes and their declared protocol/ABI/UI resources at the chosen URI before deployment. The release planner binds the URI and checked-in root hash; it does not fetch the remote publication. Viewers will reject the publication if the bytes served there do not match the hash stored in `CamRoot`.

Prepare the RPC and deployer-key files:

```bash
umask 077
printf '%s\n' 'https://rpc.example.invalid' > /secure/escrow-rpc-url
printf '%s\n' '0x<32-byte-deployer-private-key>' > /secure/escrow-deployer-key
```

Run the release only from the exact clean commit intended for publication:

```bash
CONFIRM_ESCROW_RELEASE_DEPLOY=YES \
ESCROW_RELEASE_EXPECTED_CHAIN_ID=<chain-id> \
ESCROW_RELEASE_CAM_URI=https://published.example/escrow/cam/main.json \
ESCROW_RELEASE_INTENDED_CAM_ROOT_OWNER=0x<intended-root-owner> \
RPC_URL_FILE=/secure/escrow-rpc-url \
DEPLOYER_PRIVATE_KEY_FILE=/secure/escrow-deployer-key \
ESCROW_RELEASE_OUTPUT_DIR=/secure/releases/escrow-<chain>-<version> \
make escrow/release/deploy
```

The target writes:

```text
plan/release-plan.json
broadcast/DeployEscrowRelease.s.sol/<chain-id>/run-latest.json
artifact/deployment.json
```

The `escrow.release-plan.v2` and `escrow.deployment.v2` schemas identify SHA-256 manifest commitments; older v1 artifacts retain their Keccak meaning and are rejected by these lanes.

`plan/release-plan.json` binds the source commit, expected chain, published CAM URI, computed CAM hash, and intended `CamRoot` owner. `artifact/deployment.json` records the three contract addresses, creation transaction hashes, deployed code hashes, deployer, and intended `CamRoot` owner. It also records whether an ownership transfer was required and whether that account owned `CamRoot` with no transfer pending when the artifact was created.

The deployed `CamEscrow` and `CamEscrowUI` are immutable and have no owner, pause, upgrade, fee, sweep, or recovery authority. `CamRoot` remains mutable under its owner because it controls the published CAM URI/hash and contract-address bindings. If the intended root owner differs from the deployer, deployment starts an `Ownable2Step` transfer. The intended owner must review the addresses and artifact, then call `acceptOwnership()` independently. Do not treat the release as accepted while `pendingOwner()` is nonzero.

## Release verification

Run verification from the same exact clean source commit recorded in `deployment.json`:

```bash
RPC_URL_FILE=/secure/escrow-rpc-url \
ESCROW_DEPLOYMENT_ARTIFACT_FILE=/secure/releases/escrow-<chain>-<version>/artifact/deployment.json \
make escrow/release/verify
```

The verifier checks:

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

A deployment whose two-step ownership transfer is still pending intentionally fails verification. The original `deployment.json` remains an immutable record of the post-deployment observation; it is not rewritten after ownership acceptance.

## Operational monitoring

Protect the final `CamRoot` owner as release authority; operationally, use an appropriately controlled account rather than the deployer hot key. Monitor:

- `OwnershipTransferStarted` and `OwnershipTransferred` on `CamRoot`;
- `CamUpdated` and `ContractAddressSet` on `CamRoot`;
- `AgreementCreated`, `AgreementStateChanged`, and `Withdrawal` on `CamEscrow`;
- `totalLiabilities()` against the escrow balance;
- active deadlines that require a public timeout transaction;
- arbitrator availability for disputed agreements.

No component automatically executes timeouts. The arbitrator is selected by each client and never acknowledges participation on-chain.

## Verification gates

The deterministic suite covers core creation, validation, absent reads, enabled-action boundaries, no-acknowledgement acceptance, exact timeout functions, complete terminal paths, document retention, pull-payment accounting, failed transfers, alternate recipients, reentrancy, direct-transfer rejection, unknown selectors, and forced surplus. Projection tests cover backing-interface verification, creation policy, absent and instantiated machine observations, all stable state IDs, actor/time transition mapping at every deadline boundary, risk disclosures, account credit, and the read-only native-value boundary.

The fuzz suite checks arbitrary valid creation economics and, for every active state, compares selected writes against `availableActions` at `deadline - 1`, `deadline`, and `deadline + 1`. It also fuzzes full-value arbitration-timeout settlement for both configured beneficiaries.

The stateful invariant handler drives up to sixteen concurrent agreements across a fixed actor pool. It proves active and terminal amount conservation, aggregate-credit ownership, solvency, deadline shape, terminal action emptiness, terminal irreversibility, event/storage agreement for every successful transition, and exact single-beneficiary settlement deltas.

The CAM conformance suite loads the checked-in escrow bundle from repository bytes. It validates resource integrity, manifest/UI/ABI joins, nested route/value shape, exact transition bindings, and post-write continuation ownership.

Run the ordinary repository gates before either a local scenario or release ceremony:

```bash
make dapps/format DAPP=escrow
make dapps/format/check
make cam/abi/export
make cam/integrity/refresh
make cam/conformance/check
make escrow/release/check
make tests/checks
make dapps/build
make dapps/scripts/build
make dapps/tests
make js/tests
```

`make cam/abi/export` exports only manifest-declared contracts and then refreshes integrity pins. Its Compose service has write authority only over explicitly admitted CAM ABI directories; `cam/integrity/refresh` can rewrite only explicitly admitted manifests. A clean second `make cam/abi/export` run is the generated-resource idempotence check.

## Explicit non-goals

V1 omits:

- arbitrator acknowledgement, consent proof, rationale, or compensation;
- neutral or decentralized arbitration guarantees;
- appeals, evidence rounds, partial awards, or milestones;
- amendments, deadline extension, or contractor resubmission;
- ERC-20 payments, fees, relayers, pause, ownership, upgrades, or recovery hooks;
- discovery, enumeration, privacy, reputation, or automatic timeout execution.
