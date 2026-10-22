import assert from "node:assert/strict"
import test from "node:test"
import { toInertValue } from "@cam/protocol"
import { CamEvmError } from "@cam/evm-viem"
import { resolvedUiButtons } from "@cam/screen"
import { CamViewerError, createCamViewerSession } from "../src/index.ts"
import type { CamViewerLoadedSnapshot } from "../src/index.ts"
import { bikeCamJson } from "../../../../tests/fixtures/cam/bike-resources.mts"
import { BIKE_ACCOUNT_ADDRESS, BIKE_COMPONENTS_ADDRESS, BIKE_SERIAL_NUMBER, BIKE_TOKEN_ID } from "../../../../tests/fixtures/cam/bike.mts"
import { BUYER, WORKSHOP, OTHER_WORKSHOP, ownerWorkflowSessionOptions } from "../../../../tests/fixtures/cam/bike-owner-workflows.mts"

function button(snapshot: CamViewerLoadedSnapshot, route: string) {
  const result = resolvedUiButtons(snapshot.resolvedUi).find(candidate => candidate.call.function === route)
  assert.ok(result, `Published Bike UI must expose ${route}`)
  return result
}

function requireRoute(route: string) {
  assert.ok(bikeCamJson.routes[route], `Bike CAM publication is missing the ${route} owner workflow`)
}

const staleAction = (error: unknown) => error instanceof CamViewerError && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"

test("a thirty-minute workshop cap requires a chosen duration and rejects over-limit previews before RPC", async () => {
  const fixture = ownerWorkflowSessionOptions()
  fixture.setMaxDelegationDuration(1800n)
  const session = createCamViewerSession(fixture.options)
  const loaded = await session.load()
  assert.equal(loaded.state.duration, null)
  const selected = session.updateState({ delegate: WORKSHOP })
  const invalidDuration = (error: unknown) => error instanceof CamEvmError && error.code === "CAM_ROUTE_INVALID_ARGUMENT"
  await assert.rejects(() => session.dispatchAction(button(selected, "delegation")), invalidDuration)
  const tooLong = session.updateState({ duration: "1801" })
  assert.equal(tooLong.state.duration, null)
  await assert.rejects(() => session.dispatchAction(button(tooLong, "delegation")), invalidDuration)
  assert.equal(fixture.reads.filter(call => call.functionName === "viewDelegation").length, 0)

  const valid = session.updateState({ duration: "1800" })
  const result = await session.dispatchAction(button(valid, "delegation"))
  assert.equal(result.type, "navigated")
  if (result.type !== "navigated") assert.fail("chosen duration must open the workshop preview")
  assert.equal((result.snapshot.values[0] as { maxDelegationDuration?: unknown }).maxDelegationDuration, "1800")
  assert.equal((result.snapshot.values[0] as { validUntil?: unknown }).validUntil, "2000001800")
  assert.equal(result.snapshot.state.duration, "1800", "the preview retains the chosen duration")
  assert.deepEqual(fixture.reads.filter(call => call.functionName === "viewDelegation").map(call => call.args), [
    [BIKE_SERIAL_NUMBER, WORKSHOP, BIKE_ACCOUNT_ADDRESS, 1800n],
  ])
})

test("an unchosen workshop duration does not block metadata correction or NFT handover", async () => {
  const fixture = ownerWorkflowSessionOptions()
  const session = createCamViewerSession(fixture.options)
  const loaded = await session.load()
  assert.equal(loaded.state.duration, null)
  const snapshot = session.updateState({ tokenURI: "fixture://corrected", to: BUYER })
  assert.equal((await session.dispatchAction(button(snapshot, "updateComponentMetadata"))).type, "contractCall")
  assert.equal((await session.dispatchAction(button(snapshot, "transferComponent"))).type, "contractCall")
  assert.equal(fixture.reads.filter(call => call.functionName === "viewDelegation").length, 0)
})

test("published Bike delegation route inspects an arbitrary workshop independently of connected owner", async () => {
  requireRoute("delegation")
  const fixture = ownerWorkflowSessionOptions()
  const session = createCamViewerSession(fixture.options)
  await session.load()
  for (const delegate of [WORKSHOP, OTHER_WORKSHOP]) {
    await session.navigate("delegation", { serialNumber: BIKE_SERIAL_NUMBER, delegate, duration: "3600" })
    const read = [...fixture.reads].reverse().find(call => call.functionName === "viewDelegation")
    assert.deepEqual(read?.args, [BIKE_SERIAL_NUMBER, delegate, BIKE_ACCOUNT_ADDRESS, 3600n])
  }
})

test("published Bike handover resolves the record collection and prepares direct owner safeTransferFrom", async () => {
  requireRoute("transferComponent")
  const fixture = ownerWorkflowSessionOptions()
  const session = createCamViewerSession(fixture.options)
  await session.load()
  const snapshot = session.updateState({ to: BUYER, serialNumber: "UNLOADED-SERIAL" })
  const result = await session.dispatchAction(button(snapshot, "transferComponent"))
  assert.equal(result.type, "contractCall")
  if (result.type !== "contractCall") assert.fail("handover must prepare a wallet call")
  assert.equal(result.call.address, BIKE_COMPONENTS_ADDRESS, "never use current registration collection or manager as transfer target")
  assert.equal(result.call.function, "safeTransferFrom(address,address,uint256)")
  assert.deepEqual(result.call.args, toInertValue({ from: BIKE_ACCOUNT_ADDRESS, to: BUYER, tokenId: String(BIKE_TOKEN_ID) }))
  assert.equal(result.call.then.function, "component")
  assert.deepEqual(result.call.then.args, toInertValue({ serialNumber: BIKE_SERIAL_NUMBER }))
  assert.equal(session.snapshot().account?.address, BIKE_ACCOUNT_ADDRESS)
  assert.equal(fixture.reads.filter(call => call.functionName === "tokenReference").length, 1)
})

test("account change invalidates the rendered owner handover action", async () => {
  requireRoute("transferComponent")
  const fixture = ownerWorkflowSessionOptions()
  const session = createCamViewerSession(fixture.options)
  await session.load()
  const action = button(session.updateState({ to: BUYER }), "transferComponent")
  await session.setAccount({ address: BUYER })
  await assert.rejects(() => session.dispatchAction(action), staleAction)
  assert.equal(fixture.reads.filter(call => call.functionName === "tokenReference").length, 0, "stale owner intent must fail before resolving target")
})

test("receipt refresh shows the new owner and prevents former owner from replaying handover", async () => {
  requireRoute("transferComponent")
  const fixture = ownerWorkflowSessionOptions()
  const session = createCamViewerSession(fixture.options)
  await session.load()
  const action = button(session.updateState({ to: BUYER }), "transferComponent")
  const result = await session.dispatchAction(action)
  assert.equal(result.type, "contractCall")
  // The host owns wallet submission/receipt handling. Only after a successful
  // receipt does its follow-up route reload the real projection.
  fixture.confirmTransfer()
  const refreshed = await session.refresh()
  assert.equal((refreshed.values[0] as { owner?: unknown }).owner, BUYER)
  const resolutions = fixture.reads.filter(call => call.functionName === "tokenReference").length
  await assert.rejects(() => session.dispatchAction(action), staleAction)
  assert.equal(fixture.reads.filter(call => call.functionName === "tokenReference").length, resolutions)
  await session.setAccount({ address: BUYER })
  assert.notEqual(button(await session.refresh(), "transferComponent").disabled, true)
})

test("pause refresh invalidates a previously available handover action", async () => {
  requireRoute("transferComponent")
  const fixture = ownerWorkflowSessionOptions()
  const session = createCamViewerSession(fixture.options)
  await session.load()
  const action = button(session.updateState({ to: BUYER }), "transferComponent")
  fixture.pauseRecordToken()
  await session.refresh()
  await assert.rejects(() => session.dispatchAction(action), staleAction)
  assert.equal(fixture.reads.filter(call => call.functionName === "tokenReference").length, 0)
})
