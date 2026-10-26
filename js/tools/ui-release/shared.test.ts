import assert from "node:assert/strict"
import test from "node:test"
import { keccak256, type Address, type Hex } from "viem"
import { backingFromDeployment, uiDeploymentReference, verifyUIBacking, type UIReleasePlan } from "./shared.ts"

const coreCreator = `0x${"11".repeat(20)}` as Address
const uiCreator = `0x${"22".repeat(20)}` as Address
const backing = `0x${"33".repeat(20)}` as Address
const transactionHash = `0x${"44".repeat(32)}` as Hex
const blockHash = `0x${"55".repeat(32)}` as Hex
const code = "0x60016000" as const

function plan(app: UIReleasePlan["app"]): UIReleasePlan {
  return {
    schema: "cam.ui-release-plan.v1", app, sourceCommit: "a".repeat(40), expectedChainId: 43113,
    backing: { sourceCommit: "b".repeat(40), chainId: 43113, creator: coreCreator,
      artifactSha256: `0x${"66".repeat(32)}`, address: backing, codeHash: keccak256(code), creationTransaction: transactionHash },
  }
}

test("native business artifacts supply UI backing without any root or previous UI", () => {
  for (const app of ["bike-nft", "escrow", "pay-to-play"] as const) {
    const identity = { address: backing, codeHash: keccak256(code), creationTransaction: transactionHash,
      creationInputHash: keccak256("0x6000") }
    const contracts = app === "bike-nft" ? { manager: identity, components: { ...identity,
      address: `0x${"77".repeat(20)}`, creationTransaction: `0x${"88".repeat(32)}` } }
      : app === "escrow" ? { escrow: identity } : { payments: identity }
    const artifact = { schema: "cam.contract-deployment.v1", app, sourceCommit: "b".repeat(40),
      chainId: 43113, creator: coreCreator, planSha256: `0x${"99".repeat(32)}`, contracts, initializationTransactions: [],
      verificationBlock: { number: "0x10", hash: blockHash },
      administration: app === "escrow" ? {} : app === "pay-to-play" ? { payments: { owner: coreCreator, pendingOwner: `0x${"00".repeat(20)}` } }
        : { components: { admin: coreCreator, pendingAdmin: `0x${"00".repeat(20)}`, pendingSchedule: 0 },
            manager: { admin: coreCreator, pendingAdmin: `0x${"00".repeat(20)}`, pendingSchedule: 0 } },
    }
    const bytes = new TextEncoder().encode(JSON.stringify(artifact))
    const selected = backingFromDeployment(app, bytes)
    assert.equal(selected.address, backing)
    assert.equal(selected.creator, coreCreator)
    assert.equal(selected.creationInputHash, identity.creationInputHash)
    assert.equal(selected.sourceCommit, artifact.sourceCommit)
    assert.throws(() => backingFromDeployment(app, new TextEncoder().encode(JSON.stringify({ ...artifact,
      contracts: { ui: identity },
    }))), /contract.*(inventory|fields)|fields.*disagree/i)
  }
})

test("UI deployment is root-free and its creator and source are independent of the backing deployment", () => {
  for (const app of ["bike-nft", "escrow", "pay-to-play"] as const) {
    const selected = plan(app)
    const reference = uiDeploymentReference(selected, uiCreator)
    assert.equal(reference.expectedDeployer, uiCreator)
    assert.equal(reference.sourceCommit, selected.sourceCommit)
    assert.equal(reference.backing.sourceCommit, selected.backing.sourceCommit)
    assert.deepEqual(reference.steps.map(step => [step.kind, step.role]), [["create", "ui"]])
    assert.deepEqual(reference.steps[0]!.args, [backing])
  }
})

test("backing admission checks creation and current code without consulting wallets, roles, pause or CAM state", async () => {
  for (const app of ["bike-nft", "escrow", "pay-to-play"] as const) {
    const calls: string[] = []
    const client = {
      async getChainId() { calls.push("chain"); return 43113 },
      async getBlockNumber() { calls.push("block"); return 20n },
      async getBlock() { calls.push("blockHash"); return { hash: blockHash } },
      async getCode(request: { address: Address; blockNumber: bigint }) {
        calls.push("code"); assert.equal(request.address, backing); assert.equal(request.blockNumber, 20n); return code
      },
      async getTransactionReceipt() {
        calls.push("receipt"); return { status: "success" as const, transactionHash, contractAddress: backing,
          from: coreCreator, to: null, blockNumber: 10n, blockHash }
      },
      async getTransaction() {
        calls.push("transaction"); return { hash: transactionHash, from: coreCreator, to: null, input: "0x6000" as const }
      },
    }
    const selected = plan(app)
    const observed = await verifyUIBacking(client, selected.backing)
    assert.equal(observed.creationInputHash, keccak256("0x6000"))
    assert.equal(observed.blockNumber, "20")
    assert.equal(observed.blockHash, blockHash)
    assert.ok(calls.includes("receipt") && calls.includes("code"))
    await assert.rejects(verifyUIBacking({ ...client, getCode: async () => "0x6002" as const }, selected.backing), /runtime/i)
    await assert.rejects(verifyUIBacking({ ...client, getTransactionReceipt: async () => ({
      ...await client.getTransactionReceipt(), contractAddress: uiCreator,
    }) }, selected.backing), /creation.*address|address.*creation/i)
    await assert.rejects(verifyUIBacking({ ...client, getChainId: async () => 1 }, selected.backing), /chain/i)
  }
})


test("backing verification rejects a reorg between runtime and observation reads", async () => {
  const replacementHash = `0x${"77".repeat(32)}` as Hex
  let reorganized = false
  const client = {
    async getChainId() { return 43113 },
    async getBlockNumber() { return 20n },
    async getBlock({ blockNumber }: { blockNumber: bigint }) {
      const hash = reorganized ? replacementHash : blockHash
      if (blockNumber === 10n) reorganized = true
      return { hash }
    },
    async getCode() { return code },
    async getTransactionReceipt() {
      return { status: "success" as const, transactionHash, contractAddress: backing,
        from: coreCreator, to: null, blockNumber: 10n, blockHash }
    },
    async getTransaction() {
      return { hash: transactionHash, from: coreCreator, to: null, input: "0x6000" as const }
    },
  }
  await assert.rejects(verifyUIBacking(client, plan("escrow").backing), /observation block.*changed/i)
})
