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
  const chainState = { channelCount: 3n, payee: other, mature: false }
  const publicClient: CamPublicClient = {
    getChainId: async () => 31337,
    readContract: async request => {
      if (request.functionName === "supportsInterface") return true
      if (request.functionName === "camManifest") return { uri, sha256Digest: `0x${createHash("sha256").update(root).digest("hex")}` as Hex }
      if (request.functionName === "contractAddress") return contract
      if (request.functionName === "channelCount") return chainState.channelCount
      if (request.functionName === "voucherDigest") return `0x${"12".repeat(32)}`
      if (request.functionName === "viewPosition") {
        const [viewedCustomer, channelId, actor] = request.args!
        return { customer: viewedCustomer, channelId: BigInt(String(channelId)), payee: chainState.payee, claimPeriod: 60n, channelCount: chainState.channelCount, admin: other, balance: 100n, voucherPaid: 0n, requestedAmount: 0n, readyAt: 0n, effectiveBalance: 100n, actions: actor === viewedCustomer ? ["fund", "requestWithdrawal", "setWithdrawal", "collect", ...(chainState.mature ? ["withdraw", "move"] : [])] : ["collect"] }
      }
      throw new Error(`Unexpected fixture read: ${request.functionName}`)
    },
  }
  const session = createCamViewerSession({ publicClient, host, account: { address: customer }, inputs: {}, loadResource: async resource => {
    const relative = new URL(resource).pathname.replace("/pay-to-play/", "")
    return new Uint8Array(await readFile(new URL(relative, directory)))
  } })
  return { cam, abi, session, chainState }
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


test("channel creation continues to a current lookup without predicting a created ID", async () => {
  const { cam, abi, session, chainState } = await fixture()
  const prepared = prepareViewerContractCall({ cam, contracts: { "contracts.PayToPlay": { address: contract, abi } }, host, account: { address: customer }, route: "createChannel", inputs: { payee: other, claimPeriod: "60" } })
  assert.deepEqual(prepared.then, toInertValue({ namespace: "routes", function: "channelLookup", args: {} }))
  await session.load()
  chainState.channelCount = 5n
  const lookup = await session.navigate(prepared.then.function, prepared.then.args)
  assert.equal(lookup.values[0], "5")
  assert.equal(lookup.state.lookupCustomer, customer)
  assert.equal(lookup.state.lookupChannelId, null)
  const blank = resolvedUiButtons(lookup.resolvedUi).find(button => button.call.function === "position")!
  await assert.rejects(() => session.dispatchAction(blank))
  assert.equal(session.snapshot().route, "channelLookup")
  session.editInteger("lookupChannelId", "2")
  const open = resolvedUiButtons(session.snapshot().resolvedUi!).find(button => button.call.function === "position")!
  const result = await session.dispatchAction(open)
  assert.equal(result.type, "navigated")
  assert.equal(session.snapshot().inputs.channelId, "2")
})

test("voucher details use Back to restore drafts and label direct position navigation as fresh", async () => {
  const { session } = await fixture()
  await session.load()
  await session.navigate("position", { customer, channelId: "1" })
  session.editAmount("cumulativeTotal", "base", "20")
  const draft = session.updateState({ signature: "unfinished signature" })
  const digest = resolvedUiButtons(draft.resolvedUi).find(button => button.call.function === "voucherDigest")!
  await session.dispatchAction(digest)
  const details = session.snapshot()
  assert.equal(details.route, "voucherDigest")
  const fresh = resolvedUiButtons(details.resolvedUi!).find(button => button.call.function === "position")!
  assert.equal(fresh.props.label, "Open position with fresh inputs")
  const restored = await session.back()
  assert.equal(restored.state.cumulativeTotal, "20")
  assert.equal(restored.state.signature, "unfinished signature")
  await session.navigate("voucherDigest", { customer, channelId: "1", cumulativeTotal: "20" })
  const direct = resolvedUiButtons(session.snapshot().resolvedUi!).find(button => button.call.function === "position")!
  await session.dispatchAction(direct)
  assert.equal(session.snapshot().state?.cumulativeTotal, null)
  assert.equal(session.snapshot().state?.signature, "")
})

test("position refresh updates external recipient and maturity actions while retaining amount drafts", async () => {
  const { session, chainState } = await fixture()
  await session.load()
  await session.navigate("position", { customer, channelId: "1" })
  session.editAmount("fundAmount", "base", "23")
  assert(resolvedUiButtons(session.snapshot().resolvedUi!).find(button => button.call.function === "withdraw")?.disabled)
  chainState.mature = true
  chainState.payee = customer
  const refreshed = await session.refresh()
  assert.equal((refreshed.values[0] as Record<string, unknown>).payee, customer)
  assert.equal(refreshed.state.fundAmount, "23")
  assert.equal(resolvedUiButtons(refreshed.resolvedUi).find(button => button.call.function === "withdraw")?.disabled, false)
})
