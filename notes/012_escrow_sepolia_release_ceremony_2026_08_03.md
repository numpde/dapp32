# Escrow Sepolia Release Ceremony

Date: 2026-08-03

Purpose: execute the first controlled public-testnet Escrow release from the
pinned release implementation, and preserve enough evidence to distinguish a
verified release, a pre-broadcast abort, and a partial on-chain release. This
note is an operational acceptance plan, not a second source of truth for
release behavior. The release scripts, artifacts, Compose files, and Escrow
README remain authoritative.

## Starting Point

Repository state selected for the ceremony:

```text
repository: numpde/dapp32
branch:     agent/cam-escrow-core
commit:     a278599c19c81b1f66d2455638dbd2c4e0ba2dc7
network:    Ethereum Sepolia
chain ID:   11155111
```

The release boundary is considered implementation-complete before this note:

- exact-commit source snapshots own planning, compilation, signing, and
  artifact materialization;
- locked Solidity dependencies and the installed npm graph are checked inside
  the snapshot;
- release files have phase-specific `plan/`, `broadcast/`, and `artifact/`
  write authority;
- only the signer receives the deployment key and a send-capable RPC path;
- deployment is intentionally one-shot;
- verification consumes one canonical immutable artifact snapshot and has no
  signing or transaction-submission authority.

Checklist:

- [ ] Confirm the branch still resolves to the selected commit.
- [ ] Confirm the worktree is clean.
- [ ] Treat any source change as a new ceremony requiring new authorization.
- [ ] Do not combine this package with Bike NFT deployment.

## Objective

Perform one controlled Escrow release and prove that:

1. the published CAM bundle is byte-correct and browser-accessible;
2. deployment occurs through the constrained signing lane;
3. the durable artifact is complete and creation-provenance-bound;
4. verification rejects the expected pending-ownership state;
5. the intended owner accepts ownership independently;
6. final read-only verification passes against the original artifact;
7. release Compose resources and private source snapshots are cleaned up;
8. no automatic retry, recovery, or second deployment occurs.

## Required Operator Inputs

Do not begin live work until all of these exist:

- a versioned public HTTPS URL for `dapps/escrow/cam/main.json` and every
  declared local CAM resource;
- a Sepolia HTTPS RPC endpoint;
- a disposable, Sepolia-only funded deployer account;
- a distinct intended `CamRoot` owner controlled independently;
- an absolute protected RPC URL file;
- an absolute protected deployer private-key file;
- a new output-directory path outside the repository;
- an explicit confirmation/finality policy.

Use a dedicated testnet deployer. Do not reuse a mainnet key or the intended
owner's key.

Example protected files:

```bash
umask 077

printf '%s\n' 'https://<sepolia-rpc-endpoint>' \
  > /secure/escrow-sepolia-rpc

printf '%s\n' '0x<disposable-sepolia-deployer-private-key>' \
  > /secure/escrow-sepolia-deployer
```

Do not copy secrets into the repository, release output, shell history,
ceremony report, or deployment artifact.

Checklist:

- [ ] Deployer is Sepolia-only and expendable.
- [ ] Intended owner differs from the deployer.
- [ ] RPC and key files are regular, non-symlink, mode-protected files.
- [ ] Deployer has enough test ETH for one deployment and no valuable assets.
- [ ] Maximum acceptable test-ETH expenditure is declared before broadcast.
- [ ] Confirmation/finality threshold is declared before broadcast.

## Phase 1 — Freeze Release Identity

Run:

```bash
git fetch origin
git switch agent/cam-escrow-core
git pull --ff-only

test "$(git rev-parse HEAD)" = \
  "a278599c19c81b1f66d2455638dbd2c4e0ba2dc7"

test -z "$(git status --porcelain --untracked-files=all)"
```

Record without exposing secrets:

```text
source commit
Sepolia chain ID
CAM root URI
intended CamRoot owner
public deployer address
chosen output directory
confirmation/finality policy
maximum permitted test-ETH expenditure
```

Resolve the deployer address from the key without printing the key.

Abort and restart from this phase if the selected commit changes.

Checklist:

- [ ] Exact commit recorded.
- [ ] Clean worktree recorded.
- [ ] Public deployer address recorded.
- [ ] Intended owner recorded.
- [ ] Output path does not exist and is outside the repository.

## Phase 2 — Publish and Verify the CAM Bundle

Publish the complete checked-in Escrow CAM directory at one immutable or
versioned path. At minimum the publication must contain:

```text
main.json
ui.json
abi/CamEscrow.json
abi/CamEscrowUI.json
```

Do not reserialize, reindent, normalize newlines, or regenerate resources at the
hosting layer.

Run the repository-owned preflight:

```bash
CAM_URI=https://<public-host>/escrow/v1/main.json \
make cam-publication-preflight DAPP=escrow
```

Independently fetch the public resources into a private temporary directory and
compare them byte-for-byte with the checked-in files. Prove:

- public `main.json` equals `dapps/escrow/cam/main.json` byte-for-byte;
- every locally declared UI and ABI resource equals its checked-in counterpart;
- all requests succeed over HTTPS;
- JSON resources have usable content types;
- browser-compatible CORS is present for the intended viewer origin;
- redirects do not lead to mutable editor or download pages;
- repeated fetches return identical bytes.

Record local and remote hashes.

Abort before signing if:

- any remote byte differs;
- a declared resource is unavailable;
- CORS prevents browser loading;
- redirects are unexpected;
- the publication is not stable enough for the rehearsal.

Do not modify checked-in CAM bytes during the ceremony merely to match hosted
content.

Checklist:

- [ ] Local CAM preflight passed.
- [ ] Root bytes match remotely.
- [ ] All declared resource bytes match remotely.
- [ ] HTTPS, content type, CORS, and redirect behavior were checked.
- [ ] Repeated fetches were stable.

## Phase 3 — Repeat Focused Local Acceptance

Run from the clean pinned checkout:

```bash
make format DAPP=escrow
git diff --check
git diff --exit-code

make escrow-release-check
make cam-conformance-check
make fmt
make build
make script-build
make test
make package-test
```

A failure aborts the ceremony. Do not continue because a failure appears
unrelated.

Check and record the deployer's Sepolia balance immediately before deployment.

Checklist:

- [ ] Formatting left no diff.
- [ ] Escrow release checks passed.
- [ ] CAM conformance passed.
- [ ] Forge formatting, build, scripts, and tests passed.
- [ ] Package tests passed.
- [ ] Pre-deployment balance recorded.

## Phase 4 — Deploy Exactly Once

Choose a new output path whose parent exists but whose final directory does not,
for example:

```text
/secure/releases/escrow-sepolia-v1
```

Run exactly once:

```bash
CONFIRM_ESCROW_RELEASE_DEPLOY=YES \
ESCROW_RELEASE_EXPECTED_CHAIN_ID=11155111 \
ESCROW_RELEASE_CAM_URI=https://<public-host>/escrow/v1/main.json \
ESCROW_RELEASE_INTENDED_CAM_ROOT_OWNER=0x<intended-owner> \
RPC_URL_FILE=/secure/escrow-sepolia-rpc \
DEPLOYER_PRIVATE_KEY_FILE=/secure/escrow-sepolia-deployer \
ESCROW_RELEASE_OUTPUT_DIR=/secure/releases/escrow-sepolia-v1 \
make escrow-release-deploy
```

Expected durable outputs:

```text
/secure/releases/escrow-sepolia-v1/
  plan/release-plan.json
  broadcast/DeployEscrowRelease.s.sol/11155111/run-latest.json
  artifact/deployment.json
```

Before any subsequent transaction, inspect `artifact/deployment.json` and
record:

```text
source commit
chain ID
deployer
intended CamRoot owner
CAM URI
CAM hash
CamRoot address
CamEscrow address
CamEscrowUI address
three creation transaction hashes
three runtime code hashes
ownershipTransferRequired
ownershipAccepted
```

Independently confirm from Sepolia RPC or an explorer that:

- all creation transactions succeeded;
- each transaction created the artifact's claimed contract;
- all three transactions came from the expected deployer;
- all three addresses contain nonempty code;
- `CamRoot.owner()` is the deployer;
- `CamRoot.pendingOwner()` is the intended owner;
- both `CamRoot` contract bindings are correct.

Wait for the declared confirmation/finality threshold.

### One-shot rule

If any deployment transaction succeeded but artifact materialization or cleanup
failed:

- do not rerun `make escrow-release-deploy`;
- preserve the complete output directory;
- preserve any retained ceremony snapshot;
- inspect the Forge broadcast and chain receipts;
- report a partial on-chain release.

Do not add or invoke an automatic retry or redeployment path.

Checklist:

- [ ] Deployment command was invoked once.
- [ ] Release plan exists.
- [ ] Forge broadcast exists.
- [ ] Deployment artifact exists or partial state is reported.
- [ ] Creation transactions and contract addresses were independently checked.
- [ ] Ownership handoff is pending exactly as intended.
- [ ] Confirmation/finality threshold was met.

## Phase 5 — Prove Pre-Handoff Verification Fails

Before ownership acceptance, run:

```bash
RPC_URL_FILE=/secure/escrow-sepolia-rpc \
ESCROW_DEPLOYMENT_ARTIFACT_FILE=/secure/releases/escrow-sepolia-v1/artifact/deployment.json \
make escrow-release-verify
```

The command is expected to fail specifically because `CamRoot` ownership is
pending.

Record:

```text
exit status
failing verifier boundary
current owner
pending owner
confirmation that verification had no signing key
confirmation that verification exposed no transaction-submission method
```

Any other failure is unexpected. Diagnose it before ownership acceptance,
because it may indicate artifact, bytecode, CAM, chain, or provenance drift.

Do not weaken verification to make the negative test pass.

Checklist:

- [ ] Verification failed.
- [ ] Failure was specifically pending ownership.
- [ ] No transaction was signed or submitted by verification.
- [ ] No other verification boundary failed first.

## Phase 6 — Complete the Independent Ownership Handoff

The intended owner must independently inspect:

```text
CamRoot address
CamEscrow address
CamEscrowUI address
CAM URI and hash
source commit
creation transactions
current owner
pending owner
```

The intended owner then calls:

```solidity
CamRoot.acceptOwnership()
```

Use the intended owner's own wallet or signing process. Do not use the deployment
key or release-signing container.

Record the acceptance transaction hash and wait for the declared
confirmation/finality threshold.

Verify directly:

```text
CamRoot.owner() == intended owner
CamRoot.pendingOwner() == address(0)
```

Checklist:

- [ ] Intended owner independently reviewed release identity.
- [ ] Ownership acceptance transaction succeeded.
- [ ] Finality threshold was met.
- [ ] Final owner and zero pending owner were directly observed.

## Phase 7 — Prove Final Verification Succeeds

Hash the original artifact, then run:

```bash
RPC_URL_FILE=/secure/escrow-sepolia-rpc \
ESCROW_DEPLOYMENT_ARTIFACT_FILE=/secure/releases/escrow-sepolia-v1/artifact/deployment.json \
make escrow-release-verify
```

The verifier must establish:

- exact source commit and chain;
- all three creation receipts and contract addresses;
- exact deployed runtime bytecode;
- artifact code hashes;
- exact CAM URI and hash;
- completed `CamRoot` ownership;
- zero pending owner;
- exact Escrow and UI bindings;
- UI's immutable Escrow backing address;
- required ERC-165 interfaces;
- Escrow solvency.

Hash `deployment.json` again and prove that verification did not rewrite it.

Checklist:

- [ ] Final verification passed.
- [ ] Artifact hash was unchanged.
- [ ] Original artifact was not replaced after handoff.
- [ ] Verification used no signing authority.

## Phase 8 — Cleanup and Forensic Evidence

Confirm that no repository-owned ceremony resources remain:

```text
no release containers
no release networks
no release named volumes
no unexplained /tmp/cam-release-* directory
clean Git worktree
unchanged source HEAD
```

Do not delete the durable external release directory.

Create a separate non-secret ceremony report containing:

```text
source commit
network and chain ID
public CAM URI
local and remote CAM hashes
public deployer address
intended owner address
three contract addresses
three creation transaction hashes
ownership-acceptance transaction hash
artifact SHA-256
expected pre-handoff verification failure
successful post-handoff verification result
confirmation/finality observations
gas used and test-ETH expenditure
cleanup result
all deviations and warnings
```

Do not include private keys, RPC credentials, wallet seed material, or raw secret
file contents.

Checklist:

- [ ] Compose resources removed.
- [ ] Temporary source snapshot removed or retained path reported.
- [ ] Repository head and cleanliness rechecked.
- [ ] Durable release evidence retained.
- [ ] Non-secret ceremony report completed.

## Change Control

This package should normally create no repository commits.

If a source defect is found before broadcast:

1. stop the ceremony;
2. implement the smallest focused correction;
3. run the complete acceptance suite;
4. commit and fast-forward push;
5. report the new head;
6. obtain fresh ceremony authorization for the new commit.

If a defect is found after broadcast:

1. do not silently modify source and continue;
2. do not redeploy automatically;
3. preserve all evidence;
4. report exact on-chain and local state;
5. design remediation separately from the original ceremony.

## Explicit Non-Goals

Do not include:

- Bike NFT deployment;
- mainnet deployment;
- another release-framework abstraction;
- automatic ownership acceptance;
- automatic redeployment or recovery;
- a new upgrade or admin mechanism;
- a generic role or event indexer;
- production viewer hosting;
- arbitrary live agreement traffic;
- source changes merely to make the ceremony report cleaner.

## Outcome Classification

Report exactly one outcome.

### `RELEASE_VERIFIED`

Include:

- exact source head;
- publication evidence;
- deployment artifact location and hash;
- contract and transaction identities;
- expected pending-ownership verification failure;
- ownership acceptance evidence;
- final successful verification;
- cleanup evidence;
- clean and synchronized repository state.

### `ABORTED_BEFORE_BROADCAST`

Include:

- the failing precondition;
- proof that no transaction was signed or submitted;
- any proposed source correction as a separate work package.

### `PARTIAL_ON_CHAIN_RELEASE`

Include:

- every transaction that succeeded;
- current ownership and binding state;
- preserved output and snapshot paths;
- the precise failed phase;
- explicit confirmation that no retry or redeployment occurred.

## Follow-Up

After `RELEASE_VERIFIED`, the next package should exercise one small-value Escrow
agreement through the CAM interaction path, then rerun release verification
after activity. Bike NFT public-testnet deployment should follow only after that
shared release and interaction path has produced real operational evidence.
