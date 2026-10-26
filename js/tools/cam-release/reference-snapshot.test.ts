import assert from "node:assert/strict"
import test from "node:test"
import { encodeFunctionData, parseAbi, zeroAddress, type Address, type Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { parseReferenceSnapshot } from "../release-approval/reference-read.ts"
import { ReleaseVerifier } from "../release-approval/verifier.ts"
import { prepareCamReferenceSnapshot } from "./reference-snapshot.ts"
import type { AdmittedCamComponents } from "./components.ts"

const signer = privateKeyToAccount(`0x${"11".repeat(32)}`)
const creator = `0x${"22".repeat(20)}` as Address
const root = `0x${"33".repeat(20)}` as Address
const core = `0x${"44".repeat(20)}` as Address
const ui = `0x${"55".repeat(20)}` as Address
const digest = `0x${"66".repeat(32)}` as Hex
const identity = (address: Address) => ({ address, codeHash: digest, creationTransaction: digest, creationInputHash: digest })
const abi = parseAbi(["function setContractAddress(string,address)", "function setCam(string,bytes32)"])
const components: AdmittedCamComponents = { app: "escrow", chainId: 31338,
  business: { sourceCommit: "b".repeat(40), creator, artifactSha256: digest, contracts: { escrow: identity(core) } },
  ui: { sourceCommit: "c".repeat(40), creator, artifactSha256: digest, contract: identity(ui), backing: "escrow" },
  observationBlock: { number: 10n, hash: digest } }

function prepare(complete = false, selectedRoot = root) {
  const manifest = { uri: "ipfs://desired/main.json", hash: digest }
  const planBytes = new TextEncoder().encode(JSON.stringify({
    schema: "cam.publication-plan.v1", app: "escrow", sourceCommit: "d".repeat(40), expectedChainId: 31338,
    businessArtifactSha256: digest, uiArtifactSha256: digest, bundleArtifactSha256: digest,
    observationBlock: { number: "0xa", hash: digest }, bindings: [{ name: "CamEscrowUI", address: ui }, { name: "CamEscrow", address: core }],
    manifest, intendedOwner: zeroAddress, root: { kind: "existing", contract: identity(selectedRoot), creator,
      sourceCommit: "a".repeat(40), origin: { kind: "publication", artifactSha256: digest }, owner: signer.address, pendingOwner: zeroAddress,
      bindings: { CamEscrowUI: complete ? ui : creator, CamEscrow: core }, manifest },
  }))
  return prepareCamReferenceSnapshot({ planBytes, components, signer: signer.address,
    admittedRoot: { kind: "existing", contract: identity(root), creator, sourceCommit: "a".repeat(40),
      origin: { kind: "publication", artifactSha256: digest }, owner: signer.address, pendingOwner: zeroAddress,
      bindings: { CamEscrowUI: complete ? ui : creator, CamEscrow: core }, manifest },
    originalRootCompilation: { name: "CamRoot", source: "cam/src/CamRoot.sol", compilerVersion: "0.8.34+fixture",
      compilerSettings: { optimizer: { enabled: true, runs: 999 }, evmVersion: "cancun" },
      compilerMetadataSha256: digest, artifactSha256: digest, creationBytecode: "0x6001", abi },
    artifactsRoot: "/unused-current-artifacts", sourcesRoot: "/unused-current-source" })
}

test("existing CAM approval uses original root ABI and explicit target without inventing a creation", async () => {
  const snapshot = await prepare()
  const parsed = parseReferenceSnapshot(new TextEncoder().encode(JSON.stringify(snapshot)))
  assert.deepEqual(parsed, snapshot)
  assert.equal(parsed.contracts[0]!.compilerVersion, "0.8.34+fixture")
  assert.deepEqual(parsed.steps.map(step => step.kind), ["call"])
  assert.equal(parsed.expectedDeployer, signer.address)
  assert(parsed.schema === "release-approval.cam-reference.v1" && parsed.root.kind === "existing")
  assert.equal(parsed.root.creator, creator)
  const data = encodeFunctionData({ abi, functionName: "setContractAddress", args: ["CamEscrowUI", ui] })
  const sign = (to: Address) => signer.signTransaction({ type: "eip1559", chainId: 31338, nonce: 9,
    gas: 200_000n, maxFeePerGas: 2n, maxPriorityFeePerGas: 1n, to, data })
  const verifier = new ReleaseVerifier(parsed, async () => { throw new Error("existing root is not a new CREATE") })
  await assert.rejects(verifier.inspect(await sign(creator)), /target differs from observed camRoot/)
  const review = await verifier.inspect(await sign(root))
  assert.equal(review.comparison.targetAddress, root)
  verifier.accepted(review.signed.hash)
  assert.equal(verifier.stepIndex(), 1)
})

test("already-desired existing CAM snapshot retains no-send intent without weakening signer verifier", async () => {
  const parsed = parseReferenceSnapshot(new TextEncoder().encode(JSON.stringify(await prepare(true))))
  assert.deepEqual(parsed.steps, [])
  assert.throws(() => new ReleaseVerifier(parsed, async () => null), /no steps or contracts/)
})

test("CAM snapshot cannot relabel the admitted root while retaining its origin hashes", async () => {
  await assert.rejects(prepare(false, creator), /root .*differs from.*admitted root/)
})
