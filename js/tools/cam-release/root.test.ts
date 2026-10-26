import assert from "node:assert/strict"
import test from "node:test"
import { keccak256, parseAbi, zeroAddress, type Address, type Hex } from "viem"
import { admitExistingCamRoot } from "./root.ts"
import type { CamRootSelection } from "./publication.ts"

const root = `0x${"11".repeat(20)}` as Address
const creator = `0x${"22".repeat(20)}` as Address
const currentOwner = `0x${"33".repeat(20)}` as Address
const target = `0x${"44".repeat(20)}` as Address
const blockHash = `0x${"55".repeat(32)}` as Hex
const creationHash = `0x${"66".repeat(32)}` as Hex
const code = "0x6000" as Hex
const input = "0x60011234" as Hex
const baseline: CamRootSelection & { kind: "publication" } = {
  kind: "publication", app: "pay-to-play", chainId: 31338,
  creator, sourceCommit: "a".repeat(40), artifactSha256: blockHash,
  contract: { address: root, creationTransaction: creationHash, creationInputHash: keccak256(input), codeHash: keccak256(code) },
  bindings: { PayToPlay: target, PayToPlayUI: target }, manifest: { uri: "ipfs://previous/main.json", hash: blockHash },
}
function fixture() {
  const state = { hash: blockHash, binding: target, uri: baseline.manifest.uri, readBlocks: [] as bigint[] }
  const client = {
    async getBlock() { return { hash: state.hash } },
    async getCode() { return code },
    async getTransaction() { return { hash: creationHash, from: creator, to: null, input } },
    async getTransactionReceipt() { return { transactionHash: creationHash, from: creator, to: null,
      status: "success" as const, contractAddress: root, blockNumber: 2n, blockHash } },
    async readContract(request: { functionName: string; blockNumber: bigint }) {
      state.readBlocks.push(request.blockNumber)
      if (request.functionName === "owner") return currentOwner
      if (request.functionName === "pendingOwner") return zeroAddress
      if (request.functionName === "camManifest") return { uri: state.uri, sha256Digest: blockHash }
      if (request.functionName === "contractAddress") return state.binding
      throw new Error("unexpected getter")
    },
  }
  const options = { selection: baseline, compilation: { abi: parseAbi(["function owner() view returns (address)"]), creationBytecode: "0x6001" as Hex },
    observationBlock: { number: 10n, hash: blockHash }, client }
  return { state, client, options }
}

test("existing root admission observes current owner separately from original creator at the component snapshot", async () => {
  const { state, options } = fixture()
  const admitted = await admitExistingCamRoot(options)
  assert.equal(admitted.owner, currentOwner)
  assert.equal(admitted.creator, creator)
  assert.deepEqual(state.readBlocks, [10n, 10n, 10n, 10n, 10n])
})

test("existing root admission rejects a stale publication baseline before call approval", async () => {
  const { state, options } = fixture()
  state.binding = creator
  await assert.rejects(admitExistingCamRoot(options), /current binding PayToPlay=.*differs from latest publication/)
  state.binding = target
  state.uri = "ipfs://unrelated/main.json"
  await assert.rejects(admitExistingCamRoot(options), /current manifest .*differs from latest publication/)
})

test("existing root admission requires its actual original program and a stable observation block", async () => {
  const { state, client, options } = fixture()
  await assert.rejects(admitExistingCamRoot({ ...options,
    compilation: { ...options.compilation, creationBytecode: "0xdead" } }), /original creation does not match/)
  const read = client.readContract.bind(client)
  client.readContract = async request => {
    const result = await read(request)
    state.hash = creationHash
    return result
  }
  await assert.rejects(admitExistingCamRoot(options), /observation block changed during/)
})
