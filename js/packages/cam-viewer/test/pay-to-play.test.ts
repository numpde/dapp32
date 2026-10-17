import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import { parseCam } from "@cam/core"
import { parseJsonBytes, toInertValue, type InertRecord } from "@cam/protocol"
import { resolvedUiButtons, type ResolvedUiNode } from "@cam/screen"
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
        return { customer: viewedCustomer, channelId: BigInt(String(channelId)), payee: chainState.payee, claimPeriod: 60n, channelCount: chainState.channelCount, admin: other, balance: 100n, voucherPaid: 0n, requestedAmount: 0n, readyAt: 0n, effectiveBalance: 100n, actions: [...(actor === other ? ["createChannel", "setPayee"] : []), ...(actor === viewedCustomer ? ["fund", "requestWithdrawal", "setWithdrawal", "collect", ...(chainState.mature ? ["withdraw", "move"] : [])] : ["collect"])] }
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
    assert.deepEqual(call.then, toInertValue({ namespace: "routes", function: "position", args: { customer, channelId: "1" } }))
  }
})

test("opened balance identity precedes explanatory text and controls", async () => {
  const { session } = await fixture()
  await session.load()
  const opened = await session.navigate("position", { customer, channelId: "1" })
  const content: ResolvedUiNode[] = []
  function visit(node: ResolvedUiNode): void {
    if (node.element === "Screen" || node.element === "Fragment") node.children.forEach(visit)
    else content.push(node)
  }
  visit(opened.resolvedUi)
  assert.equal(content[0]?.element, "Text", "the balance view label comes first")
  assert.deepEqual(content.slice(1, 3).map(node => node.element === "Status" ? [node.element, node.props.label, node.props.value] : [node.element]), [
    ["Status", "Balance owner", customer],
    ["Status", "Channel ID", "1"],
  ], "identify the opened resource before help text or operations")
})

test("entry chooses an explicit balance before displaying money or business writes", async () => {
  const { session, cam } = await fixture()
  assert.equal(cam.routes.myPosition, undefined)
  const entry = await session.load()
  for (const button of resolvedUiButtons(entry.resolvedUi)) assert.equal(session.actionKind(button), button.call.function === "position" ? "navigate" : "contractCall")
  assert.equal(entry.state.lookupCustomer, customer)
  assert.equal(entry.state.lookupChannelId, "0")
  assert.equal(entry.state.fundAmount, undefined)
  assert.deepEqual(resolvedUiButtons(entry.resolvedUi).map(button => button.call.function).sort(), ["createChannel", "position"])
  assert.equal(resolvedUiButtons(entry.resolvedUi).find(button => button.call.function === "createChannel")?.disabled, true)
  const connected = await session.setAccount({ address: other })
  assert.equal(connected.state.lookupCustomer, other)
  assert.equal(resolvedUiButtons(connected.resolvedUi).find(button => button.call.function === "createChannel")?.disabled, false)
  session.editInteger("lookupChannelId", "1")
  await session.dispatchAction(resolvedUiButtons(session.snapshot().resolvedUi!).find(button => button.call.function === "position")!)
  assert.equal(session.snapshot().route, "position")
  assert.deepEqual(session.snapshot().inputs, toInertValue({ customer: other, channelId: "1" }))
})

test("opened balances stay pinned across wallet changes and chooser round trips", async () => {
  const { session } = await fixture()
  await session.load()
  await session.navigate("position", { customer, channelId: "1" })
  session.editAmount("fundAmount", "base", "23")
  const changed = await session.setAccount({ address: other })
  assert.equal((changed.values[0] as Record<string, unknown>).customer, customer)
  assert.deepEqual(changed.inputs, toInertValue({ customer, channelId: "1" }))
  assert.equal(changed.state.fundAmount, null)
  assert.equal(changed.state.lookupCustomer, undefined)
  assert.equal(resolvedUiButtons(changed.resolvedUi).find(button => button.call.function === "fund")?.disabled, true)
  const choose = resolvedUiButtons(changed.resolvedUi).find(button => button.call.function === "choosePosition")!
  assert(choose)
  await session.dispatchAction(choose)
  assert.equal(session.snapshot().state?.lookupCustomer, customer)
  assert.equal(session.snapshot().state?.lookupChannelId, "1")
  const seeded = await session.setAccount({ address: contract })
  assert.equal(seeded.state.lookupCustomer, customer, "a seeded chooser must not replace the owner with a newly selected account")
  assert.equal(seeded.state.lookupChannelId, "1")
  const switched = await session.setAccount({ address: customer })
  await session.dispatchAction(resolvedUiButtons(switched.resolvedUi).find(button => button.call.function === "position")!)
  assert.equal(resolvedUiButtons(session.snapshot().resolvedUi!).find(button => button.call.function === "fund")?.disabled, false)
})

test("every write captures its explicit affected balance when prepared", async () => {
  const { cam, abi, session } = await fixture()
  for (const [route, inputs] of Object.entries({
    fund: { channelId: "1", amount: "20" }, requestWithdrawal: { channelId: "1", amount: "20" },
    setWithdrawal: { channelId: "1", amount: "20" }, move: { channelId: "1", targetId: "0" },
    withdraw: { customer: other, channelId: "1" }, collect: { customer: other, channelId: "1", cumulativeTotal: "20", signature: "0x" },
    setPayee: { customer: other, channelId: "1", payee: customer },
  })) {
    const prepared = prepareViewerContractCall({ cam, contracts: { "contracts.PayToPlay": { address: contract, abi } }, host, account: { address: customer }, route, inputs: toInertValue(inputs) as InertRecord })
    await session.load()
    await session.setAccount({ address: other })
    assert.deepEqual(prepared.then, toInertValue({ namespace: "routes", function: "position", args: { customer: ["withdraw", "collect", "setPayee"].includes(route) ? other : customer, channelId: "1" } }))
    await session.navigate(prepared.then.function, prepared.then.args)
    const changed = await session.setAccount({ address: customer })
    assert.deepEqual(changed.inputs, prepared.then.args)
  }
})


test("channel creation continues to a current lookup without predicting a created ID", async () => {
  const { cam, abi, session, chainState } = await fixture()
  const prepared = prepareViewerContractCall({ cam, contracts: { "contracts.PayToPlay": { address: contract, abi } }, host, account: { address: customer }, route: "createChannel", inputs: { payee: other, claimPeriod: "60" } })
  assert.deepEqual(prepared.then, toInertValue({ namespace: "routes", function: "channelLookup", args: {} }))
  await session.load()
  chainState.channelCount = 5n
  const lookup = await session.navigate(prepared.then.function, prepared.then.args)
  assert.equal((lookup.values[0] as Record<string, unknown>).channelCount, "5")
  assert.equal(lookup.state.fundAmount, undefined)
  const admin = await session.setAccount({ address: other })
  assert.equal(resolvedUiButtons(admin.resolvedUi).find(button => button.call.function === "createChannel")?.disabled, false)
  await session.setAccount({ address: customer })
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
  assert.equal(fresh.props.label, "View balance with fresh inputs")
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
