import assert from "node:assert/strict"
import test from "node:test"

import { resolvedUiButtons } from "../../../packages/cam-screen/dist/index.js"

import {
  BIKE_ROUTE_COMPONENT,
  BIKE_SERIAL_NUMBER,
} from "../../../../tests/fixtures/cam/bike.mts"
import { createBikeMockBackend } from "../backends/bike-mock.ts"
import { createTerminalBackendFromEnv } from "../backends/index.ts"
import type { DebugEvent } from "../types.ts"

test("bike mock backend renders active and missing lifecycle branches explicitly", async () => {
  const active = await loadBikeMockComponent("active")
  const activeButtons = resolvedUiButtons(active.resolvedUi).map((button) => button.call.function)

  assert.deepEqual(activeButtons, [
    "component",
    "updateComponentMetadata",
    "markComponentMissing",
    "retireComponent",
  ])
  assert.equal(Object.hasOwn(active.state, "reportURI"), true)
  assert.equal(Object.hasOwn(active.state, "resolutionURI"), false)

  const missing = await loadBikeMockComponent("missing")
  const missingButtons = resolvedUiButtons(missing.resolvedUi).map((button) => button.call.function)

  assert.deepEqual(missingButtons, [
    "component",
    "updateComponentMetadata",
    "clearComponentMissing",
  ])
  assert.equal(Object.hasOwn(missing.state, "reportURI"), false)
  assert.equal(Object.hasOwn(missing.state, "resolutionURI"), true)

  const retired = await loadBikeMockComponent("retired")
  const retiredButtons = resolvedUiButtons(retired.resolvedUi).map((button) => button.call.function)

  assert.deepEqual(retiredButtons, ["component"])
  assert.equal(Object.hasOwn(retired.state, "reportURI"), false)
  assert.equal(Object.hasOwn(retired.state, "resolutionURI"), false)
})

test("bike mock backend env selects active by default and validates explicit statuses", async () => {
  const active = await createTerminalBackendFromEnv({
    CAM_VIEWER_BACKEND: "mock",
    CAM_VIEWER_MOCK: "bike-nft",
    CAM_VIEWER_ALLOW_UNSIGNED_CAM_HASH: "true",
    CAM_VIEWER_INITIAL_INPUTS_JSON: "{}",
  })
  assert.equal(active.description, "offline bike NFT fixture (active component)")

  const retired = await createTerminalBackendFromEnv({
    CAM_VIEWER_BACKEND: "mock",
    CAM_VIEWER_MOCK: "bike-nft",
    CAM_VIEWER_ALLOW_UNSIGNED_CAM_HASH: "true",
    CAM_VIEWER_INITIAL_INPUTS_JSON: "{}",
    CAM_VIEWER_BIKE_MOCK_COMPONENT_STATUS: "retired",
  })
  assert.equal(retired.description, "offline bike NFT fixture (retired component)")

  await assert.rejects(
    () => createTerminalBackendFromEnv({
      CAM_VIEWER_BACKEND: "mock",
      CAM_VIEWER_MOCK: "bike-nft",
      CAM_VIEWER_ALLOW_UNSIGNED_CAM_HASH: "true",
      CAM_VIEWER_INITIAL_INPUTS_JSON: "{}",
      CAM_VIEWER_BIKE_MOCK_COMPONENT_STATUS: "stolen",
    }),
    /CAM_VIEWER_BIKE_MOCK_COMPONENT_STATUS must be active, missing, or retired: stolen/,
  )
})

async function loadBikeMockComponent(status: "active" | "missing" | "retired") {
  const backend = createBikeMockBackend({
    allowUnsignedCamHash: true,
    componentStatus: status,
    initialInputs: {},
  })
  const events: DebugEvent[] = []
  const session = backend.createSession(events)
  await session.load()

  const snapshot = await session.navigate(BIKE_ROUTE_COMPONENT, {
    serialNumber: BIKE_SERIAL_NUMBER,
  })

  if (snapshot.resolvedUi === undefined || snapshot.state === undefined) {
    throw new Error("expected resolved mock component view")
  }

  return {
    resolvedUi: snapshot.resolvedUi,
    state: snapshot.state,
  }
}
