import assert from "node:assert/strict"
import test from "node:test"
import { encodeDeployData, keccak256, type Address, type Hex } from "viem"
import { sha256 } from "../release-approval/reference-read.ts"
import { admitCamComponents } from "./components.ts"

const coreCreator = `0x${"11".repeat(20)}` as Address
const uiCreator = `0x${"22".repeat(20)}` as Address
const coreA = `0x${"33".repeat(20)}` as Address
const coreB = `0x${"44".repeat(20)}` as Address
const uiA = `0x${"55".repeat(20)}` as Address
const coreATx = `0x${"66".repeat(32)}` as Hex
const coreBTx = `0x${"77".repeat(32)}` as Hex
const uiTx = `0x${"88".repeat(32)}` as Hex
const coreProgram = "0x60006000" as const
const uiProgram = "0x60016000" as const
const coreCode = "0x6000" as const
const uiCode = "0x6001" as const
const uiABI = [{ type: "constructor", stateMutability: "nonpayable", inputs: [{ name: "escrow", type: "address" }] }] as const
const uiInput = encodeDeployData({ abi: uiABI, bytecode: uiProgram, args: [coreA] })
const blockHash = (number: bigint) => `0x${number.toString(16).padStart(64, "0")}` as Hex
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

function business(address: Address, transaction: Hex) {
  return { schema: "cam.contract-deployment.v1", app: "escrow", sourceCommit: "a".repeat(40), chainId: 31338,
    creator: coreCreator, planSha256: `0x${"99".repeat(32)}`, administration: {}, initializationTransactions: [],
    verificationBlock: { number: "0x5", hash: blockHash(5n) }, contracts: { escrow: { address,
      codeHash: keccak256(coreCode), creationTransaction: transaction, creationInputHash: keccak256(coreProgram) } } }
}
function ui(backing: ReturnType<typeof business>) {
  return { schema: "cam.ui-deployment.v1", app: "escrow", sourceCommit: "b".repeat(40), chainId: 31338,
    creator: uiCreator, planSha256: `0x${"aa".repeat(32)}`, referenceSha256: `0x${"bb".repeat(32)}`,
    backing: { sourceCommit: backing.sourceCommit, chainId: backing.chainId, creator: backing.creator,
      artifactSha256: sha256(bytes(backing)), ...backing.contracts.escrow },
    ui: { address: uiA, creationTransaction: uiTx, creationInputHash: keccak256(uiInput), codeHash: keccak256(uiCode) },
    verificationBlock: { number: "0x6", hash: blockHash(6n) } }
}
const mined = new Map([
  [coreATx, { address: coreA, creator: coreCreator, input: coreProgram as Hex, blockNumber: 2n }],
  [coreBTx, { address: coreB, creator: coreCreator, input: coreProgram as Hex, blockNumber: 3n }],
  [uiTx, { address: uiA, creator: uiCreator, input: uiInput, blockNumber: 4n }],
])
const client = {
  async getChainId() { return 31338 },
  async getBlockNumber() { return 10n },
  async getBlock({ blockNumber }: { blockNumber: bigint }) { return { hash: blockHash(blockNumber) } },
  async getCode({ address, blockNumber }: { address: Address; blockNumber: bigint }) {
    assert.equal(blockNumber, 10n)
    return address === uiA ? uiCode : coreCode
  },
  async getTransactionReceipt({ hash }: { hash: Hex }) {
    const tx = mined.get(hash)!
    return { status: "success" as const, transactionHash: hash, contractAddress: tx.address, from: tx.creator, to: null,
      blockNumber: tx.blockNumber, blockHash: blockHash(tx.blockNumber) }
  },
  async getTransaction({ hash }: { hash: Hex }) {
    const tx = mined.get(hash)!
    return { hash, from: tx.creator, to: null, input: tx.input }
  },
}
const compilations = { businessCompilations: { escrow: { abi: [], creationBytecode: coreProgram } },
  uiCompilation: { abi: uiABI, creationBytecode: uiProgram } } as const

test("CAM admits independent original sources but rejects relabelled UI backing and contradictory input evidence", async () => {
  const selectedA = business(coreA, coreATx)
  const artifactA = ui(selectedA)
  const admitted = await admitCamComponents({ app: "escrow", businessBytes: bytes(selectedA), uiBytes: bytes(artifactA), client, ...compilations })
  assert.equal(admitted.business.sourceCommit, "a".repeat(40))
  assert.equal(admitted.ui.sourceCommit, "b".repeat(40))
  assert.equal(admitted.ui.contract.address, uiA)
  const selectedB = business(coreB, coreBTx)
  const relabelled = { ...artifactA, backing: ui(selectedB).backing }
  await assert.rejects(admitCamComponents({ app: "escrow", businessBytes: bytes(selectedB), uiBytes: bytes(relabelled), client, ...compilations }),
    /UI.*creation input hash.*source-and-backing hash/)
  await assert.rejects(admitCamComponents({ app: "escrow", businessBytes: bytes(selectedA),
    uiBytes: bytes({ ...artifactA, backing: { ...artifactA.backing, creationInputHash: `0x${"cc".repeat(32)}` } }), client, ...compilations }),
    /UI backing input hash.*differs from original creation/)
})
