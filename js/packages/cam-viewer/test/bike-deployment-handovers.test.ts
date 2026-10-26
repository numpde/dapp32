import assert from "node:assert/strict"
import test from "node:test"
import { forEachResolvedUiNode, resolvedUiButtons } from "@cam/screen"
import type { CamViewerSnapshot } from "../src/index.ts"
import { createCamViewerSession } from "../src/index.ts"
import { BIKE_ACCOUNT_ADDRESS, BIKE_HOST_ADDRESS, BIKE_COMPONENTS_ADDRESS, BIKE_MANAGER_ADDRESS, BIKE_SERIAL_NUMBER, bikeEntryRouteResult, bikeRegisterRouteResult } from "../../../../tests/fixtures/cam/bike.mts"
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
        return { cam: authority(BIKE_HOST_ADDRESS), components: authority(components), manager: authority(BIKE_MANAGER_ADDRESS), actions, paused: false, componentTokenPaused: false }
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

function assertContractStatusNearTop(snapshot: CamViewerSnapshot, paused: boolean, tokenPaused: boolean): void {
  const root = snapshot.resolvedUi
  assert.ok(root)
  assert.ok("children" in root)
  const navigation = root.children[0]
  const status = root.children[1]
  assert.ok(navigation?.element === "Screen" && navigation.props.title === "App navigation")
  assert.ok(status?.element === "Screen" && status.props.title === "Contract status", "contract status must precede task content")
  assert.deepEqual(status.children.map(node => node.element === "Status" ? [node.props.label, node.props.value] : undefined), [
    ["Registry paused", paused], ["Component token paused", tokenPaused],
  ])
  let headers = 0
  forEachResolvedUiNode(root, node => { if (node.element === "Screen" && node.props.title === "Contract status") headers++ })
  assert.equal(headers, 1, "each destination shows contract status exactly once")
}

test("every Bike destination shows fresh, independent pause facts before its task", async () => {
  const fixture = ownerWorkflowSessionOptions()
  let paused = false
  let tokenPaused = true
  let projections = 0
  const publicClient = {
    ...fixture.options.publicClient,
    async readContract(request: Parameters<typeof fixture.options.publicClient.readContract>[0]): Promise<unknown> {
      if (request.functionName === "viewDeploymentHandovers") {
        projections++
        const authority = (target: string) => ({ target, current: BIKE_ACCOUNT_ADDRESS, pending: OTHER_WORKSHOP, readyAt: 0n, status: "No transfer pending", canAccept: false })
        return { cam: authority(BIKE_HOST_ADDRESS), components: authority(BIKE_COMPONENTS_ADDRESS), manager: authority(BIKE_MANAGER_ADDRESS), actions: [], paused, componentTokenPaused: tokenPaused }
      }
      if (request.functionName === "viewEntry" || request.functionName === "viewRegister") {
        projections++
        return { ...(request.functionName === "viewEntry" ? bikeEntryRouteResult(BIKE_ACCOUNT_ADDRESS) : bikeRegisterRouteResult(BIKE_SERIAL_NUMBER, BIKE_ACCOUNT_ADDRESS)), paused, componentTokenPaused: tokenPaused }
      }
      const value = await fixture.options.publicClient.readContract(request)
      if (request.functionName === "viewComponent" || request.functionName === "viewDelegation") {
        projections++
        assert.ok(typeof value === "object" && value !== null)
        return { ...value, paused, componentTokenPaused: tokenPaused }
      }
      return value
    },
  }
  const destinations: readonly [string, Record<string, string>][] = [
    ["entry", {}], ["component", { serialNumber: BIKE_SERIAL_NUMBER }], ["register", { serialNumber: BIKE_SERIAL_NUMBER }],
    ["delegation", { serialNumber: BIKE_SERIAL_NUMBER, delegate: OTHER_WORKSHOP, duration: "3600" }], ["deploymentHandovers", {}],
  ]
  for (const [route, inputs] of destinations) {
    paused = false; tokenPaused = true
    const session = createCamViewerSession({ ...fixture.options, publicClient, route, inputs })
    const before = projections
    await session.load()
    assertContractStatusNearTop(session.snapshot(), paused, tokenPaused)
    paused = true; tokenPaused = false
    await session.refresh()
    assertContractStatusNearTop(session.snapshot(), paused, tokenPaused)
    assert.equal(projections - before, 2, "rendering pause facts adds no extra contract projection reads")
  }
})
