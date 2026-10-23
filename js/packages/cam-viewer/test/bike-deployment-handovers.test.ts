import assert from "node:assert/strict"
import test from "node:test"
import { resolvedUiButtons } from "@cam/screen"
import { createCamViewerSession } from "../src/index.ts"
import { BIKE_ACCOUNT_ADDRESS, BIKE_HOST_ADDRESS, BIKE_COMPONENTS_ADDRESS, BIKE_MANAGER_ADDRESS } from "../../../../tests/fixtures/cam/bike.mts"
import { ownerWorkflowSessionOptions, CURRENT_COLLECTION, OTHER_WORKSHOP } from "../../../../tests/fixtures/cam/bike-owner-workflows.mts"

test("acceptances use authoritative destinations after rebinding, not the session's cached namespace addresses", async () => {
  const fixture = ownerWorkflowSessionOptions()
  let components = BIKE_COMPONENTS_ADDRESS
  const actions = ["acceptCamOwnership", "acceptComponentsAdmin", "acceptManagerAdmin"]
  const publicClient = {
    ...fixture.options.publicClient,
    async readContract(request: Parameters<typeof fixture.options.publicClient.readContract>[0]): Promise<unknown> {
      if (request.functionName === "contractAddress" && request.args?.[0] === "ICamRootOwnership") return OTHER_WORKSHOP
      if (request.functionName === "viewDeploymentHandovers") {
        assert.deepEqual(request.args, [BIKE_HOST_ADDRESS, BIKE_ACCOUNT_ADDRESS])
        const authority = (target: string) => ({ target, current: OTHER_WORKSHOP, pending: BIKE_ACCOUNT_ADDRESS,
          readyAt: 1000n, status: "Ready to accept", canAccept: true })
        return { cam: authority(BIKE_HOST_ADDRESS), components: authority(components), manager: authority(BIKE_MANAGER_ADDRESS), actions }
      }
      if (request.functionName === "deploymentTargets") {
        assert.deepEqual(request.args, [BIKE_HOST_ADDRESS])
        return [BIKE_HOST_ADDRESS, components, BIKE_MANAGER_ADDRESS]
      }
      return fixture.options.publicClient.readContract(request)
    },
  }
  const session = createCamViewerSession({ ...fixture.options, publicClient, route: "deploymentHandovers", inputs: {} })
  await session.load()
  components = CURRENT_COLLECTION
  await session.refresh()
  for (const [route, target, method] of [
    ["acceptCamOwnership", BIKE_HOST_ADDRESS, "acceptOwnership"],
    ["acceptComponentsAdmin", CURRENT_COLLECTION, "acceptDefaultAdminTransfer"],
    ["acceptManagerAdmin", BIKE_MANAGER_ADDRESS, "acceptDefaultAdminTransfer"],
  ]) {
    const snapshot = session.snapshot()
    assert.ok(snapshot.resolvedUi)
    const button = resolvedUiButtons(snapshot.resolvedUi).find(button => button.call.function === route)
    assert.ok(button)
    const result = await session.dispatchAction(button)
    assert.equal(result.type, "contractCall")
    if (result.type !== "contractCall") assert.fail("acceptance must prepare a direct wallet transaction")
    assert.equal(result.call.address, target)
    assert.equal(result.call.function, method)
    assert.equal(Object.keys(result.call.args).length, 0)
    assert.equal(result.call.then.function, "deploymentHandovers")
  }
})
