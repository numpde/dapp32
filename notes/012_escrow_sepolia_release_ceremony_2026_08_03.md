# Escrow Sepolia Release Ceremony

Updated: 2026-10-11

Purpose: execute the first controlled public-testnet Escrow release from the
pinned release implementation, and preserve enough evidence to distinguish a
verified release, a pre-broadcast abort, and a partial on-chain release. This
note is an operational acceptance plan, not a second source of truth for
release behavior. The release scripts, artifacts, Compose files, and Escrow
README remain authoritative.

## Starting Point

Repository state selected for the ceremony:

```text
commit:     915c631dbc9d611f4805c2ac8ee7255df442bb53
network:    Ethereum Sepolia
chain ID:   11155111
```

The selected source passed 153 repository checks and package CI. Browser
acceptance ran in Chromium against a disposable local Anvil chain (31337), using
a test-only wallet provider. The previously failing regression cases now pass:
agreement-ID lookup, draft recovery through Back, discarding an unsigned
preparation, and visible, keyboard-accessible preparation results. Tests also
confirmed that wallet rejection submits nothing; controls remain frozen while
submission or confirmation is pending; and a lost submission reply leaves an
uncertain outcome after exactly one committed transaction, without automatic
resubmission. A confirmed transaction remains confirmed when view refresh fails.
The client, contractor, and arbitrator completed creation, acceptance, work
submission, dispute, resolution, and withdrawal, ending with zero contractor
credit. Eight fixture tests prove that a closed submission owner cannot begin
later effects, rejected key checks expose no key bytes, and the wallet SDK does
not submit again through another method after a transport failure.

This evidence does not establish Sepolia deployment or actual wallet-extension
approval behavior. Every ceremony checklist below remains pending until
performed against the pinned checkout. GitHub Pages remains a landing page;
this ceremony does not publish a hosted viewer.

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

- [ ] Confirm `HEAD` resolves to the selected commit.
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

- the full-commit-pinned public HTTPS CAM URL shown in Phase 2, with every
  declared local resource available beneath the same pinned path;
- the intended viewer origin (scheme, hostname, and port), chosen and recorded
  before broadcast, with browser loading verified from that origin;
- a Sepolia HTTPS RPC endpoint;
- a disposable, Sepolia-only funded deployer account;
- a distinct intended `CamRoot` owner controlled independently;
- an absolute protected RPC URL file;
- an absolute protected deployer private-key file;
- a new output-directory path outside the repository;
- an explicit confirmation/finality policy.

Use a dedicated testnet deployer. Do not reuse a mainnet key or the intended
owner's key.

Example protected files, entered through silent Bash prompts. Use a private
directory you control and new file paths; do not paste credentials into the
commands themselves. The local origin `http://127.0.0.1:5185` used for acceptance
does not select the ceremony's viewer origin.

```bash
set +x
umask 077
set -o noclobber

read -r -s -p 'Sepolia HTTPS RPC URL: ' escrow_rpc_url_input
printf '\n'
builtin printf '%s\n' "$escrow_rpc_url_input" \
  > /secure/escrow-sepolia-rpc
unset escrow_rpc_url_input

read -r -s -p 'Disposable Sepolia deployer private key: ' escrow_deployer_key_input
printf '\n'
builtin printf '%s\n' "$escrow_deployer_key_input" \
  > /secure/escrow-sepolia-deployer
unset escrow_deployer_key_input
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
- [ ] Intended viewer origin is recorded and browser loading from it is verified.

## Phase 1 — Freeze Release Identity

The selected source commit predates this version of the instructions. Check out
that exact commit in detached HEAD; later documentation commits do not change
the release selection.
Keep these instructions available outside the checkout before switching.

Run from a clean checkout:

```bash
set -e
test -z "$(git status --porcelain --untracked-files=all)"

git fetch origin
git switch --detach 915c631dbc9d611f4805c2ac8ee7255df442bb53

test "$(git rev-parse HEAD)" = \
  "915c631dbc9d611f4805c2ac8ee7255df442bb53"

test -z "$(git status --porcelain --untracked-files=all)"
```

Record without exposing secrets:

```text
source commit
Sepolia chain ID
CAM root URI
intended viewer origin
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

The selected public path for the checked-in Escrow CAM directory is at the
GitHub commit. The CAM root URL is:

```text
https://raw.githubusercontent.com/numpde/dapp32/915c631dbc9d611f4805c2ac8ee7255df442bb53/dapps/escrow/cam/main.json
CAM_HASH=0xe06f268057be3d32e11ab8e897683376760dfa7550c95943032434e0a4f44430
```

`CAM_HASH` is Keccak-256 of the exact root file bytes. The full commit hash pins
the resource path. The resource origin is
`https://raw.githubusercontent.com`; the operator must verify browser loading
from the intended viewer origin. The bundle must contain at least:

```text
main.json
ui.json
abi/CamEscrow.json
abi/CamEscrowUI.json
```

Candidate publication observation (2026-10-11): two independent HTTPS fetches
of all four resources returned 200 without redirects and matched the selected
checkout byte-for-byte. Responses used `text/plain; charset=utf-8` and
`Access-Control-Allow-Origin: *`. Local publication preflight reported no issues
and the root hash above. A fresh Chromium tab at `http://127.0.0.1:5185` fetched
all four pinned URLs through browser CORS, without redirects, and matched their
lengths and SHA-256 hashes. The CAM loader parses JSON from response bytes, so
the observed `text/plain` content type is usable. This proves resource access
from that local origin; it does not prove a deployed viewer anchored to this raw
bundle. Repeat these checks from the intended viewer origin before signing.

Historical publication evidence (2026-10-11) belongs to the superseded source
`5a5a9449bb4aa4807508802c2ebadfa315424bfc` and root hash
`0x08f41b8991602fa55e28230933cf6642345a28d1bbf0c18215ae044608a6fb66`.
Two HTTPS fetches of its four resources matched that commit's bytes without
redirects; CORS headers permitted cross-origin loading and local preflight found
no issues. That immutable bundle remains historical evidence, not the candidate
selected for this ceremony.

Do not reserialize, reindent, normalize newlines, or regenerate resources at the
hosting layer.

Run the repository-owned preflight for local CAM validation and `CAM_HASH`.
It does not fetch the public URL or prove browser CORS:

```bash
CAM_URI=https://raw.githubusercontent.com/numpde/dapp32/915c631dbc9d611f4805c2ac8ee7255df442bb53/dapps/escrow/cam/main.json \
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
ESCROW_RELEASE_CAM_URI=https://raw.githubusercontent.com/numpde/dapp32/915c631dbc9d611f4805c2ac8ee7255df442bb53/dapps/escrow/cam/main.json \
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
