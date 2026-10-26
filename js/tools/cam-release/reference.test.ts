import assert from "node:assert/strict"
import test from "node:test"
import { parseAbi, zeroAddress, type Abi, type Address, type Hex } from "viem"
import type { AdmittedCamComponents } from "./components.ts"
import { parseCamReleasePlan } from "./shared.ts"
import { camPublicationReference as buildReference } from "./reference.ts"

const owner = `0x${"11".repeat(20)}` as Address
const creator = `0x${"22".repeat(20)}` as Address
const core = `0x${"33".repeat(20)}` as Address
const ui = `0x${"44".repeat(20)}` as Address
const rootAddress = `0x${"55".repeat(20)}` as Address
const originalRootABI = parseAbi([
  "function setContractAddress(string,address)", "function setCam(string,bytes32)", "function transferOwnership(address)",
])
const digest = `0x${"66".repeat(32)}` as Hex
function admitted(app: AdmittedCamComponents["app"]): AdmittedCamComponents {
  const identity = (address: Address) => ({ address, codeHash: digest, creationTransaction: digest, creationInputHash: digest })
  const contracts = app === "pay-to-play" ? { payments: identity(core) }
    : app === "escrow" ? { escrow: identity(core) } : { manager: identity(core), components: identity(creator) }
  return { app, chainId: 31338, business: { sourceCommit: "b".repeat(40), creator, artifactSha256: digest, contracts },
    ui: { sourceCommit: "c".repeat(40), creator, artifactSha256: digest, contract: identity(ui),
      backing: app === "pay-to-play" ? "payments" : app === "escrow" ? "escrow" : "manager" },
    observationBlock: { number: 10n, hash: digest } }
}
function camPublicationReference(selected: ReturnType<typeof plan>, signer: string, abi?: Abi) {
  return buildReference(selected, signer, admitted(selected.app), abi)
}

function plan(root: unknown = { kind: "new" }, overrides: Record<string, unknown> = {}) {
  return parseCamReleasePlan(new TextEncoder().encode(JSON.stringify({
    schema: "cam.publication-plan.v1", app: "pay-to-play", sourceCommit: "a".repeat(40), expectedChainId: 31338,
    businessArtifactSha256: digest, uiArtifactSha256: digest, bundleArtifactSha256: digest, observationBlock: { number: "0xa", hash: digest },
    bindings: [{ name: "PayToPlay", address: core }, { name: "PayToPlayUI", address: ui }],
    manifest: { uri: "ipfs://bafyexample/main.json", hash: digest }, intendedOwner: zeroAddress, root, ...overrides,
  })))
}
function existing(overrides: Record<string, unknown> = {}) {
  return { kind: "existing", creator, sourceCommit: "b".repeat(40), origin: { kind: "publication", artifactSha256: digest },
    contract: { address: rootAddress, codeHash: digest, creationTransaction: digest, creationInputHash: digest },
    owner, pendingOwner: zeroAddress, bindings: { PayToPlay: core, PayToPlayUI: creator },
    manifest: { uri: "ipfs://previous/main.json", hash: digest }, ...overrides }
}

test("new CAM publication creates only the root and binds the independently selected components", () => {
  const reference = camPublicationReference(plan(), owner)
  assert.deepEqual(reference.steps.map(step => [step.kind, step.role, step.name]), [
    ["create", "camRoot", "CamRoot"], ["call", "camRoot", "setContractAddress"], ["call", "camRoot", "setContractAddress"],
  ])
  assert.deepEqual(reference.steps[1]!.args, ["PayToPlay", core])
  assert.deepEqual(reference.steps[2]!.args, ["PayToPlayUI", ui])
})

test("existing CAM publication uses current owner rather than creator and skips already desired fields", () => {
  const selected = plan(existing())
  const reference = camPublicationReference(selected, owner, originalRootABI)
  assert.deepEqual(reference.steps.map(step => step.name), ["setContractAddress", "setCam"])
  assert.deepEqual(reference.steps[0]!.args, ["PayToPlayUI", ui])
  assert.throws(() => camPublicationReference(selected, creator, originalRootABI), /differs from current root owner/)
  const complete = plan(existing({ bindings: { PayToPlay: core, PayToPlayUI: ui }, manifest: selected.manifest }), { intendedOwner: owner })
  assert.deepEqual(camPublicationReference(complete, owner, originalRootABI).steps, [])
})

test("CAM ownership intent preserves an unrelated pending owner when no handoff is requested", () => {
  const pending = creator
  assert(!camPublicationReference(plan(existing({ pendingOwner: pending })), owner, originalRootABI).steps.some(step => step.name === "transferOwnership"))
  assert(!camPublicationReference(plan(existing({ pendingOwner: pending }), { intendedOwner: pending }), owner, originalRootABI).steps.some(step => step.name === "transferOwnership"))
  assert.deepEqual(camPublicationReference(plan(existing(), { intendedOwner: creator }), owner, originalRootABI).steps.at(-1)!.args, [creator])
})

test("Bike's root ownership alias names its real new creation or admitted existing root", () => {
  const bindings = [
    { name: "ICamRootOwnership", address: { createdContract: "camRoot" } },
    { name: "BicycleComponentManager", address: core }, { name: "BicycleComponentManagerUI", address: ui },
    { name: "BicycleComponents", address: creator },
  ]
  const selected = plan({ kind: "new" }, { app: "bike-nft", bindings })
  assert.deepEqual(camPublicationReference(selected, owner, originalRootABI).steps[1]!.args, ["ICamRootOwnership", { createdContract: "camRoot" }])
  const oldRoot = existing({ bindings: Object.fromEntries(bindings.map(binding => [binding.name, zeroAddress])) })
  const concrete = bindings.map(binding => binding.name === "ICamRootOwnership" ? { ...binding, address: rootAddress } : binding)
  assert.deepEqual(camPublicationReference(plan(oldRoot, { app: "bike-nft", bindings: concrete }), owner, originalRootABI).steps[0]!.args, ["ICamRootOwnership", rootAddress])
  assert.throws(() => camPublicationReference(plan(oldRoot, { app: "bike-nft", bindings: concrete.map(binding => binding.name === "ICamRootOwnership" ? { ...binding, address: creator } : binding) }), owner, originalRootABI), /binding ICamRootOwnership.*admitted component/)
})

test("existing-root calls must be supported by the admitted original root ABI before approval", () => {
  assert.throws(() => camPublicationReference(plan(existing()), owner), /original root ABI is required/)
  assert.throws(() => camPublicationReference(plan(existing()), owner,
    originalRootABI.filter(item => !(item.type === "function" && item.name === "setCam"))), /camRoot ABI does not declare setCam/)
})

test("publication intent cannot replace the UI while retaining the admitted UI artifact hash", () => {
  const changed = plan({ kind: "new" }, { bindings: [
    { name: "PayToPlay", address: core }, { name: "PayToPlayUI", address: creator },
  ] })
  assert.throws(() => camPublicationReference(changed, owner), /binding PayToPlayUI.*admitted component/)
})
