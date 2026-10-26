import assert from "node:assert/strict"
import test from "node:test"
import { keccak256, parseAbi, sha256, zeroAddress, zeroHash, type Address, type Hex } from "viem"
import { parseCamAttempt, parseCamPublication, rootFromArtifact, type CamPublicationAttempt } from "./publication.ts"
import { admitExistingCamRoot, assertCamAttemptIntent, assertCamNominationComplete } from "./root.ts"
import { camPublicationReference } from "./reference.ts"
import type { AdmittedCamComponents } from "./components.ts"
import { parseCamReleasePlan, type CamReleasePlan } from "./shared.ts"

const rootAddress = `0x${"11".repeat(20)}` as Address
const signer = `0x${"22".repeat(20)}` as Address
const business = `0x${"33".repeat(20)}` as Address
const ui = `0x${"44".repeat(20)}` as Address
const nominee = `0x${"55".repeat(20)}` as Address
const other = `0x${"66".repeat(20)}` as Address
const digest = `0x${"77".repeat(32)}` as Hex
const transaction = `0x${"88".repeat(32)}` as Hex
const failedTransaction = `0x${"99".repeat(32)}` as Hex
const code = "0x6000" as const
const input = "0x60011234" as const
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

function fixture(app: "pay-to-play" | "bike-nft") {
  const desiredBindings = app === "bike-nft" ? [
    { name: "ICamRootOwnership", address: { createdContract: "camRoot" } },
    { name: "BicycleComponentManager", address: business }, { name: "BicycleComponentManagerUI", address: ui },
    { name: "BicycleComponents", address: other },
  ] : [{ name: "PayToPlay", address: business }, { name: "PayToPlayUI", address: ui }]
  const plan = parseCamReleasePlan(encode({ schema: "cam.publication-plan.v1", app,
    sourceCommit: "a".repeat(40), expectedChainId: 31338,
    businessArtifactSha256: digest, uiArtifactSha256: digest, bundleArtifactSha256: digest,
    observationBlock: { number: "0x1", hash: digest }, bindings: desiredBindings,
    manifest: { uri: "ipfs://desired/main.json", hash: zeroHash }, intendedOwner: nominee, nomination: "nominate", root: { kind: "new" } }))
  const observation = {
    app, sourceCommit: plan.sourceCommit, chainId: plan.expectedChainId, signer,
    planSha256: sha256(new TextEncoder().encode(`${JSON.stringify(plan, null, 2)}\n`)), referenceSha256: digest, businessArtifactSha256: digest,
    uiArtifactSha256: digest, bundleArtifactSha256: digest,
    root: { sourceCommit: plan.sourceCommit, creator: signer, contract: { address: rootAddress,
      codeHash: keccak256(code), creationTransaction: transaction, creationInputHash: keccak256(input) } },
    bindings: Object.fromEntries(plan.bindings.map(binding => [binding.name, zeroAddress as Address])),
    manifest: { uri: "ipfs://before/main.json", hash: digest }, authority: { owner: signer, pendingOwner: zeroAddress as Address },
    transactions: [transaction], verificationBlock: { number: "0xa" as Hex, hash: digest }, predecessor: null,
  }
  const attempt = { schema: "cam.publication-attempt.v1", ...observation,
    plan, bundleRootSha256: digest, failedTransactions: [failedTransaction] } satisfies CamPublicationAttempt
  const state = { bindings: { ...attempt.bindings }, manifest: { ...attempt.manifest }, owner: signer, pendingOwner: zeroAddress as Address }
  const client = {
    async getBlock() { return { hash: digest } },
    async getCode() { return code },
    async getTransaction() { return { hash: transaction, from: signer, to: null, input } },
    async getTransactionReceipt() { return { transactionHash: transaction, from: signer, to: null,
      status: "success" as const, contractAddress: rootAddress, blockNumber: 2n, blockHash: digest } },
    async readContract(request: { functionName: string; args?: readonly unknown[]; blockNumber: bigint }) {
      assert.equal(request.blockNumber, 10n)
      if (request.functionName === "owner") return state.owner
      if (request.functionName === "pendingOwner") return state.pendingOwner
      if (request.functionName === "camManifest") return { uri: state.manifest.uri, sha256Digest: state.manifest.hash }
      if (request.functionName === "contractAddress") return state.bindings[request.args![0] as string]
      throw new Error("unexpected getter")
    },
  }
  const select = () => rootFromArtifact(app, encode(attempt))
  const admit = () => admitExistingCamRoot({ selection: select(), client,
    compilation: { abi: parseAbi(["function owner() view returns (address)"]), creationBytecode: "0x6001" },
    observationBlock: { number: 10n, hash: digest } })
  return { plan, observation, attempt, state, select, admit }
}

test("partial observations are typed attempts and never complete publications with zero bindings", () => {
  const { observation, attempt } = fixture("pay-to-play")
  assert.deepEqual(parseCamAttempt(encode(attempt), attempt.app), attempt)
  assert.throws(() => parseCamPublication(encode(attempt), attempt.app), /fields disagree|schema or app/)
  assert.throws(() => parseCamPublication(encode({ schema: "cam.publication.v1", ...observation }), attempt.app), /PayToPlay binding.*zero address/)
  assert.throws(() => parseCamAttempt(encode({ ...attempt, failedTransactions: attempt.transactions }), attempt.app), /distinct/)
  assert.throws(() => parseCamAttempt(encode({ ...attempt, plan: { ...attempt.plan, intendedOwner: other } }), attempt.app), /retained plan.*saved plan SHA/)
  assert.throws(() => parseCamAttempt(encode({ ...attempt, root: { ...attempt.root, sourceCommit: "b".repeat(40) } }), attempt.app), /metadata differs/)
})

test("attempt admission permits independently completed original fields and rejects a third state", async () => {
  for (const bindingMask of [0, 1, 2, 3]) {
    for (const manifestComplete of [false, true]) {
      const { plan, state, admit } = fixture("pay-to-play")
      for (const [index, binding] of plan.bindings.entries()) {
        if (bindingMask & (1 << index)) state.bindings[binding.name] = binding.address as Address
      }
      if (manifestComplete) state.manifest = { ...plan.manifest }
      const admitted = await admit()
      assert.deepEqual(admitted.bindings, state.bindings)
      assert.deepEqual(admitted.manifest, state.manifest)
      assert.equal(admitted.origin.kind, "attempt")
    }
  }
  const { state, admit } = fixture("pay-to-play")
  state.bindings.PayToPlay = other
  await assert.rejects(admit(), /current binding PayToPlay=.*neither.*original desired binding/)
  state.bindings.PayToPlay = zeroAddress
  state.manifest.uri = "ipfs://third/main.json"
  await assert.rejects(admit(), /current manifest is neither/)
})

test("Bike attempt admission resolves the original new-root self alias to the actual created root", async () => {
  const { state, admit } = fixture("bike-nft")
  state.bindings.ICamRootOwnership = rootAddress
  assert.equal((await admit()).bindings.ICamRootOwnership, rootAddress)
  state.bindings.ICamRootOwnership = other
  await assert.rejects(admit(), /current binding ICamRootOwnership=.*neither/)
})

test("attempt authority permits the original nomination and acceptance but rejects unrelated pending-owner drift", async () => {
  const { state, attempt, admit } = fixture("pay-to-play")
  state.pendingOwner = other
  await assert.rejects(admit(), /current pending owner is neither/)
  state.pendingOwner = nominee
  assert.equal((await admit()).pendingOwner, nominee)
  state.owner = nominee
  state.pendingOwner = zeroAddress
  assert.equal((await admit()).owner, nominee)
  state.owner = other
  await assert.rejects(admit(), /current owner is neither/)
  attempt.plan = { ...attempt.plan, intendedOwner: zeroAddress, nomination: "preserve" }
  attempt.planSha256 = sha256(new TextEncoder().encode(`${JSON.stringify(attempt.plan, null, 2)}\n`))
  attempt.authority = { owner: signer, pendingOwner: other }
  state.owner = other
  assert.equal((await admit()).owner, other)
})

test("continuation keeps original component commitments, local root SHA, URI/hash and owner intent", () => {
  const { plan, attempt, select } = fixture("pay-to-play")
  const requested = { businessArtifactSha256: plan.businessArtifactSha256, uiArtifactSha256: plan.uiArtifactSha256,
    rootSha256: attempt.bundleRootSha256, manifest: plan.manifest, intendedOwner: plan.intendedOwner, nomination: plan.nomination }
  assertCamAttemptIntent(select(), requested)
  for (const changed of [
    { businessArtifactSha256: transaction }, { uiArtifactSha256: transaction }, { rootSha256: transaction },
    { manifest: { ...plan.manifest, uri: "ipfs://other/main.json" } },
    { manifest: { ...plan.manifest, hash: digest } }, { intendedOwner: other },
  ]) assert.throws(() => assertCamAttemptIntent(select(), { ...requested, ...changed }), /original desired publication/)
})

test("attempt origin and predecessor survive a continuation plan and final publication", async () => {
  const { plan, observation, state, admit } = fixture("pay-to-play")
  state.bindings.PayToPlay = business
  const root = await admit()
  const continuation: CamReleasePlan = parseCamReleasePlan(encode({ ...plan, root }))
  assert.equal(continuation.root.kind, "existing")
  if (continuation.root.kind !== "existing") throw new Error("expected existing root")
  const publication = parseCamPublication(encode({ ...observation, schema: "cam.publication.v1",
    bindings: { PayToPlay: business, PayToPlayUI: ui }, manifest: plan.manifest,
    predecessor: continuation.root.origin }), plan.app)
  assert.equal(publication.predecessor!.kind, "attempt")
})

test("completed CAM publication requires the requested nomination while preserving explicit no-handoff", () => {
  const before = { owner: signer, pendingOwner: other }
  assert.throws(() => assertCamNominationComplete(rootAddress, before, nominee, before), /neither nominated nor accepted/)
  assert.doesNotThrow(() => assertCamNominationComplete(rootAddress, before, nominee, { owner: signer, pendingOwner: nominee }))
  assert.doesNotThrow(() => assertCamNominationComplete(rootAddress, before, nominee, { owner: nominee, pendingOwner: zeroAddress }))
  assert.throws(() => assertCamNominationComplete(rootAddress, before, nominee, { owner: signer, pendingOwner: ui }), /pending owner/)
  assert.doesNotThrow(() => assertCamNominationComplete(rootAddress, before, signer, before))
  assert.doesNotThrow(() => assertCamNominationComplete(rootAddress, before, zeroAddress, before))
  assert.doesNotThrow(() => assertCamNominationComplete(rootAddress, before, signer, { owner: other, pendingOwner: zeroAddress }))
})

test("a preserved nominee acceptance cannot turn original self-owner intent into a new nomination", async () => {
  const f = fixture("pay-to-play")
  const original = parseCamReleasePlan(encode({ ...f.plan, intendedOwner: signer, nomination: "preserve", root: { kind: "existing",
    contract: f.attempt.root.contract, sourceCommit: f.attempt.root.sourceCommit, creator: signer,
    origin: { kind: "publication", artifactSha256: digest }, owner: signer, pendingOwner: nominee,
    bindings: f.attempt.bindings, manifest: f.attempt.manifest } }))
  f.attempt.plan = original
  f.attempt.planSha256 = sha256(new TextEncoder().encode(`${JSON.stringify(original, null, 2)}\n`))
  f.attempt.authority = { owner: signer, pendingOwner: nominee }
  f.state.owner = nominee
  f.state.pendingOwner = zeroAddress
  const selected = f.select()
  const root = await f.admit()
  const commitments = { businessArtifactSha256: digest, uiArtifactSha256: digest, rootSha256: digest,
    manifest: original.manifest, intendedOwner: signer, nomination: original.nomination }
  assert.doesNotThrow(() => assertCamAttemptIntent(selected, commitments))
  assert.throws(() => assertCamAttemptIntent(selected, { ...commitments, intendedOwner: nominee }), /differ from its original/)
  const continuation = parseCamReleasePlan(encode({ ...original, root,
    intendedOwner: original.intendedOwner, nomination: original.nomination }))
  const identity = (address: Address) => ({ address, codeHash: digest, creationTransaction: digest, creationInputHash: digest })
  const components: AdmittedCamComponents = { app: "pay-to-play", chainId: 31338,
    business: { sourceCommit: original.sourceCommit, creator: signer, artifactSha256: digest, contracts: { payments: identity(business) } },
    ui: { sourceCommit: original.sourceCommit, creator: signer, artifactSha256: digest, contract: identity(ui), backing: "payments" },
    observationBlock: { number: 10n, hash: digest } }
  const reference = camPublicationReference(continuation, nominee, components,
    parseAbi(["function setContractAddress(string,address)", "function setCam(string,bytes32)", "function transferOwnership(address)"]))
  assert.equal(continuation.nomination, "preserve")
  assert.ok(reference.steps.some(step => step.name === "setContractAddress"))
  assert.ok(reference.steps.every(step => step.name !== "transferOwnership"))
  assert.equal(selected.kind === "attempt" && selected.attempt.plan.intendedOwner, signer)
  const secondAttempt = { ...f.attempt, plan: continuation, authority: { owner: nominee, pendingOwner: zeroAddress },
    planSha256: sha256(new TextEncoder().encode(`${JSON.stringify(continuation, null, 2)}\n`)) }
  const secondSelection = rootFromArtifact("pay-to-play", encode(secondAttempt))
  assert.doesNotThrow(() => assertCamAttemptIntent(secondSelection, commitments))
  assert.throws(() => assertCamAttemptIntent(secondSelection, { ...commitments, nomination: "nominate" }), /differ from its original/)
  const repeated = camPublicationReference(continuation, nominee, components,
    parseAbi(["function setContractAddress(string,address)", "function setCam(string,bytes32)", "function transferOwnership(address)"]))
  assert.ok(repeated.steps.every(step => step.name !== "transferOwnership"))
})
