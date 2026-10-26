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
const uiContract: Address = "0x0000000000000000000000000000000000000066"
const voucherKey: Address = "0x0000000000000000000000000000000000000055"
const invoiceHash: Hex = `0x${"ab".repeat(32)}`
const zero: Address = "0x0000000000000000000000000000000000000000"
const directory = new URL("../../../../dapps/pay-to-play/cam/", import.meta.url)
const uri = "https://example.test/pay-to-play/main.json"
const preparationClient = {
  async getChainId(): Promise<never> { assert.fail("static write preparation must not call RPC") },
  async readContract(): Promise<never> { assert.fail("static write preparation must not read a contract") },
}

async function fixture() {
  const root = new Uint8Array(await readFile(new URL("main.json", directory)))
  const cam = parseCam(parseJsonBytes(root))
  const abi = parseJsonBytes(new Uint8Array(await readFile(new URL("abi/PayToPlay.json", directory)))) as Abi
  const chainState = {
    channelCount: 3n, payee: other, collector: other, mature: false, voucherKey,
    phase: 0n, scheduledRefundAt: 31536160n, refundAt: 31536160n,
    closeAt: 0n, balance: 100n, refundRecipient: customer,
  }
  const publicClient: CamPublicClient = {
    getChainId: async () => 31337,
    readContract: async request => {
      if (request.functionName === "supportsInterface") return true
      if (request.functionName === "camManifest") return { uri, sha256Digest: `0x${createHash("sha256").update(root).digest("hex")}` as Hex }
      if (request.functionName === "contractAddress") return request.args?.[0] === "PayToPlayUI" ? uiContract : contract
      if (request.functionName === "channelCount") return chainState.channelCount
      if (request.functionName === "viewVoucherSigningDetails") {
        assert.equal(request.address, uiContract)
        assert.equal(request.args?.[0], host.address, "the selected CAM host is checked by the projection")
        assert.equal(request.args?.length, 5)
        assert.match(String(request.args?.[4]), /^0x[0-9a-fA-F]{64}$/)
        return {
          domainName: "PayToPlay", domainVersion: "2", chainId: 31337n,
          verifyingContract: contract, voucherKey: chainState.voucherKey,
          digest: `0x${"12".repeat(32)}`,
        }
      }
      if (request.functionName === "viewPosition") {
        const [viewedCustomer, channelId, actor] = request.args!
        const id = BigInt(String(channelId))
        const key = id === 0n ? zero : chainState.voucherKey
        const ownPosition = actor === viewedCustomer && actor !== zero
        const operating = chainState.phase === 0n
        const operator = actor !== zero && (actor === other || (id !== 0n && actor === chainState.payee))
        const voucherActions = id === 0n ? [] : key !== zero && chainState.phase !== 2n ? ["voucherDigest", ...(actor !== zero && actor === chainState.collector ? ["collect"] : [])] : key === zero && ownPosition && operating ? ["registerVoucherKey"] : []
        return {
          customer: viewedCustomer, channelId: id, payee: chainState.payee, claimPeriod: 60n,
          channelCount: chainState.channelCount, admin: other, collector: chainState.collector, balance: chainState.balance, voucherPaid: 0n,
          requestedAmount: 0n, readyAt: 0n, effectiveBalance: chainState.balance, voucherKey: key,
          scheduledRefundAt: chainState.scheduledRefundAt, refundAt: chainState.refundAt,
          settleAt: chainState.refundAt === 0n ? 0n : chainState.refundAt - 60n,
          closeAt: chainState.closeAt, escrowTotal: chainState.balance,
          refundRecipient: chainState.refundRecipient, phase: chainState.phase,
          actions: [
            ...(actor === other ? ["createChannel", ...(id !== 0n ? ["setCollector"] : []), ...(id !== 0n && (chainState.closeAt === 0n || chainState.phase !== 2n) ? ["setPayee"] : [])] : []),
            ...(ownPosition ? ["setRefundRecipient", ...(operating ? ["fund", "requestWithdrawal", "setWithdrawal", ...(chainState.scheduledRefundAt !== 0n ? ["renewPosition"] : [])] : []), ...(chainState.mature ? ["withdraw", "move"] : [])] : []),
            ...((ownPosition || operator) && operating && chainState.scheduledRefundAt !== 0n ? ["closePosition"] : []),
            ...(operator && chainState.closeAt === 0n ? ["closeChannel"] : []),
            ...(chainState.phase === 2n && (chainState.balance !== 0n || chainState.scheduledRefundAt !== 0n) ? ["refund"] : []),
            ...voucherActions,
          ],
        }
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
  for (const route of ["registerVoucherKey", "fund", "requestWithdrawal", "setWithdrawal", "move"]) {
    assert(!cam.routes[route]!.inputs.includes("customer"), `${route} must not request a fictional customer`)
    const inputs: InertRecord = route === "registerVoucherKey"
      ? { channelId: "1", voucherKey }
      : route === "move" ? { channelId: "1", targetId: "0" } : { channelId: "1", amount: "20" }
    const options = { cam, contracts: { "contracts.PayToPlay": { address: contract, abi } }, host, account: { address: customer }, route }
    await assert.rejects(() => prepareViewerContractCall({ publicClient: preparationClient, ...options, inputs: { ...inputs, customer: other } }))
    const call = await prepareViewerContractCall({ publicClient: preparationClient, ...options, inputs })
    assert.deepEqual(call.then, toInertValue({ namespace: "routes", function: "position", args: { customer, channelId: "1" } }))
  }
})

test("fund writes bind one requested native amount as both ABI argument and transaction value", async () => {
  const { cam, abi } = await fixture()
  for (const amount of ["23", "0"]) {
    const prepared = await prepareViewerContractCall({ publicClient: preparationClient,
      cam,
      contracts: { "contracts.PayToPlay": { address: contract, abi } },
      host,
      account: { address: customer },
      route: "fund",
      inputs: { channelId: "1", amount },
    })
    assert.deepEqual(prepared.args, toInertValue({ channelId: "1", amount }))
    assert.equal(prepared.value, amount)
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
  assert.equal(opened.resolvedUi.element, "Screen")
  assert.equal(opened.resolvedUi.props.title, "Pay-to-Play")
  assert.equal(opened.resolvedUi.children[0]?.element, "Screen")
  assert.equal(opened.resolvedUi.children[0]?.props.title, "Account balance")
  assert.deepEqual(content.slice(0, 2).map(node => node.element === "Status" ? [node.element, node.props.label, node.props.value] : [node.element]), [
    ["Status", "Balance owner", customer],
    ["Status", "Channel ID", "1"],
  ], "identify the opened resource before help text or operations")
})

test("every read destination retains the application heading above its task", async () => {
  const { session, cam } = await fixture()
  await session.load()
  const inputs = { customer, channelId: "1", cumulativeTotal: "20", invoiceHash }
  const titles: Record<string, readonly string[]> = {
    home: ["Open a balance", "Create a channel (admin only)"],
    position: ["Account balance"],
    voucherDigest: ["Voucher signing details"],
    channelLookup: ["Find a channel ID"],
    choosePosition: ["Open a balance", "Create a channel (admin only)"],
    recovery: ["Recovery for this account and channel"],
  }
  for (const [route, declaration] of Object.entries(cam.routes)) {
    if (declaration.kind !== "read") continue
    const opened = await session.navigate(route, Object.fromEntries(declaration.inputs.map(name => [name, inputs[name as keyof typeof inputs]])))
    assert.equal(opened.resolvedUi.element, "Screen", route)
    assert.equal(opened.resolvedUi.props.title, "Pay-to-Play", route)
    const body = opened.resolvedUi.children[0]
    assert(body)
    const tasks = body.element === "Fragment" ? body.children : [body]
    assert.deepEqual(tasks.map(task => {
      assert.equal(task.element, "Screen")
      return task.props.title
    }), titles[route], route)
  }
})

test("payment tasks keep their controls together and separate channel administration", async () => {
  const { session } = await fixture()
  await session.load()
  const opened = await session.navigate("position", { customer, channelId: "1" })
  const groups: Record<string, string | undefined> = {}
  function visit(node: ResolvedUiNode, title: string | undefined): void {
    if (node.element === "Screen") title = String(node.props.title)
    if (node.element === "Button") groups[node.call.function] = title
    if (node.element === "Screen" || node.element === "Fragment") node.children.forEach(child => visit(child, title))
  }
  visit(opened.resolvedUi, undefined)
  for (const [group, routes] of [
    ["Deposit", ["fund"]],
    ["Withdraw or move funds", ["requestWithdrawal", "setWithdrawal", "withdraw", "move"]],
    ["Voucher signing key", ["registerVoucherKey"]],
    ["Voucher payments", ["voucherDigest", "collect"]],
    ["Create a channel (admin only)", ["createChannel"]],
    ["Channel administration", ["setPayee", "setCollector"]],
  ] as const) for (const route of routes) assert.equal(groups[route], group, route)
})

test("recovery separates account actions from channel retirement and explains retirement before review", async () => {
  const { session } = await fixture()
  await session.load()
  const opened = await session.navigate("recovery", { customer, channelId: "1" })
  const groups: Record<string, string | undefined> = {}
  const retirement: ResolvedUiNode[] = []
  function visit(node: ResolvedUiNode, title: string | undefined): void {
    if (node.element === "Screen") title = String(node.props.title)
    if (title === "Retire this channel") retirement.push(node)
    if (node.element === "Button") groups[node.call.function] = title
    if (node.element === "Screen" || node.element === "Fragment") node.children.forEach(child => visit(child, title))
  }
  visit(opened.resolvedUi, undefined)
  for (const route of ["renewPosition", "setRefundRecipient", "closePosition", "refund"]) assert.equal(groups[route], "Account recovery", route)
  assert.equal(groups.closeChannel, "Retire this channel")
  const warning = retirement.findIndex(node => node.element === "Text" && String(node.props.text).includes("every customer"))
  const action = retirement.findIndex(node => node.element === "Button" && node.call.function === "closeChannel")
  assert(warning >= 0 && warning < action, "the channel-wide consequence must precede the retirement action")
})

test("account destinations offer navigation with the inspected identity across wallet changes", async () => {
  const { session } = await fixture()
  await session.load()
  for (const route of ["position", "recovery", "voucherDigest"]) {
    await session.navigate(route, route === "voucherDigest" ? { customer, channelId: "1", cumulativeTotal: "20", invoiceHash } : { customer, channelId: "1" })
    const opened = await session.setAccount({ address: other })
    const chooser = resolvedUiButtons(opened.resolvedUi).find(button => button.call.function === "choosePosition")
    assert(chooser, `${route} must offer a way to change the inspected account or channel`)
    assert.deepEqual(chooser.call.args, toInertValue({ customer, channelId: "1" }))
    const destination = route === "position" ? "recovery" : "position"
    const navigation = resolvedUiButtons(opened.resolvedUi).find(button => button.call.function === destination)
    assert(navigation, `${route} must offer ${destination}`)
    assert.deepEqual(navigation.call.args, toInertValue({ customer, channelId: "1" }))
  }
})

test("opening a balance and creating a channel are peer tasks with separate controls", async () => {
  const { session } = await fixture()
  await session.load()
  for (const account of [customer, other]) {
    const opened = await session.setAccount({ address: account })
    assert.equal(opened.resolvedUi.element, "Screen")
    const tasks = opened.resolvedUi.children[0]
    assert.equal(tasks?.element, "Fragment")
    const [lookup, creation] = tasks.children
    assert.equal(lookup?.element, "Screen")
    assert.equal(lookup.props.title, "Open a balance")
    assert.deepEqual(resolvedUiButtons(lookup).map(button => button.call.function), ["position"])
    assert.equal(creation?.element, "Screen")
    assert.equal(creation.props.title, "Create a channel (admin only)")
    const buttons = resolvedUiButtons(creation)
    assert.deepEqual(buttons.map(button => button.call.function), ["createChannel"])
    assert.equal(buttons[0]?.disabled === true, account !== other, "admin controls remain visible with contract-projected availability")
    assert.equal(tasks.children.length, 2)
  }
})

test("entry chooses an explicit balance before displaying money or business writes", async () => {
  const { session, cam } = await fixture()
  assert.equal(cam.routes.myPosition, undefined)
  const entry = await session.load()
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
    registerVoucherKey: { channelId: "1", voucherKey },
    fund: { channelId: "1", amount: "20" }, requestWithdrawal: { channelId: "1", amount: "20" },
    setWithdrawal: { channelId: "1", amount: "20" }, move: { channelId: "1", targetId: "0" },
    withdraw: { customer: other, channelId: "1" }, collect: { customer: other, channelId: "1", cumulativeTotal: "20", maxAmount: "20", invoiceHash, signature: "0x" },
    setPayee: { customer: other, channelId: "1", payee: customer },
  })) {
    const prepared = await prepareViewerContractCall({ publicClient: preparationClient, cam, contracts: { "contracts.PayToPlay": { address: contract, abi } }, host, account: { address: customer }, route, inputs: toInertValue(inputs) as InertRecord })
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
  const prepared = await prepareViewerContractCall({ publicClient: preparationClient, cam, contracts: { "contracts.PayToPlay": { address: contract, abi } }, host, account: { address: customer }, route: "createChannel", inputs: { payee: other, collector: other, claimPeriod: "60" } })
  assert.deepEqual(prepared.then, toInertValue({ namespace: "routes", function: "channelLookup", args: {} }))
  await session.load()
  chainState.channelCount = 5n
  const lookup = await session.navigate(prepared.then.function, prepared.then.args)
  assert.equal((lookup.values[0] as Record<string, unknown>).channelCount, "5")
  assert.equal(lookup.state.fundAmount, undefined)
  const admin = await session.setAccount({ address: other })
  assert.deepEqual(resolvedUiButtons(admin.resolvedUi).map(button => button.call.function), ["position"], "receipt lookup must not offer another channel creation")
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
  await session.setAccount({ address: other })
  await session.navigate("position", { customer, channelId: "1" })
  session.editAmount("cumulativeTotal", "base", "20")
  const draft = session.updateState({ invoiceHash, signature: "unfinished signature" })
  const digest = resolvedUiButtons(draft.resolvedUi).find(button => button.call.function === "voucherDigest")!
  await session.dispatchAction(digest)
  const details = session.snapshot()
  assert.equal(details.route, "voucherDigest")
  assert.equal(details.inputs.invoiceHash, invoiceHash)
  const fresh = resolvedUiButtons(details.resolvedUi!).find(button => button.call.function === "position")!
  assert.equal(fresh.props.label, "View balance with fresh inputs")
  const restored = await session.back()
  assert.equal(restored.state.cumulativeTotal, "20")
  assert.equal(restored.state.signature, "unfinished signature")
  assert.equal(restored.state.invoiceHash, invoiceHash)
  await session.navigate("voucherDigest", { customer, channelId: "1", cumulativeTotal: "20", invoiceHash })
  const direct = resolvedUiButtons(session.snapshot().resolvedUi!).find(button => button.call.function === "position")!
  await session.dispatchAction(direct)
  assert.equal(session.snapshot().state?.cumulativeTotal, null)
  assert.equal(session.snapshot().state?.signature, "")
  assert.equal(session.snapshot().state?.invoiceHash, "")
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


test("registration is owner-only and collection follows the registered key on refresh", async () => {
  const { session, chainState } = await fixture()
  chainState.voucherKey = zero
  await session.load()
  let opened = await session.navigate("position", { customer, channelId: "1" })
  let buttons = resolvedUiButtons(opened.resolvedUi)
  assert.equal((opened.values[0] as Record<string, unknown>).voucherKey, zero)
  assert.equal(buttons.find(button => button.call.function === "registerVoucherKey")?.disabled, false)
  assert.equal(buttons.find(button => button.call.function === "collect")?.disabled, true)
  assert.equal(buttons.find(button => button.call.function === "voucherDigest")?.disabled, true)
  const edited = session.updateState({ newVoucherKey: voucherKey })
  const registration = resolvedUiButtons(edited.resolvedUi).find(button => button.call.function === "registerVoucherKey")!
  assert.deepEqual(registration.call.args, toInertValue({ channelId: "1", voucherKey }))
  opened = await session.setAccount({ address: other })
  buttons = resolvedUiButtons(opened.resolvedUi)
  assert.equal(buttons.find(button => button.call.function === "registerVoucherKey")?.disabled, true)
  assert.equal(buttons.find(button => button.call.function === "collect")?.disabled, true)
  assert.equal(opened.state.newVoucherKey, "", "changing wallets clears an unfinished registration")
  chainState.voucherKey = voucherKey
  opened = await session.refresh()
  buttons = resolvedUiButtons(opened.resolvedUi)
  assert.equal((opened.values[0] as Record<string, unknown>).voucherKey, voucherKey)
  assert.equal(buttons.find(button => button.call.function === "registerVoucherKey")?.disabled, true)
  assert.equal(buttons.find(button => button.call.function === "collect")?.disabled, false)
  opened = await session.setAccount({ address: customer })
  assert.equal(resolvedUiButtons(opened.resolvedUi).find(button => button.call.function === "registerVoucherKey")?.disabled, true)
  opened = await session.navigate("position", { customer, channelId: "0" })
  buttons = resolvedUiButtons(opened.resolvedUi)
  assert.equal(buttons.find(button => button.call.function === "registerVoucherKey")?.disabled, true)
  assert.equal(buttons.find(button => button.call.function === "collect")?.disabled, true)
})

test("recovery writes bind the appropriate owner and never accept executor-selected refund destinations", async () => {
  const { cam, abi } = await fixture()
  for (const [route, inputs] of Object.entries({
    renewPosition: { channelId: "1" },
    setRefundRecipient: { channelId: "1", recipient: voucherKey },
    closePosition: { customer: other, channelId: "1" },
    closeChannel: { customer: other, channelId: "1" },
    refund: { customer: other, channelId: "1" },
  })) {
    const options = { cam, contracts: { "contracts.PayToPlay": { address: contract, abi } }, host, account: { address: customer }, route }
    const prepared = await prepareViewerContractCall({ publicClient: preparationClient, ...options, inputs: toInertValue(inputs) as InertRecord })
    const senderOwned = route === "renewPosition" || route === "setRefundRecipient"
    assert.deepEqual(prepared.then, toInertValue({ namespace: "routes", function: "recovery", args: { customer: senderOwned ? customer : other, channelId: "1" } }))
    if (senderOwned) await assert.rejects(() => prepareViewerContractCall({ publicClient: preparationClient, ...options, inputs: { ...inputs, customer: other } }))
    if (route === "refund") await assert.rejects(() => prepareViewerContractCall({ publicClient: preparationClient, ...options, inputs: { ...inputs, recipient: voucherKey } }))
  }
})

test("recovery navigation stays pinned and follows contract-returned phase and permissions", async () => {
  const { session, chainState } = await fixture()
  await session.load()
  await session.navigate("position", { customer, channelId: "1" })
  await session.dispatchAction(resolvedUiButtons(session.snapshot().resolvedUi!).find(button => button.call.function === "recovery")!)
  assert.equal(session.snapshot().route, "recovery")
  assert.deepEqual(session.snapshot().inputs, toInertValue({ customer, channelId: "1" }))
  const availability = () => Object.fromEntries(resolvedUiButtons(session.snapshot().resolvedUi!).map(button => [button.call.function, !button.disabled]))
  assert.equal(availability().renewPosition, true)
  assert.equal(availability().closePosition, true)
  assert.equal(availability().closeChannel, false)
  assert.equal(availability().refund, false)
  session.updateState({ newRefundRecipient: voucherKey })
  const switched = await session.setAccount({ address: other })
  assert.deepEqual(switched.inputs, toInertValue({ customer, channelId: "1" }))
  assert.equal(switched.state.newRefundRecipient, customer, "wallet changes discard the unfinished recipient edit")
  assert.equal(availability().setRefundRecipient, false)
  assert.equal(availability().renewPosition, false)
  assert.equal(availability().closePosition, true)
  assert.equal(availability().closeChannel, true)
  chainState.phase = 1n
  chainState.closeAt = 160n
  chainState.refundAt = 160n
  await session.refresh()
  assert.equal(availability().closeChannel, false)
  assert.equal(availability().closePosition, false)
  assert.equal(availability().refund, false)
  await session.navigate("position", { customer, channelId: "1" })
  assert.equal(availability().fund, false)
  assert.equal(availability().collect, true)
  chainState.phase = 2n
  await session.refresh()
  assert.equal(availability().collect, false)
  await session.navigate("recovery", { customer, channelId: "1" })
  await session.setAccount({ address: contract })
  assert.equal(availability().refund, true, "an unrelated relayer may execute the due refund")
  assert.equal(availability().setRefundRecipient, false)
  await session.setAccount({ address: customer })
  assert.equal(availability().setRefundRecipient, true, "owner may repair a recipient after the deadline")
  chainState.balance = 0n
  chainState.scheduledRefundAt = 0n
  await session.refresh()
  assert.equal(availability().refund, false, "do not offer repeated empty refunds after channel retirement")
  assert.equal(availability().renewPosition, false)
  await session.dispatchAction(resolvedUiButtons(session.snapshot().resolvedUi!).find(button => button.call.function === "position")!)
  assert.deepEqual(session.snapshot().inputs, toInertValue({ customer, channelId: "1" }))
  assert.equal(availability().fund, false, "a retired channel never reopens")
})


test("collection preparation requires an exact bytes32 reference and preserves the inspected customer", async () => {
  const { cam, abi } = await fixture()
  const options = {
    cam, contracts: { "contracts.PayToPlay": { address: contract, abi } }, host,
    account: { address: other }, route: "collect",
  }
  const base = { customer, channelId: "1", cumulativeTotal: "20", maxAmount: "20", signature: "0xabcd" }
  await assert.rejects(() => prepareViewerContractCall({ publicClient: preparationClient, ...options, inputs: base }))
  for (const invalid of ["", "0x", "0x12", `0x${"ab".repeat(31)}`, `0x${"ab".repeat(33)}`, `0x${"zz".repeat(32)}`]) {
    await assert.rejects(() => prepareViewerContractCall({ publicClient: preparationClient, ...options, inputs: { ...base, invoiceHash: invalid } }))
  }
  const prepared = await prepareViewerContractCall({ publicClient: preparationClient, ...options, inputs: { ...base, invoiceHash } })
  assert.equal(prepared.function, "collect")
  assert.deepEqual(prepared.args, toInertValue({
    customer, channelId: "1", cumulativeTotal: "20", maxAmount: "20", invoiceHash, signature: "0xabcd",
  }))
  assert.deepEqual(prepared.then.args, toInertValue({ customer, channelId: "1" }))
  await assert.rejects(() => prepareViewerContractCall({ publicClient: preparationClient, ...options, inputs: { ...base, invoiceHash, payee: other } }))
})

test("invoice-reference drafts survive refresh but are cleared by wallet changes", async () => {
  const { session } = await fixture()
  await session.load()
  await session.setAccount({ address: other })
  await session.navigate("position", { customer, channelId: "1" })
  session.editAmount("cumulativeTotal", "base", "20")
  session.editAmount("maxAmount", "base", "20")
  let loaded = session.updateState({ invoiceHash, signature: "0xabcd" })
  const button = resolvedUiButtons(loaded.resolvedUi).find(item => item.call.function === "collect")!
  const result = await session.dispatchAction(button)
  assert.equal(result.type, "contractCall")
  if (result.type !== "contractCall") throw new Error("fixture expected a prepared collection")
  assert.equal(result.call.args.invoiceHash, invoiceHash)
  loaded = await session.refresh()
  assert.equal(loaded.state.invoiceHash, invoiceHash)
  assert.equal(loaded.state.signature, "0xabcd")
  session.updateState({ invoiceHash: `0x${"cd".repeat(32)}` })
  assert.equal(result.call.args.invoiceHash, invoiceHash, "later draft edits cannot rewrite the reviewed call")
  loaded = await session.setAccount({ address: customer })
  assert.equal(loaded.state.invoiceHash, "")
  assert.equal(loaded.state.signature, "")
  assert.deepEqual(loaded.inputs, toInertValue({ customer, channelId: "1" }))
})

test("collector changes gate payments without blocking signing details or changing the inspected balance", async () => {
  const { session, chainState } = await fixture()
  await session.load()
  await session.navigate("position", { customer, channelId: "1" })
  const actions = () => Object.fromEntries(resolvedUiButtons(session.snapshot().resolvedUi!).map(button => [button.call.function, !button.disabled]))
  assert.equal(actions().collect, false)
  assert.equal(actions().voucherDigest, true)
  await session.setAccount({ address: other })
  assert.equal(actions().collect, true)
  chainState.collector = voucherKey
  await session.refresh()
  assert.equal(actions().collect, false)
  const edited = session.updateState({ newCollector: zero })
  const change = resolvedUiButtons(edited.resolvedUi).find(button => button.call.function === "setCollector")!
  const prepared = await session.dispatchAction(change)
  assert.equal(prepared.type, "contractCall")
  if (prepared.type !== "contractCall") assert.fail("admin collector change must prepare a transaction")
  assert.deepEqual(prepared.call.args, toInertValue({ channelId: "1", nextCollector: zero }))
  assert.deepEqual(prepared.call.then.args, toInertValue({ customer, channelId: "1" }))
  chainState.collector = zero
  await session.setAccount({ address: zero })
  assert.equal(actions().collect, false)
  assert.equal(actions().voucherDigest, true)
  assert.deepEqual(session.snapshot().inputs, toInertValue({ customer, channelId: "1" }))
})

test("signing details display the supplied invoice hash and reject an invoice-less read", async () => {
  const { session } = await fixture()
  await session.load()
  await assert.rejects(() => session.navigate("voucherDigest", { customer, channelId: "1", cumulativeTotal: "20" }))
  const loaded = await session.navigate("voucherDigest", { customer, channelId: "1", cumulativeTotal: "20", invoiceHash })
  const statuses: Record<string, unknown> = {}
  function visit(node: ResolvedUiNode): void {
    if (node.element === "Status") {
      const label = node.props.label
      assert(typeof label === "string")
      statuses[label] = node.props.value
    }
    if (node.element === "Screen" || node.element === "Fragment") node.children.forEach(visit)
  }
  visit(loaded.resolvedUi)
  assert.equal(statuses["Invoice hash (bytes32)"], invoiceHash)
  assert.equal(statuses["Balance owner"], customer)
})

test("signing details show the payment domain and registered key, distinct from host, projection and wallet", async () => {
  const { session, chainState } = await fixture()
  await session.load()
  chainState.voucherKey = zero
  await session.navigate("voucherDigest", { customer, channelId: "1", cumulativeTotal: "20", invoiceHash })
  function values(node: ResolvedUiNode, found: Record<string, unknown> = {}): Record<string, unknown> {
    if (node.element === "Status") found[String(node.props.label)] = node.props.value
    if (node.element === "Screen" || node.element === "Fragment") node.children.forEach(child => values(child, found))
    return found
  }
  let shown = values(session.snapshot().resolvedUi!)
  assert.equal(shown["Domain name"], "PayToPlay")
  assert.equal(shown["Domain version"], "2")
  assert.equal(shown["Chain ID"], "31337")
  assert.equal(shown["Payment contract (verifyingContract)"], contract)
  assert.equal(shown["Registered voucher key"], zero)
  chainState.voucherKey = voucherKey
  shown = values((await session.refresh()).resolvedUi)
  assert.equal(shown["Registered voucher key"], voucherKey)
  assert.notEqual(shown["Payment contract (verifyingContract)"], host.address)
  assert.notEqual(shown["Payment contract (verifyingContract)"], uiContract)
  assert.notEqual(shown["Registered voucher key"], customer)
})
