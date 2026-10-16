import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { parseCam } from "@cam/core"
import { parseJsonBytes, toInertValue, type InertRecord } from "@cam/protocol"
import { resolvedUiButtons } from "@cam/screen"
import type { CamPublicClient } from "@cam/evm-viem"
import type { Abi, Address, Hex } from "viem"
import { createCamViewerSession } from "../src/index.ts"
import { prepareViewerContractCall } from "../src/write-preparation.ts"

const customer: Address = "0x0000000000000000000000000000000000000011"
const other: Address = "0x0000000000000000000000000000000000000022"
const contract: Address = "0x0000000000000000000000000000000000000033"
const host = { chainId: "eip155:31337", address: "0x0000000000000000000000000000000000000044" as Address }
const directory = new URL("../../../../dapps/pay-to-play/cam/", import.meta.url)
const uri = "https://example.test/pay-to-play/main.json"

async function fixture() {
  const root = new Uint8Array(await readFile(new URL("main.json", directory)))
  const cam = parseCam(parseJsonBytes(root))
  const abi = parseJsonBytes(new Uint8Array(await readFile(new URL("abi/PayToPlay.json", directory)))) as Abi
  const publicClient: CamPublicClient = {
    getChainId: async () => 31337,
    readContract: async request => {
      if (request.functionName === "supportsInterface") return true
      if (request.functionName === "camManifest") return { uri, sha256Digest: `0x${createHash("sha256").update(root).digest("hex")}` as Hex }
      if (request.functionName === "contractAddress") return contract
      if (request.functionName === "viewPosition") {
        const [viewedCustomer, channelId, actor] = request.args!
        return { customer: viewedCustomer, channelId: BigInt(String(channelId)), payee: other, claimPeriod: 60n, channelCount: 3n, admin: other, balance: 100n, voucherPaid: 0n, requestedAmount: 0n, readyAt: 0n, effectiveBalance: 100n, actions: actor === viewedCustomer ? ["fund", "requestWithdrawal", "setWithdrawal", "collect"] : ["collect"] }
      }
      throw new Error(`Unexpected fixture read: ${request.functionName}`)
    },
  }
  const session = createCamViewerSession({ publicClient, host, account: { address: customer }, inputs: {}, loadResource: async resource => {
    const relative = new URL(resource).pathname.replace("/pay-to-play/", "")
    return new Uint8Array(await readFile(new URL(relative, directory)))
  } })
  return { cam, abi, session }
}

test("sender-owned payment writes always continue to the acting wallet's position", async () => {
  const { cam, abi } = await fixture()
  for (const route of ["fund", "requestWithdrawal", "setWithdrawal", "move"]) {
    assert(!cam.routes[route]!.inputs.includes("customer"), `${route} must not request a fictional customer`)
    const inputs: InertRecord = route === "move" ? { channelId: "1", targetId: "0" } : { channelId: "1", amount: "20" }
    const options = { cam, contracts: { "contracts.PayToPlay": { address: contract, abi } }, host, account: { address: customer }, route }
    assert.throws(() => prepareViewerContractCall({ ...options, inputs: { ...inputs, customer: other } }))
    const call = prepareViewerContractCall({ ...options, inputs })
    assert.deepEqual(call.then, toInertValue({ namespace: "routes", function: "myPosition", args: { channelId: "1" } }))
  }
})

test("wallet positions follow account changes while inspected customer positions stay fixed", async () => {
  const { session } = await fixture()
  await session.load()
  await session.navigate("myPosition", { channelId: "1" })
  const followed = await session.setAccount({ address: other })
  assert.equal((followed.values[0] as Record<string, unknown>).customer, other)
  assert.equal(followed.state.lookupCustomer, other)
  await session.navigate("position", { customer, channelId: "1" })
  const pinned = await session.setAccount({ address: customer })
  assert.equal((pinned.values[0] as Record<string, unknown>).customer, customer)
  const changed = await session.setAccount({ address: other })
  assert.equal((changed.values[0] as Record<string, unknown>).customer, customer)
  assert.equal(changed.state.lookupCustomer, customer)
  const own = resolvedUiButtons(changed.resolvedUi).find(button => button.call.function === "myPosition")
  assert(own, "An inspected position needs an explicit path to the selected wallet's position")
})
