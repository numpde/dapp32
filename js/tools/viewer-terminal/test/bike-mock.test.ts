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

test("bike mock backend keeps lifecycle controls visible and disables unavailable actions", async () => {
  for (const [status, enabledActions] of [
    ["active", ["component", "updateComponentMetadata", "markComponentMissing", "retireComponent"]],
    ["missing", ["component", "updateComponentMetadata", "clearComponentMissing"]],
    ["retired", ["component"]],
  ] as const) {
    const component = await loadBikeMockComponent(status)
    const buttons = resolvedUiButtons(component.resolvedUi)
    assert.deepEqual(buttons.map((button) => button.call.function), [
      "component",
      "updateComponentMetadata",
      "markComponentMissing",
      "clearComponentMissing",
      "retireComponent",
    ], status)
    assert.deepEqual(
      buttons.filter((button) => !button.disabled).map((button) => button.call.function),
      enabledActions,
      status,
    )
    assert.equal(Object.hasOwn(component.state, "reportURI"), true, status)
    assert.equal(Object.hasOwn(component.state, "resolutionURI"), true, status)
  }
})

test("bike mock backend env selects active by default and validates explicit statuses", async () => {
  const active = await createTerminalBackendFromEnv({
    CAM_VIEWER_BACKEND: "mock",
    CAM_VIEWER_MOCK: "bike-nft",
    CAM_VIEWER_INITIAL_INPUTS_JSON: "{}",
  })
  assert.equal(active.description, "offline bike NFT fixture (active component)")

  const retired = await createTerminalBackendFromEnv({
    CAM_VIEWER_BACKEND: "mock",
    CAM_VIEWER_MOCK: "bike-nft",
    CAM_VIEWER_INITIAL_INPUTS_JSON: "{}",
    CAM_VIEWER_BIKE_MOCK_COMPONENT_STATUS: "retired",
  })
  assert.equal(retired.description, "offline bike NFT fixture (retired component)")

  await assert.rejects(
    () => createTerminalBackendFromEnv({
      CAM_VIEWER_BACKEND: "mock",
      CAM_VIEWER_MOCK: "bike-nft",
      CAM_VIEWER_INITIAL_INPUTS_JSON: "{}",
      CAM_VIEWER_BIKE_MOCK_COMPONENT_STATUS: "stolen",
    }),
    /CAM_VIEWER_BIKE_MOCK_COMPONENT_STATUS must be active, missing, or retired: stolen/,
  )
})

async function loadBikeMockComponent(status: "active" | "missing" | "retired") {
  const backend = createBikeMockBackend({
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
