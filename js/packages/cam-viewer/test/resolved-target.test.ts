import assert from "node:assert/strict"
import test from "node:test"
import { CamEvmError, sendCamContractCall, simulateCamContractCall } from "@cam/evm-viem"
import type { CamPublicClient, CamSimulationClient, CamWalletClient } from "@cam/evm-viem"
import { resolvedUiButtons } from "@cam/screen"
import { createCamViewerSession, CamViewerError } from "../src/index.ts"
import {
  configuredCollection, oldCollection, resolvedTargetBundle, resolvedTargetHash, makeStaticResolvedTargetDocument,
  resolvedTargetHost, resolvedTargetManager, resolvedTargetOwner, resolvedTargetRecipient,
  resolvedTargetSerial, resolvedTargetURI,
  resolvedTargetManagerAbi,
} from "../../../../tests/fixtures/cam/bike-resolved-target.mts"
import { createMockCamPublicClient } from "../../../../tests/fixtures/cam/mock.mts"

function harness(resolve: () => unknown | Promise<unknown> = () => [oldCollection, 17n], legacy = false, managerAbi: unknown = resolvedTargetManagerAbi) {
  const bundle = resolvedTargetBundle(legacy ? makeStaticResolvedTargetDocument : undefined, managerAbi)
  const mock = createMockCamPublicClient({ chainId: 31337, camURI: resolvedTargetURI,
    camHash: resolvedTargetHash(bundle.rootBytes), supportsCamInterface: true,
    addresses: { Manager: resolvedTargetManager, BikeNFT: configuredCollection },
    routeResults: { viewEntry: "Generic resolved target" },
  })
  const reads: Parameters<CamPublicClient["readContract"]>[0][] = []
  const session = createCamViewerSession({
    host: resolvedTargetHost, account: { address: resolvedTargetOwner }, inputs: {},
    publicClient: { getChainId: mock.getChainId, async readContract(request) {
      reads.push(request)
      if (request.functionName === "tokenReference") return resolve()
      return mock.readContract(request)
    } },
    async loadResource(uri) {
      if (uri === resolvedTargetURI) return bundle.rootBytes
      for (const [path, bytes] of bundle.resources) if (new URL(path, resolvedTargetURI).href === uri) return bytes
      throw new Error(`Unexpected resource: ${uri}`)
    },
  })
  return { session, reads }
}

for (const type of ["string", "bytes20"]) {
  test(`viewer rejects resolver ABI ${type} targets even when their value looks like an address`, async () => {
    const { session, reads } = harness(() => [oldCollection, 17n], false, [resolvedTargetManagerAbi[0], {
      ...resolvedTargetManagerAbi[1], outputs: [{ name: "token", type }, { name: "tokenId", type: "uint256" }],
    }])
    const action = await actionFor(session)
    await assert.rejects(() => session.dispatchAction(action), error => error instanceof CamEvmError && /scalar address/.test(error.message))
    assert.equal(reads.filter(read => read.functionName === "tokenReference").length, 0, "ABI rejection precedes resolver RPC")
  })
}

for (const stateMutability of ["nonpayable", "payable"]) {
  test(`viewer rejects a ${stateMutability} resolver before any resolver RPC`, async () => {
    const { session, reads } = harness(() => [oldCollection, 17n], false, [resolvedTargetManagerAbi[0], {
      ...resolvedTargetManagerAbi[1], stateMutability,
    }])
    const action = await actionFor(session)
    await assert.rejects(() => session.dispatchAction(action), error => error instanceof CamEvmError && /view or pure/.test(error.message))
    assert.equal(reads.filter(read => read.functionName === "tokenReference").length, 0)
  })
}
async function actionFor(session: ReturnType<typeof harness>["session"]) {
  const loaded = await session.load()
  const action = resolvedUiButtons(loaded.resolvedUi).find(button => button.call.function === "transferComponent")
  assert.ok(action, "ordinary generic UI renderer must expose the transfer route")
  return action
}

const chain = { id: 31337, name: "fixture", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } } }

test("review, simulation and submission freeze the per-record collection rather than the latest configured collection", async () => {
  let reference: unknown = [oldCollection, 17n]
  const { session, reads } = harness(() => reference)
  const action = await actionFor(session)
  assert.equal(reads.filter(read => read.functionName === "tokenReference").length, 0)
  const result = await session.dispatchAction(action)
  assert.equal(result.type, "contractCall")
  if (result.type !== "contractCall") assert.fail("expected reviewable call")
  assert.equal(result.call.address, oldCollection)
  assert.notEqual(result.call.address, configuredCollection)
  assert.equal(result.call.function, "safeTransferFrom(address,address,uint256)")
  assert.deepEqual({ ...result.call.args }, { from: resolvedTargetOwner, to: resolvedTargetRecipient, tokenId: "17" })
  assert.deepEqual({ ...result.call.then.args }, {}, "read outputs must not leak into the write continuation")
  const resolverReads = reads.filter(read => read.functionName === "tokenReference")
  assert.equal(resolverReads.length, 1)
  assert.equal(resolverReads[0].address, resolvedTargetManager)
  assert.deepEqual(resolverReads[0].args, [resolvedTargetSerial])

  reference = [configuredCollection, 999n]
  const simulations: Parameters<CamSimulationClient["simulateContract"]>[0][] = []
  const submissions: Parameters<CamWalletClient["writeContract"]>[0][] = []
  await simulateCamContractCall({ publicClient: { async simulateContract(request) { simulations.push(request) } }, account: resolvedTargetOwner, call: result.call })
  await sendCamContractCall({ walletClient: { async writeContract(request) { submissions.push(request); return "0x1234" } }, chain, call: result.call })
  assert.equal(simulations[0].functionName, "safeTransferFrom")
  assert.equal(simulations[0].abi.filter(item => item.type === "function").length, 1, "only the reviewed overload reaches viem")
  assert.equal(simulations[0].address, oldCollection)
  assert.equal(simulations[0].account, resolvedTargetOwner)
  assert.equal(submissions[0].address, oldCollection)
  assert.deepEqual(simulations[0].args, [resolvedTargetOwner, resolvedTargetRecipient, 17n])
  assert.deepEqual(submissions[0].args, simulations[0].args)
  assert.equal(reads.filter(read => read.functionName === "tokenReference").length, 1, "never reread at simulation or submission")
})

for (const [name, output] of [
  ["zero address", ["0x0000000000000000000000000000000000000000", 17n]],
  ["malformed address", ["not-an-address", 17n]],
  ["missing address", [undefined, 17n]],
  ["missing token ID", [oldCollection]],
  ["negative token ID", [oldCollection, -1n]],
  ["overflow token ID", [oldCollection, 1n << 256n]],
  ["unexpected extra output", [oldCollection, 17n, "extra"]],
] as const) {
  test(`resolver ${name} fails closed before exposing a prepared call`, async () => {
    const { session, reads } = harness(() => output)
    const action = await actionFor(session) // Load must succeed; a version failure is not the expected rejection.
    await assert.rejects(() => session.dispatchAction(action), error => error instanceof CamEvmError || error instanceof CamViewerError)
    assert.equal(reads.filter(read => read.functionName === "tokenReference").length, 1)
  })
}

test("resolver RPC failure never falls back to the configured collection", async () => {
  const { session, reads } = harness(() => { throw new Error("token reference RPC unavailable") })
  const action = await actionFor(session)
  await assert.rejects(() => session.dispatchAction(action), error => error instanceof CamEvmError && error.cause instanceof Error && error.cause.message === "token reference RPC unavailable")
  assert.equal(reads.filter(read => read.functionName === "tokenReference").length, 1)
})

for (const change of ["account", "navigation"] as const) {
  test(`${change} change invalidates an in-flight resolver result`, async () => {
    let finish: ((value: unknown) => void) | undefined
    let started: (() => void) | undefined
    const entered = new Promise<void>(resolve => { started = resolve })
    const delayed = new Promise<unknown>(resolve => { finish = resolve })
    const { session } = harness(() => { started!(); return delayed })
    const action = await actionFor(session)
    const pending = session.dispatchAction(action)
    // Attach the rejection handler before changing state to avoid unhandled rejections.
    const rejected = assert.rejects(pending, error => error instanceof CamViewerError && /stale|changed|invalid|supersed/i.test(error.message))
    await Promise.race([entered, pending.then(() => assert.fail("write preparation completed without awaiting the resolver"))])
    if (change === "account") await session.setAccount({ address: resolvedTargetRecipient })
    else await session.navigate("entry", {})
    finish!([oldCollection, 17n])
    await rejected
  })
}

test("CAM 1.2 control loads the same generic resources and prepares the static collection without resolution", async () => {
  const { session, reads } = harness(undefined, true)
  const action = await actionFor(session)
  const result = await session.dispatchAction(action)
  assert.equal(result.type, "contractCall")
  if (result.type !== "contractCall") assert.fail("expected static write")
  assert.equal(result.call.address, configuredCollection)
  assert.equal(result.call.function, "safeTransferFrom(address,address,uint256)")
  assert.equal(reads.filter(read => read.functionName === "tokenReference").length, 0)
})

test("a newer record may resolve to the configured collection without changing the generic route", async () => {
  const { session, reads } = harness(() => [configuredCollection, 23n])
  const result = await session.dispatchAction(await actionFor(session))
  assert.equal(result.type, "contractCall")
  if (result.type !== "contractCall") assert.fail("expected reviewable write")
  assert.equal(result.call.address, configuredCollection)
  assert.deepEqual({ ...result.call.args }, { from: resolvedTargetOwner, to: resolvedTargetRecipient, tokenId: "23" })
  assert.equal(reads.filter(read => read.functionName === "tokenReference").length, 1)
})
