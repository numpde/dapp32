import assert from "node:assert/strict"
import test from "node:test"
import { parseJsonBytes, toInertValue } from "@cam/protocol"
import { parseUi, resolveInitialUiNode, resolvedUiButtons } from "../src/index.ts"
import { bikeUiBytes } from "../../../../tests/fixtures/cam/bike-resources.mts"
import { BIKE_ACCOUNT_ADDRESS, BIKE_HOST_ADDRESS, bikeHost } from "../../../../tests/fixtures/cam/bike.mts"

test("deployment acceptances stay visible and follow the contract's independent action list", () => {
  const authority = { target: BIKE_HOST_ADDRESS, current: BIKE_HOST_ADDRESS, pending: BIKE_ACCOUNT_ADDRESS,
    readyAt: "2000000000", status: "Waiting for acceptance time", canAccept: false }
  for (const actions of [[], ["acceptCamOwnership"], ["acceptComponentsAdmin", "acceptManagerAdmin"]]) {
    const view = toInertValue({ screen: "deploymentHandovers", task: {
      paused: false, componentTokenPaused: false, cam: authority, components: authority, manager: authority, actions,
    } })
    const screen = resolveInitialUiNode(parseUi(parseJsonBytes(bikeUiBytes)), "app", { view }, {
      host: bikeHost, account: { address: BIKE_ACCOUNT_ADDRESS }, inputs: {}, outputs: [], state: {},
    })
    const buttons = resolvedUiButtons(screen.resolvedUi)
    for (const route of ["acceptCamOwnership", "acceptComponentsAdmin", "acceptManagerAdmin"]) {
      const button = buttons.find(button => button.call.function === route)
      assert.ok(button, `${route} remains visible`)
      assert.equal(button.disabled === true, !actions.includes(route))
      assert.equal(Object.keys(button.call.args).length, 0)
    }
    assert.ok(buttons.some(button => button.call.function === "deploymentHandovers"), "refresh chain state without sending")
    assert.ok(buttons.some(button => button.call.function === "entry"), "return to the registry")
  }
})
