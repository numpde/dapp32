import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { CAM_RESOURCE_MAX_BYTES, CAM_VERSION, InertValueError, toInertValue, UI_VERSION, type InertRecord, type InertValue } from "@cam/protocol"
import { CamEvmError } from "@cam/evm-viem"
import { forEachResolvedUiNode, resolvedUiButtons, UiError, type ResolvedAmountFieldNode, type ResolvedNonNegativeIntegerFieldNode, type ResolvedUiNode } from "@cam/screen"

import {
  createCamViewerSession,
} from "../src/index.ts"
import { CamViewerError } from "../src/errors.ts"
import type {
  CamHost,
  CamPublicClient,
} from "@cam/evm-viem"
import type { CamViewerLoadedSnapshot, CreateCamViewerSessionOptions } from "../src/index.ts"
import type { Address, Hex } from "viem"
import {
  BIKE_ACCOUNT_ADDRESS as userAddress,
  BIKE_CAM_URI as camURI,
  BIKE_PROTOCOL_URI,
  BIKE_MARK_MISSING,
  BIKE_MANAGER_ABI_URI,
  BIKE_MANAGER_ADDRESS as managerAddress,
  BIKE_MISSING_REPORT_URI,
  BIKE_ROUTE_COMPONENT,
  BIKE_ROUTE_ENTRY,
  BIKE_SERIAL_HASH,
  BIKE_SERIAL_NUMBER,
  BIKE_TOKEN_ID,
  BIKE_UNKNOWN_SERIAL_HASH,
  BIKE_UNKNOWN_SERIAL_NUMBER,
  BIKE_UNKNOWN_TOKEN_ID,
  BIKE_UI_ABI_URI,
  BIKE_UI_NAMESPACE,
  BIKE_UI_URI,
  BIKE_VIEW_COMPONENT,
  BIKE_VIEW_ENTRY,
  BIKE_VIEW_REGISTER,
  BIKE_ZERO_ADDRESS,
  BIKE_ZERO_BYTES32,
  bikeComponentRouteResult,
  bikeContractAddresses,
  bikeEntryRouteResult,
  bikeHost,
  bikeRegisterRouteResult,
  bikeRouteResults,
} from "../../../../tests/fixtures/cam/bike.mts"
import { bikeManagerAbi } from "../../../../tests/fixtures/cam/bike-resources.mts"
import {
  bikeResourceBytes,
  createMockCamPublicClient,
  createMockResourceLoader as createResourceLoader,
  encodeJson,
} from "../../../../tests/fixtures/cam/mock.mts"

const host: CamHost = bikeHost
const otherUserAddress = "0x0000000000000000000000000000000000000099"
const registeredOwnerAddress = "0x0000000000000000000000000000000000000200"
const BIKE_REPORT_URI = "fixture://bike-nft/reports/session-missing.json"
const BIKE_RESOLUTION_URI = "fixture://bike-nft/reports/session-recovered.json"
const BIKE_ACCOUNT_INFO_URI = "fixture://bike-nft/accounts/session-owner.json"
const BIKE_REGISTRATION_TOKEN_URI = "fixture://bike-nft/tokens/session-registration.json"
const NO_RESOURCE_OVERRIDES = {}

test("bike availability keeps component writes and their fields visible across authority and lifecycle changes", async () => {
  for (const scenario of [
    { name: "active owner", status: "active", account: userAddress },
    { name: "missing owner", status: "missing", account: userAddress },
    { name: "retired owner", status: "retired", account: userAddress },
    { name: "other account", status: "active", account: otherUserAddress },
    { name: "manager paused", status: "active", account: userAddress, paused: true },
    { name: "token paused", status: "active", account: userAddress, tokenPaused: true },
  ] as const) {
    const projection = bikeComponentRouteResult(BIKE_SERIAL_NUMBER, scenario.account, scenario.status)
    if ("paused" in scenario) Object.assign(projection, { paused: true, actions: ["lookupComponent"] })
    if ("tokenPaused" in scenario) Object.assign(projection, {
      componentTokenPaused: true, actions: ["lookupComponent", "markComponentMissing", "retireComponent"],
    })
    const routeResults = { ...bikeRouteResults(BIKE_SERIAL_NUMBER, scenario.account, scenario.status), [BIKE_VIEW_COMPONENT]: projection }
    const session = createSession(sessionFixtureOptions({ publicClient: createPublicClient(publicClientFixtureOptions({ routeResults })) }))
    await session.load()
    if (scenario.account !== userAddress) await session.setAccount({ address: scenario.account })
    const snapshot = await session.navigate("component", { serialNumber: BIKE_SERIAL_NUMBER })
    const actions = projection.actions as string[]
    const buttons = resolvedUiButtons(snapshot.resolvedUi)
    for (const action of ["updateComponentMetadata", "markComponentMissing", "clearComponentMissing", "retireComponent"]) {
      const button = buttons.find(node => node.call.function === action)
      assert.ok(button, `${scenario.name}: ${action} must remain visible`)
      assert.equal(button.disabled === true, !actions.includes(action), `${scenario.name}: ${action} availability`)
      if (button.disabled === true) await assert.rejects(() => session.dispatchAction(button))
    }
    for (const [field, action] of [["tokenURI", "updateComponentMetadata"], ["reportURI", "markComponentMissing"], ["resolutionURI", "clearComponentMissing"]]) {
      let input: Extract<ResolvedUiNode, { element: "TextField" }> | undefined
      forEachResolvedUiNode(snapshot.resolvedUi, node => {
        if (node.element === "TextField" && node.state.key === field) input = node
      })
      assert.ok(input, `${scenario.name}: ${field} must remain visible`)
      assert.equal(input.disabled === true, !actions.includes(action), `${scenario.name}: ${field} availability`)
    }
  }
})

test("bike availability keeps registration inputs and preparation visible when registration is unavailable", async () => {
  for (const scenario of [
    { name: "new serial registrar", serial: BIKE_UNKNOWN_SERIAL_NUMBER, account: userAddress },
    { name: "empty serial", serial: "", account: userAddress },
    { name: "existing serial", serial: BIKE_SERIAL_NUMBER, account: userAddress },
    { name: "other account", serial: BIKE_UNKNOWN_SERIAL_NUMBER, account: otherUserAddress },
    { name: "manager paused", serial: BIKE_UNKNOWN_SERIAL_NUMBER, account: userAddress, paused: true },
    { name: "token paused", serial: BIKE_UNKNOWN_SERIAL_NUMBER, account: userAddress, tokenPaused: true },
  ] as const) {
    const projection = bikeRegisterRouteResult(scenario.serial, scenario.account)
    if ("paused" in scenario) Object.assign(projection, { paused: true, actions: ["lookupComponent"] })
    if ("tokenPaused" in scenario) Object.assign(projection, { componentTokenPaused: true, actions: ["lookupComponent"] })
    const routeResults = { ...bikeRouteResults(BIKE_SERIAL_NUMBER, scenario.account, "active"), [BIKE_VIEW_REGISTER]: projection }
    const session = createSession(sessionFixtureOptions({ publicClient: createPublicClient(publicClientFixtureOptions({ routeResults })) }))
    await session.load()
    if (scenario.account !== userAddress) await session.setAccount({ address: scenario.account })
    const snapshot = await session.navigate("register", { serialNumber: scenario.serial })
    const enabled = (projection.actions as string[]).includes("registerComponent")
    const button = resolvedUiButtons(snapshot.resolvedUi).find(node => node.call.function === "registerComponent")
    assert.ok(button, `${scenario.name}: registration preparation must remain visible`)
    assert.equal(button.disabled === true, !enabled, scenario.name)
    for (const field of ["owner", "tokenURI"]) {
      let input: Extract<ResolvedUiNode, { element: "TextField" }> | undefined
      forEachResolvedUiNode(snapshot.resolvedUi, node => {
        if (node.element === "TextField" && node.state.key === field) input = node
      })
      assert.ok(input, `${scenario.name}: ${field} must remain visible`)
      assert.equal(input.disabled === true, !enabled, `${scenario.name}: ${field} availability`)
    }
  }
})

test("bike availability keeps entry account editing visible and matches the projected action grant", async () => {
  for (const scenario of [
    { name: "registrar", account: userAddress },
    { name: "other account", account: otherUserAddress },
    { name: "no account", account: BIKE_ZERO_ADDRESS },
    { name: "manager paused", account: userAddress, paused: true },
  ] as const) {
    const projection = bikeEntryRouteResult(scenario.account)
    if ("paused" in scenario) Object.assign(projection, { paused: true, actions: ["lookupComponent"] })
    const routeResults = { ...bikeRouteResults(BIKE_SERIAL_NUMBER, scenario.account, "active"), [BIKE_VIEW_ENTRY]: projection }
    const session = createSession(sessionFixtureOptions({ publicClient: createPublicClient(publicClientFixtureOptions({ routeResults })) }))
    await session.load()
    const snapshot = await session.setAccount({ address: scenario.account })
    const actions = projection.actions as string[]
    const buttons = resolvedUiButtons(snapshot.resolvedUi)
    for (const [action, route] of [["lookupComponent", "component"], ["openRegister", "register"], ["setAccountInfo", "setAccountInfo"]]) {
      const button = buttons.find(node => node.call.function === route)
      assert.ok(button, `${scenario.name}: ${action} must remain visible`)
      assert.equal(button.disabled === true, !actions.includes(action), `${scenario.name}: ${action} availability`)
    }
    let accountInfo: Extract<ResolvedUiNode, { element: "TextField" }> | undefined
    forEachResolvedUiNode(snapshot.resolvedUi, node => {
      if (node.element === "TextField" && node.state.key === "accountInfo") accountInfo = node
    })
    assert.ok(accountInfo)
    assert.equal(accountInfo.disabled === true, !actions.includes("setAccountInfo"), scenario.name)
  }
})

test("bike availability keeps the loaded write target visible when the lookup draft changes", async () => {
  const session = createSession(sessionFixtureOptions({}))
  await session.load()
  await session.navigate("component", { serialNumber: BIKE_SERIAL_NUMBER })
  const snapshot = session.updateState({ serialNumber: BIKE_UNKNOWN_SERIAL_NUMBER, tokenURI: BIKE_REGISTRATION_TOKEN_URI })
  let loadedSerialVisible = false
  forEachResolvedUiNode(snapshot.resolvedUi, node => {
    if (node.element === "Status" && node.props.value === BIKE_SERIAL_NUMBER) loadedSerialVisible = true
  })
  assert.equal(loadedSerialVisible, true, "the loaded component serial remains visible while another serial is entered for lookup")
  const button = resolvedUiButtons(snapshot.resolvedUi).find(node => node.call.function === "updateComponentMetadata")
  assert.ok(button)
  const prepared = await session.dispatchAction(button)
  assert.equal(prepared.type, "contractCall")
  if (prepared.type !== "contractCall") assert.fail("Expected metadata preparation")
  assert.deepEqual(prepared.call.args, toInertValue({ serialNumber: BIKE_SERIAL_NUMBER, tokenURI_: BIKE_REGISTRATION_TOKEN_URI }))
})

test("bike fixture covers unpaused fixture projection cases", () => {
  assertBikeProjection(bikeComponentRouteResult("", userAddress, "active"), {
    viewId: "component.empty",
    actions: ["lookupComponent", "openRegister"],
  })
  assertBikeProjection(bikeComponentRouteResult("", otherUserAddress, "active"), {
    viewId: "component.empty",
    actions: ["lookupComponent"],
    canRegister: false,
  })
  assertBikeProjection(bikeComponentRouteResult("", BIKE_ZERO_ADDRESS, "active"), {
    viewId: "component.empty",
    actions: ["lookupComponent"],
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_UNKNOWN_SERIAL_NUMBER, userAddress, "active"), {
    viewId: "component.notFound",
    actions: ["lookupComponent", "openRegister"],
    serialHash: BIKE_UNKNOWN_SERIAL_HASH,
    tokenId: BIKE_UNKNOWN_TOKEN_ID,
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_UNKNOWN_SERIAL_NUMBER, otherUserAddress, "active"), {
    viewId: "component.notFound",
    actions: ["lookupComponent"],
    serialHash: BIKE_UNKNOWN_SERIAL_HASH,
    tokenId: BIKE_UNKNOWN_TOKEN_ID,
    canRegister: false,
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_UNKNOWN_SERIAL_NUMBER, BIKE_ZERO_ADDRESS, "active"), {
    viewId: "component.notFound",
    actions: ["lookupComponent"],
    serialHash: BIKE_UNKNOWN_SERIAL_HASH,
    tokenId: BIKE_UNKNOWN_TOKEN_ID,
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_SERIAL_NUMBER, userAddress, "active"), {
    viewId: "component.active",
    actions: ["lookupComponent", "updateComponentMetadata", "markComponentMissing", "retireComponent"],
    serialHash: BIKE_SERIAL_HASH,
    tokenId: BIKE_TOKEN_ID,
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_SERIAL_NUMBER, userAddress, "missing"), {
    viewId: "component.missing",
    actions: ["lookupComponent", "updateComponentMetadata", "clearComponentMissing"],
    statusId: "missing",
    missingReportURI: BIKE_MISSING_REPORT_URI,
    canMarkMissing: false,
    canClearMissing: true,
    canRetire: false,
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_SERIAL_NUMBER, userAddress, "retired"), {
    viewId: "component.retired",
    actions: ["lookupComponent"],
    statusId: "retired",
    canUpdateMetadata: false,
    canMarkMissing: false,
    canClearMissing: false,
    canRetire: false,
  })
  assertBikeProjection(bikeComponentRouteResult(BIKE_SERIAL_NUMBER, otherUserAddress, "active"), {
    viewId: "component.active",
    actions: ["lookupComponent"],
    permissions: 0n,
    isOwner: false,
    canUpdateMetadata: false,
    canMarkMissing: false,
    canRetire: false,
  })

  assertBikeProjection(bikeEntryRouteResult(BIKE_ZERO_ADDRESS), {
    viewId: "entry",
    actions: ["lookupComponent"],
    canRegister: false,
  })
  assertBikeProjection(bikeEntryRouteResult(userAddress), {
    viewId: "entry",
    actions: ["lookupComponent", "openRegister", "setAccountInfo"],
    account: userAddress,
    canRegister: true,
  })
  assertBikeProjection(bikeEntryRouteResult(otherUserAddress), {
    viewId: "entry",
    actions: ["lookupComponent", "setAccountInfo"],
    account: otherUserAddress,
    canRegister: false,
  })

  assertBikeProjection(bikeRegisterRouteResult("", userAddress), {
    viewId: "register.empty",
    actions: ["lookupComponent", "openRegister"],
  })
  assertBikeProjection(bikeRegisterRouteResult("", otherUserAddress), {
    viewId: "register.empty",
    actions: ["lookupComponent"],
    canRegister: false,
  })
  assertBikeProjection(bikeRegisterRouteResult("", BIKE_ZERO_ADDRESS), {
    viewId: "register.empty",
    actions: ["lookupComponent"],
  })
  assertBikeProjection(bikeRegisterRouteResult(BIKE_UNKNOWN_SERIAL_NUMBER, userAddress), {
    viewId: "register.ready",
    actions: ["registerComponent", "lookupComponent"],
    serialHash: BIKE_UNKNOWN_SERIAL_HASH,
    tokenId: BIKE_UNKNOWN_TOKEN_ID,
  })
  assertBikeProjection(bikeRegisterRouteResult(BIKE_SERIAL_NUMBER, userAddress), {
    viewId: "register.blocked",
    actions: ["lookupComponent"],
    serialHash: BIKE_SERIAL_HASH,
    tokenId: BIKE_TOKEN_ID,
  })
})

for (const protocolCase of ["valid", "tampered", "missing", "oversized"] as const) {
  test(`CAM 1.2 verifies the ${protocolCase} protocol resource before bindings, ABIs and UI`, async () => {
    const resources = bikeResourceBytes(NO_RESOURCE_OVERRIDES)
    assert.equal(JSON.parse(new TextDecoder().decode(resources[camURI])).cam, "1.2.0")
    const fixtureClient = createPublicClient(publicClientFixtureOptions({}))
    const requests: string[] = []
    const publicClient: CamPublicClient = {
      ...fixtureClient,
      async readContract(request) {
        requests.push(request.functionName)
        return fixtureClient.readContract(request)
      },
    }
    const session = createCamViewerSession({
      publicClient, host, account: { address: userAddress }, inputs: {},
      async loadResource(uri) {
        requests.push(uri)
        if (uri === BIKE_PROTOCOL_URI) {
          if (protocolCase === "tampered") return new TextEncoder().encode("tampered protocol bytes")
          if (protocolCase === "missing") throw new Error("protocol resource unavailable")
          if (protocolCase === "oversized") return new Uint8Array(CAM_RESOURCE_MAX_BYTES + 1)
        }
        const bytes = resources[uri]
        assert.ok(bytes, `unexpected resource request: ${uri}`)
        return bytes
      },
    })
    const discoveryRequests = ["supportsInterface", "camManifest", camURI, BIKE_PROTOCOL_URI]
    if (protocolCase === "valid") {
      assert.equal((await session.load()).route, BIKE_ROUTE_ENTRY)
      assert.deepEqual(requests.slice(0, discoveryRequests.length), discoveryRequests)
      for (const request of ["contractAddress", BIKE_UI_ABI_URI, BIKE_MANAGER_ABI_URI, BIKE_UI_URI]) {
        assert.ok(requests.indexOf(request) >= discoveryRequests.length, `${request} must follow verified protocol loading`)
      }
    } else {
      await assert.rejects(() => session.load(), (error) => error instanceof CamEvmError
        && error.code === (protocolCase === "tampered" ? "CAM_RESOURCE_INTEGRITY_MISMATCH" : "CAM_RESOURCE_LOAD_FAILED"))
      assert.deepEqual(requests, discoveryRequests)
    }
  })
}

test("load resolves host CAM, entry route, UI resource, and entry view", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({ publicClient }))

  const snapshot = await session.load()

  assert.equal(snapshot.route, BIKE_ROUTE_ENTRY)
  assert.equal(snapshot.resolvedUi.element, "Screen")
  assert.equal(snapshot.resolvedUi.children[0]?.element, "Status")
  assert.equal(snapshot.resolvedUi.children[0]?.props.label, "Registry paused")
  assert.equal(snapshot.resolvedUi.children[0]?.props.value, false)
  assert.ok(snapshot.resolvedUi.children.some(node => node.element === "Fragment"))
  assert.deepEqual(snapshot.values, toInertValue([
    {
      viewId: "entry",
      actions: ["lookupComponent", "openRegister", "setAccountInfo"],
      account: userAddress,
      paused: false,
      canRegister: true,
      accountInfo: "Mock registrar account",
      serialNumber: "",
      exists: false,
      serialHash: BIKE_ZERO_BYTES32,
      tokenContract: BIKE_ZERO_ADDRESS,
      tokenId: "0",
      owner: BIKE_ZERO_ADDRESS,
      ownerInfo: "",
      registrar: BIKE_ZERO_ADDRESS,
      statusId: "none",
      tokenURI: "",
      missingReportURI: "",
      registeredAt: "0",
      updatedAt: "0",
      permissions: "0",
      isOwner: false,
      authorityId: "none",
      delegationGrantor: BIKE_ZERO_ADDRESS,
      delegationCapabilities: "0",
      delegationValidUntil: "0",
      delegationActive: false,
      componentTokenPaused: false,
      canUpdateMetadata: false,
      canMarkMissing: false,
      canClearMissing: false,
      canRetire: false,
      componentsAddress: BIKE_ZERO_ADDRESS,
    },
  ]))
  assert.deepEqual(publicClient.calls.map((call) => call.functionName), [
    "supportsInterface",
    "camManifest",
    "contractAddress",
    "contractAddress",
    BIKE_VIEW_ENTRY,
  ])
})

test("Back restores edited inputs across visits while refreshing read results; new navigation starts fresh", async () => {
  const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active")
  const publicClient = createPublicClient(publicClientFixtureOptions({ routeResults }))
  const session = createSession(sessionFixtureOptions({ publicClient }))
  assert.equal((await session.load()).canGoBack, false)
  const draft = session.updateState({ serialNumber: "unfinished serial", accountInfo: "unfinished info" })
  await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  await session.navigate(BIKE_ROUTE_ENTRY, {})
  await session.back()
  routeResults[BIKE_VIEW_ENTRY] = { ...bikeEntryRouteResult(userAddress), accountInfo: "fresh chain info" }
  mutableRecord(draft.state).serialNumber = "external mutation"
  const restored = await session.back()
  assert.equal(restored.state.serialNumber, "unfinished serial")
  assert.equal(restored.state.accountInfo, "unfinished info")
  assert.equal(mutableRecord(restored.values[0]).accountInfo, "fresh chain info")
  assert.equal(restored.canGoBack, false)
  assert.equal(publicClient.calls.at(-1)?.functionName, BIKE_VIEW_ENTRY)
  const fresh = await session.navigate(BIKE_ROUTE_ENTRY, {})
  assert.equal(fresh.state.serialNumber, "")
  assert.equal(fresh.state.accountInfo, "fresh chain info")
})

test("Refresh re-reads the current route and keeps compatible drafts and Back history", async () => {
  const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active")
  const publicClient = createPublicClient(publicClientFixtureOptions({ routeResults }))
  const session = createSession(sessionFixtureOptions({ publicClient }))
  await session.load()
  await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  await session.navigate(BIKE_ROUTE_ENTRY, {})
  const before = session.updateState({ serialNumber: "unfinished serial", accountInfo: "unfinished info" })
  routeResults[BIKE_VIEW_ENTRY] = { ...bikeEntryRouteResult(userAddress), accountInfo: "fresh chain info" }
  const refreshed = await session.refresh()
  assert.equal(refreshed.route, BIKE_ROUTE_ENTRY)
  assert.deepEqual(refreshed.inputs, before.inputs)
  assert.equal(refreshed.account?.address, userAddress)
  assert.equal(refreshed.state.serialNumber, "unfinished serial")
  assert.equal(refreshed.state.accountInfo, "unfinished info")
  assert.equal(mutableRecord(refreshed.values[0]).accountInfo, "fresh chain info")
  assert.equal(refreshed.canGoBack, true)
  assert.equal(publicClient.calls.at(-1)?.functionName, BIKE_VIEW_ENTRY)
  assert.equal((await session.back()).route, BIKE_ROUTE_COMPONENT)
  assert.equal((await session.back()).canGoBack, false)
})

test("Back drops edits whose inputs are absent from the refreshed view", async () => {
  const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active")
  routeResults[BIKE_VIEW_REGISTER] = bikeRegisterRouteResult(BIKE_UNKNOWN_SERIAL_NUMBER, userAddress)
  const session = createSession(sessionFixtureOptions({
    publicClient: createPublicClient(publicClientFixtureOptions({ routeResults })),
  }))
  await session.load()
  await session.navigate("register", { serialNumber: BIKE_UNKNOWN_SERIAL_NUMBER })
  session.updateState({ owner: registeredOwnerAddress, tokenURI: BIKE_REGISTRATION_TOKEN_URI })
  await session.navigate(BIKE_ROUTE_ENTRY, {})
  routeResults[BIKE_VIEW_REGISTER] = { ...bikeRegisterRouteResult(BIKE_SERIAL_NUMBER, userAddress), viewId: "component.notFound" }
  const restored = await session.back()
  assert.equal(Object.hasOwn(restored.state, "owner"), false)
  assert.equal(Object.hasOwn(restored.state, "tokenURI"), false)
})

for (const operation of ["Back", "Refresh"] as const) test(`${operation} preserves visible drafts while refreshed contract availability disables and re-enables their controls`, async () => {
  const resources = bikeResourceBytes(NO_RESOURCE_OVERRIDES)
  const ui = mutableRecord(JSON.parse(new TextDecoder().decode(resources[BIKE_UI_URI])))
  const nodes = mutableRecord(ui.nodes)
  const entryChildren = mutableRecord(nodes.entry).children as Record<string, unknown>[]
  const serialField = entryChildren.find((child) => child.element === "TextField"
    && mutableRecord(child.state).key === "serialNumber")
  assert.ok(serialField)
  const membership = { member: "lookupComponent", in: "$view.actions" }
  serialField.enabledWhen = membership
  mutableRecord(nodes.lookupComponent).enabledWhen = membership
  const uiBytes = encodeJson(ui)
  const cam = mutableRecord(JSON.parse(new TextDecoder().decode(resources[camURI])))
  mutableRecord(mutableRecord(cam.namespaces).ui).integrity = sha256Integrity(uiBytes)
  const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active")
  const session = createSession(sessionFixtureOptions({
    publicClient: createPublicClient(publicClientFixtureOptions({ routeResults, camHash: fixtureDigest(encodeJson(cam)) })),
    loadResource: createResourceLoader(bikeResourceBytes({
      [camURI]: encodeJson(cam),
      [BIKE_UI_URI]: uiBytes,
    })),
  }))
  await session.load()
  session.updateState({ serialNumber: "unfinished draft" })

  for (const available of [false, true]) {
    if (operation === "Back") await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
    routeResults[BIKE_VIEW_ENTRY] = {
      ...bikeEntryRouteResult(userAddress),
      actions: available ? ["lookupComponent"] : [],
    }
    const restored = operation === "Back" ? await session.back() : await session.refresh()
    assert.equal(restored.state.serialNumber, "unfinished draft")
    let matchingControls = 0
    forEachResolvedUiNode(restored.resolvedUi, (node) => {
      if (node.element === "TextField" && node.state.key === "serialNumber") {
        matchingControls++
        assert.equal(node.disabled, !available)
      }
      if (node.element === "Button" && node.call.function === BIKE_ROUTE_COMPONENT) {
        matchingControls++
        assert.equal(node.disabled, !available)
        assert.equal(node.call.args.serialNumber, "unfinished draft")
      }
    })
    assert.equal(matchingControls, 2)
    if (!available) {
      assert.throws(() => session.updateState({ serialNumber: "unavailable edit" }), /disabled/)
      assert.equal(session.snapshot().state?.serialNumber, "unfinished draft")
    }
  }
  assert.equal(session.updateState({ serialNumber: "continued draft" }).state.serialNumber, "continued draft")
})

test("successful account changes and loads clear history", async () => {
  const session = createSession(sessionFixtureOptions({}))
  await session.load()
  await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  assert.equal((await session.setAccount({ address: otherUserAddress })).canGoBack, false)
  await assert.rejects(() => session.back(), /no previous view/)
  await session.navigate(BIKE_ROUTE_ENTRY, {})
  assert.equal((await session.load()).canGoBack, false)
})

test("failed navigation, Back, Refresh, account changes and reloads preserve the view and history", async () => {
  let failReads = false
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({ publicClient: {
    ...publicClient,
    async readContract(request) {
      if (failReads) throw new Error("read unavailable")
      return await publicClient.readContract(request)
    },
  } }))
  await session.load()
  session.updateState({ serialNumber: "unfinished" })
  const before = await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  failReads = true
  for (const operation of [
    () => session.navigate(BIKE_ROUTE_ENTRY, {}),
    () => session.back(),
    () => session.refresh(),
    () => session.setAccount({ address: otherUserAddress }),
    () => session.load(),
  ]) {
    await assert.rejects(operation)
    assert.deepEqual(session.snapshot(), before)
  }
  failReads = false
  assert.equal((await session.back()).state.serialNumber, "unfinished")
})

test("invalid projected presentation preserves the current view, drafts and navigation history", async () => {
  const resources = bikeResourceBytes(NO_RESOURCE_OVERRIDES)
  const ui = mutableRecord(JSON.parse(new TextDecoder().decode(resources[BIKE_UI_URI])))
  const children = mutableRecord(mutableRecord(ui.nodes)["component.active"]).children as unknown[]
  children.push({ element: "Status", props: { label: "Declared size", value: "$view.statusId", format: "bytes" } })
  const uiBytes = encodeJson(ui)
  const cam = mutableRecord(JSON.parse(new TextDecoder().decode(resources[camURI])))
  mutableRecord(mutableRecord(cam.namespaces).ui).integrity = sha256Integrity(uiBytes)
  const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active")
  const session = createSession(sessionFixtureOptions({
    publicClient: createPublicClient(publicClientFixtureOptions({ routeResults, camHash: fixtureDigest(encodeJson(cam)) })),
    loadResource: createResourceLoader(bikeResourceBytes({
      [camURI]: encodeJson(cam),
      [BIKE_UI_URI]: uiBytes,
    })),
  }))
  await session.load()
  const before = session.updateState({ serialNumber: "unfinished draft" })
  await assert.rejects(() => session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER }),
    (error) => error instanceof UiError && error.code === "UI_INVALID_FIELD" && /non-negative.*integer/.test(error.message))
  assert.deepEqual(session.snapshot(), before)
  routeResults[BIKE_VIEW_COMPONENT] = { ...bikeComponentRouteResult(BIKE_SERIAL_NUMBER, userAddress, "active"), statusId: "64" }
  const opened = await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  let displayed: string | undefined
  forEachResolvedUiNode(opened.resolvedUi, (node) => {
    if (node.element === "Status" && node.props.label === "Declared size") displayed = node.formattedValue
  })
  assert.equal(displayed, "64 bytes")
  assert.equal((await session.back()).state.serialNumber, "unfinished draft")
  assert.equal(session.snapshot().canGoBack, false)
})

test("dynamic action destinations remain editable and are checked on dispatch", async () => {
  const resources = bikeResourceBytes(NO_RESOURCE_OVERRIDES)
  const ui = mutableRecord(JSON.parse(new TextDecoder().decode(resources[BIKE_UI_URI])))
  mutableRecord(ui.nodes).app = { requires: ["view"], element: "Screen", props: { title: "Actions" }, children: [
    { element: "TextField", props: { label: "Destination" }, state: { key: "destination", defaultValue: BIKE_ROUTE_ENTRY } },
    { element: "Button", props: { label: "Send immediately" }, call: { namespace: "routes", function: "$state.destination", args: {} } },
  ] }
  const bytes = encodeJson(ui)
  const cam = mutableRecord(JSON.parse(new TextDecoder().decode(resources[camURI])))
  mutableRecord(mutableRecord(cam.namespaces).ui).integrity = sha256Integrity(bytes)
  const publicClient = createPublicClient(publicClientFixtureOptions({ camHash: fixtureDigest(encodeJson(cam)) }))
  const session = createSession(sessionFixtureOptions({ publicClient, loadResource: createResourceLoader(bikeResourceBytes({ [camURI]: encodeJson(cam), [BIKE_UI_URI]: bytes })) }))
  const loaded = await session.load()
  const read = resolvedUiButtons(loaded.resolvedUi)[0]!
  assert.equal((await session.dispatchAction(read)).type, "navigated", "a read never prepares a transaction despite its label")
  const edited = session.updateState({ destination: "unfinished-route" })
  const unsupported = resolvedUiButtons(edited.resolvedUi)[0]!
  assert.equal(edited.state.destination, "unfinished-route")
  assert.equal(unsupported.disabled, undefined, "unknown actions remain visible and retain availability")
  await assert.rejects(() => session.dispatchAction(unsupported), (error: unknown) => error instanceof CamViewerError && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED")
  assert.deepEqual(session.snapshot(), edited)
})

test("write preparation rejects invalid ABI arguments before returning an actionable call", async (t) => {
  const cases: readonly { name: string; payment: InertRecord }[] = [
    { name: "unset amount", payment: { amount: null, recipients: [registeredOwnerAddress] } },
    { name: "fractional integer", payment: { amount: "1.25", recipients: [registeredOwnerAddress] } },
    { name: "uint256 overflow", payment: { amount: (2n ** 256n).toString(), recipients: [registeredOwnerAddress] } },
    { name: "negative unsigned integer", payment: { amount: "-1", recipients: [registeredOwnerAddress] } },
    { name: "missing nested amount", payment: { recipients: [registeredOwnerAddress] } },
    { name: "malformed nested array", payment: { amount: "1", recipients: registeredOwnerAddress } },
    { name: "invalid nested address", payment: { amount: "1", recipients: ["not-an-address"] } },
  ]
  for (const { name, payment } of cases) {
    await t.test(name, async () => {
      const { session, publicClient } = paymentPreparationSession(payment)
      const loaded = await session.load()
      const before = session.updateState({ amount: "unfinished draft" })
      const action = resolvedUiButtons(loaded.resolvedUi).find((button) => button.call.function === "payment")
      assert.ok(action)
      const readsBefore = publicClient.calls.length
      await assert.rejects(() => session.dispatchAction(action),
        (error: unknown) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT")
      assert.equal(publicClient.calls.length, readsBefore, "invalid preparation must not perform a contract read")
      assert.deepEqual(session.snapshot(), before, "invalid preparation must preserve the current view and draft")
    })
  }
})

test("write preparation rejects unusable transaction value before returning an actionable call", async (t) => {
  const payment = { amount: "1", recipients: [registeredOwnerAddress] }
  for (const { name, value, stateMutability } of [
    { name: "unset payable value", value: null, stateMutability: "payable" },
    { name: "fractional payable value", value: "0.1", stateMutability: "payable" },
    { name: "overflow payable value", value: (2n ** 256n).toString(), stateMutability: "payable" },
    { name: "value on a nonpayable function", value: "0", stateMutability: "nonpayable" },
  ] as const) {
    await t.test(name, async () => {
      const { session, publicClient } = paymentPreparationSession(payment, value, stateMutability)
      const before = await session.load()
      const action = resolvedUiButtons(before.resolvedUi).find((button) => button.call.function === "payment")
      assert.ok(action)
      const readsBefore = publicClient.calls.length
      await assert.rejects(() => session.dispatchAction(action),
        (error: unknown) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_VALUE")
      assert.equal(publicClient.calls.length, readsBefore)
      assert.deepEqual(session.snapshot(), before)
    })
  }
})

test("write preparation preserves exact valid integer arguments and payable values without effects", async () => {
  for (const amount of ["0", "9007199254740993", (2n ** 256n - 1n).toString()]) {
    const payment = { amount, recipients: [registeredOwnerAddress] }
    const { session, publicClient } = paymentPreparationSession(payment, amount, "payable")
    const before = await session.load()
    const action = resolvedUiButtons(before.resolvedUi).find((button) => button.call.function === "payment")
    assert.ok(action)
    const readsBefore = publicClient.calls.length
    const prepared = await session.dispatchAction(action)
    assert.equal(prepared.type, "contractCall")
    if (prepared.type !== "contractCall") assert.fail("expected a prepared write call")
    assert.deepEqual(prepared.call.args, toInertValue({ payment }))
    assert.equal(prepared.call.value, amount)
    assert.equal(publicClient.calls.length, readsBefore)
    assert.deepEqual(session.snapshot(), before)
  }
})

function paymentPreparationSession(
  payment: InertRecord,
  value?: InertValue,
  stateMutability?: "payable" | "nonpayable",
  input?: Record<string, unknown>,
) {
  const mutability = stateMutability === undefined ? "nonpayable" : stateMutability
  const field = input === undefined
    ? { element: "TextField", props: { label: "Raw amount" }, state: { key: "amount", defaultValue: "0" } }
    : input
  const resources = bikeResourceBytes(NO_RESOURCE_OVERRIDES)
  const abiBytes = encodeJson([...bikeManagerAbi, {
    type: "function", name: "testPayment", stateMutability: mutability,
    inputs: [{ name: "payment", type: "tuple", components: [
      { name: "amount", type: "uint256" }, { name: "recipients", type: "address[]" },
    ] }], outputs: [],
  }])
  const ui = mutableRecord(JSON.parse(new TextDecoder().decode(resources[BIKE_UI_URI])))
  mutableRecord(ui.nodes).app = {
    requires: ["view"], element: "Screen", props: { title: "Payment input" }, children: [
      field,
      { element: "Button", props: { label: "Prepare payment" }, call: { namespace: "routes", function: "payment", args: { payment } } },
    ],
  }
  const uiBytes = encodeJson(ui)
  const cam = mutableRecord(JSON.parse(new TextDecoder().decode(resources[camURI])))
  cam.cam = CAM_VERSION
  mutableRecord(cam.routes).payment = {
    kind: "write", inputs: ["payment"], ...(value === undefined ? {} : { value }), call: {
      namespace: "contracts.BicycleComponentManager", function: "testPayment", args: { payment: "$inputs.payment" },
    }, then: { namespace: "routes", function: BIKE_ROUTE_ENTRY, args: {} },
  }
  const namespaces = mutableRecord(cam.namespaces)
  mutableRecord(namespaces.ui).integrity = sha256Integrity(uiBytes)
  mutableRecord(namespaces["contracts.BicycleComponentManager"]).integrity = sha256Integrity(abiBytes)
  const publicClient = createPublicClient(publicClientFixtureOptions({ camHash: fixtureDigest(encodeJson(cam)) }))
  return { publicClient, session: createSession(sessionFixtureOptions({ publicClient,
    loadResource: createResourceLoader(bikeResourceBytes({
      [camURI]: encodeJson(cam), [BIKE_UI_URI]: uiBytes, [BIKE_MANAGER_ABI_URI]: abiBytes,
    })),
  })) }
}

test("integer direct patches normalize exact values and never retain the previous valid amount after malformed input", async () => {
  const { session } = paymentPreparationSession(
    { amount: "$state.amount", recipients: [registeredOwnerAddress] }, undefined, "nonpayable",
    { element: "NonNegativeIntegerField", props: { label: "Counter", min: "0" },
      state: { key: "amount", defaultValue: "" } },
  )
  const empty = await session.load()
  assert.equal(empty.state.amount, null)
  for (const [raw, canonical] of [["00042", "42"], ["9007199254740993", "9007199254740993"], ["18446744073709551615", "18446744073709551615"], [(2n ** 256n - 1n).toString(), (2n ** 256n - 1n).toString()]]) {
    assert.equal(session.updateState({ amount: raw }).state.amount, canonical)
  }
  for (const text of ["", ".", "1.0", "-1", "+1", "1e3", "1,000", " 1", "١", "１２"]) {
    session.updateState({ amount: "42" })
    const invalid = session.updateState({ amount: text })
    assert.equal(invalid.state.amount, null)
    const action = resolvedUiButtons(invalid.resolvedUi).find((button) => button.call.function === "payment")
    assert.ok(action)
    await assert.rejects(() => session.dispatchAction(action),
      (error: unknown) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT")
  }
})

test("integer lexical edits preserve exact text and expose only a canonical string or unavailable null", async () => {
  const { session } = integerEditingSession()
  await session.load()
  for (const [text, canonical] of [["0", "0"], ["00042", "42"], ["9007199254740993", "9007199254740993"], ["18446744073709551615", "18446744073709551615"], [(2n ** 256n - 1n).toString(), (2n ** 256n - 1n).toString()]]) {
    const edited = editInteger(session, text)
    assert.equal(edited.state.amount, canonical)
    assert.deepEqual(integerDraft(edited), toInertValue({ text, status: "valid" }))
  }
  for (const text of [".", "1.0", "-1", "+1", "1e3", "1,000", " 1", "1 ", "١", "１２", "1\u00a02"]) {
    editInteger(session, "42")
    const invalid = editInteger(session, text)
    assert.equal(invalid.state.amount, null)
    assert.deepEqual(integerDraft(invalid), toInertValue({ text, status: "invalid", issue: "syntax" }))
  }
  const empty = editInteger(session, "")
  assert.equal(empty.state.amount, null)
  assert.deepEqual(integerDraft(empty), toInertValue({ text: "", status: "empty" }))
})

test("integer editing applies exact inclusive bounds and never pads, rounds or retains an old valid value", async () => {
  const { session } = integerEditingSession("", { min: "9007199254740993", max: "9007199254740994" })
  await session.load()
  for (const value of ["9007199254740993", "9007199254740994"]) assert.equal(editInteger(session, value).state.amount, value)
  for (const [text, issue] of [["9007199254740992", "belowMin"], ["9007199254740995", "aboveMax"]]) {
    const invalid = editInteger(session, text)
    assert.equal(invalid.state.amount, null)
    assert.deepEqual(integerDraft(invalid), toInertValue({ text, status: "invalid", issue }))
  }
})

test("integer preparation preserves exact supported ABI values and lets the ABI owner reject overflow without effects", async () => {
  const { session, publicClient } = integerEditingSession()
  await session.load()
  const readsBefore = publicClient.calls.length
  for (const value of ["0", "9007199254740993", "18446744073709551615", (2n ** 256n - 1n).toString()]) {
    const snapshot = editInteger(session, value)
    const action = resolvedUiButtons(snapshot.resolvedUi)[0]
    assert.ok(action)
    const result = await session.dispatchAction(action)
    assert.ok(result.type === "contractCall")
    assert.equal(mutableRecord(result.call.args.payment).amount, value)
    assert.deepEqual(session.snapshot(), snapshot)
  }
  const overflow = editInteger(session, (2n ** 256n).toString())
  assert.equal(integerDraft(overflow).status, "valid", "generic integer editing must not guess an ABI width")
  const action = resolvedUiButtons(overflow.resolvedUi)[0]
  assert.ok(action)
  await assert.rejects(() => session.dispatchAction(action),
    (error: unknown) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT")
  assert.equal(publicClient.calls.length, readsBefore)
  assert.deepEqual(session.snapshot(), overflow)
})

test("integer composition invalidates unchanged text before input and prevents stale action preparation", async () => {
  const { session } = integerEditingSession("42")
  const valid = await session.load()
  const stale = resolvedUiButtons(valid.resolvedUi)[0]
  assert.ok(stale)
  const composing = editInteger(session, "42", { composing: true })
  assert.equal(composing.state.amount, null)
  assert.deepEqual(integerDraft(composing), toInertValue({ text: "42", status: "incomplete", composing: true }))
  await assert.rejects(() => session.dispatchAction(stale),
    (error: unknown) => error instanceof CamViewerError && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED")
  const current = resolvedUiButtons(composing.resolvedUi)[0]
  assert.ok(current)
  await assert.rejects(() => session.dispatchAction(current),
    (error: unknown) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT")
  assert.equal(editInteger(session, "43", { composing: true }).state.amount, null)
  const finished = editInteger(session, "00043")
  assert.equal(finished.state.amount, "43")
  assert.deepEqual(integerDraft(finished), toInertValue({ text: "00043", status: "valid" }))
})

test("integer raw line breaks and excessive input are cleared without truncating into another valid quantity", async () => {
  const { session } = integerEditingSession("42")
  await session.load()
  for (const text of ["1\n2", "1\r2", "1\r\n2"]) {
    editInteger(session, "42")
    const rejected = editInteger(session, text)
    assert.equal(rejected.state.amount, null)
    assert.deepEqual(integerDraft(rejected), toInertValue({ text: "", status: "invalid", issue: "lineBreak" }))
  }
  for (const text of ["0".repeat(2049), "😀".repeat(1025)]) {
    editInteger(session, "42")
    const rejected = editInteger(session, text)
    assert.equal(rejected.state.amount, null)
    assert.deepEqual(integerDraft(rejected), toInertValue({ text: "", status: "invalid", issue: "tooLong" }))
  }
  assert.equal(editInteger(session, "0".repeat(2048)).state.amount, "0")
  assert.equal(editInteger(session, "1".repeat(1024)).state.amount, "1".repeat(1024))
  const tooManyDigits = editInteger(session, "1".repeat(1025))
  assert.equal(tooManyDigits.state.amount, null)
  assert.deepEqual(integerDraft(tooManyDigits), toInertValue({ text: "1".repeat(1025), status: "invalid", issue: "tooLong" }))
  assert.equal(session.updateState({ amount: "00043" }).state.amount, "43")
})

test("integer disabled controls and malformed API patches fail atomically", async () => {
  const disabled = integerEditingSession("42", undefined, true).session
  const before = await disabled.load()
  assert.throws(() => disabled.editInteger("amount", "43"), /disabled/)
  assert.throws(() => disabled.updateState({ amount: "43" }), /disabled/)
  assert.deepEqual(disabled.snapshot(), before)
  const session = integerEditingSession("42").session
  const valid = await session.load()
  assert.throws(() => session.editInteger("amount", 43 as unknown as string))
  assert.throws(() => session.updateState({ amount: null }))
  assert.throws(() => session.editAmount("amount", "base", "43"))
  assert.throws(() => session.editInteger("missing", "43"))
  assert.deepEqual(session.snapshot(), valid)
})

test("integer and plain text bindings coexist without numeric identifier heuristics", async () => {
  const { session } = paymentPreparationSession({ amount: "$state.amount", recipients: [registeredOwnerAddress] }, undefined, "nonpayable", {
    element: "Fragment", children: [
      { element: "NonNegativeIntegerField", props: { label: "Counter" }, state: { key: "amount", defaultValue: "00042" } },
      { element: "TextField", props: { label: "Identifier" }, state: { key: "identifier", defaultValue: "00042" } },
      { element: "TextField", props: { label: "Prototype-like identifier" }, state: { key: "constructor", defaultValue: "00042" } },
    ],
  })
  const initial = await session.load()
  assert.equal(initial.state.amount, "42")
  assert.equal(initial.state.identifier, "00042")
  const changed = session.updateState({ amount: "00043", identifier: "1.5", constructor: "00044" })
  assert.equal(changed.state.amount, "43")
  assert.equal(changed.state.identifier, "1.5")
  assert.equal(changed.state.constructor, "00044")
  assert.throws(() => session.editInteger("identifier", "45"))
  assert.deepEqual(session.snapshot(), changed)
})

test("integer lexical drafts are isolated, restored through Back and reset across accounts", async () => {
  const { session, publicClient } = integerEditingSession("42")
  await session.load()
  const edited = editInteger(session, "00023")
  mutableRecord(edited.state).amount = "999"
  mutableRecord(integerDraft(edited)).text = "999"
  await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  const restored = await session.back()
  assert.equal(restored.state.amount, "23")
  assert.equal(integerDraft(restored).text, "00023")
  editInteger(session, "00024", { composing: true })
  await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  const pending = await session.back()
  assert.equal(pending.state.amount, null)
  assert.equal(integerDraft(pending).composing, true)
  assert.equal(integerDraft(pending).text, "00024")
  const coherent = editInteger(session, "00025")
  const readContract = publicClient.readContract
  Object.assign(publicClient, { readContract: async () => { throw new Error("fixture read unavailable") } })
  await assert.rejects(() => session.setAccount({ address: otherUserAddress }))
  assert.deepEqual(session.snapshot(), coherent)
  Object.assign(publicClient, { readContract })
  const refreshed = await session.setAccount({ address: otherUserAddress })
  assert.equal(refreshed.state.amount, "42")
  assert.equal(integerDraft(refreshed).text, "42")
  assert.equal(refreshed.canGoBack, false)
})

test("integer canonical invalidation reaches actions declared before the input control", async () => {
  const { session } = paymentPreparationSession({ amount: "$state.amount", recipients: [registeredOwnerAddress] }, undefined, "nonpayable", {
    element: "Fragment", children: [
      { element: "Button", props: { label: "First action" }, call: { namespace: "routes", function: "payment", args: { payment: { amount: "$state.amount", recipients: [registeredOwnerAddress] } } } },
      { element: "NonNegativeIntegerField", props: { label: "Counter", min: "1", max: "2" }, state: { key: "amount", defaultValue: "1" } },
    ],
  })
  await session.load()
  const invalid = editInteger(session, "3")
  assert.equal(invalid.state.amount, null)
  for (const action of resolvedUiButtons(invalid.resolvedUi)) {
    assert.equal(mutableRecord(action.call.args.payment).amount, null)
    await assert.rejects(() => session.dispatchAction(action),
      (error: unknown) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT")
  }
})

test("Back revalidates the same integer lexical draft against refreshed readonly bounds before resolving actions", async () => {
  const resources = bikeResourceBytes(NO_RESOURCE_OVERRIDES)
  const ui = mutableRecord(JSON.parse(new TextDecoder().decode(resources[BIKE_UI_URI])))
  const field = { requires: ["view"], element: "NonNegativeIntegerField",
    props: { label: "Counter", min: "$view.tokenId", max: "$view.statusId" }, state: { key: "amount", defaultValue: "" } }
  const nodes = mutableRecord(ui.nodes)
  nodes.app = { requires: ["view"], element: "Screen", props: { title: "Counter" }, children: [
    { element: "Button", props: { label: "Inspect current counter" }, call: { namespace: "routes", function: BIKE_ROUTE_COMPONENT, args: { serialNumber: "$state.amount" } } },
    { element: "Include", call: { namespace: "ui", function: "$view.viewId", args: { view: "$view" } } },
  ] }
  nodes.entry = field
  nodes["component.active"] = field
  const uiBytes = encodeJson(ui)
  const cam = mutableRecord(JSON.parse(new TextDecoder().decode(resources[camURI])))
  mutableRecord(mutableRecord(cam.namespaces).ui).integrity = sha256Integrity(uiBytes)
  const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active")
  routeResults[BIKE_VIEW_ENTRY] = { ...bikeEntryRouteResult(userAddress), tokenId: 1n, statusId: "100" }
  routeResults[BIKE_VIEW_COMPONENT] = { ...bikeComponentRouteResult(BIKE_SERIAL_NUMBER, userAddress, "active"), tokenId: 1n, statusId: "100" }
  const session = createSession(sessionFixtureOptions({
    publicClient: createPublicClient(publicClientFixtureOptions({ routeResults, camHash: fixtureDigest(encodeJson(cam)) })),
    loadResource: createResourceLoader(bikeResourceBytes({ [camURI]: encodeJson(cam), [BIKE_UI_URI]: uiBytes })),
  }))
  await session.load()
  editInteger(session, "00100")
  await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  routeResults[BIKE_VIEW_ENTRY] = { ...bikeEntryRouteResult(userAddress), tokenId: 1n, statusId: "99" }
  const invalid = await session.back()
  assert.equal(invalid.state.amount, null)
  assert.deepEqual(integerDraft(invalid), toInertValue({ text: "00100", status: "invalid", issue: "aboveMax" }))
  assert.equal(resolvedUiButtons(invalid.resolvedUi)[0]?.call.args.serialNumber, null)
  await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  const coherent = session.snapshot()
  for (const maximum of ["not-a-number", "0"]) {
    routeResults[BIKE_VIEW_ENTRY] = { ...bikeEntryRouteResult(userAddress), tokenId: 1n, statusId: maximum }
    await assert.rejects(() => session.back())
    assert.deepEqual(session.snapshot(), coherent)
  }
  routeResults[BIKE_VIEW_ENTRY] = { ...bikeEntryRouteResult(userAddress), tokenId: 1n, statusId: "100" }
  const restored = await session.back()
  assert.equal(restored.state.amount, "100")
  assert.equal(integerDraft(restored).text, "00100")
  assert.equal(resolvedUiButtons(restored.resolvedUi)[0]?.call.args.serialNumber, "100")
})

test("Back never reinterprets an integer draft as an amount or an amount draft as an integer", async () => {
  const integer = { requires: ["view"], element: "NonNegativeIntegerField", props: { label: "Counter" }, state: { key: "amount", defaultValue: "2" } }
  const amount = { requires: ["view"], element: "AmountField", props: { label: "Deposit", unit: {
    assetId: "declared", baseLabel: "base units", displayLabel: "Declared asset", decimals: 18,
  } }, state: { key: "amount", defaultValue: "1" } }
  for (const initiallyInteger of [true, false]) {
    const resources = bikeResourceBytes(NO_RESOURCE_OVERRIDES)
    const ui = mutableRecord(JSON.parse(new TextDecoder().decode(resources[BIKE_UI_URI])))
    const nodes = mutableRecord(ui.nodes)
    nodes.app = { requires: ["view"], element: "Screen", props: { title: "Numeric input" }, children: [
      { element: "Include", call: { namespace: "ui", function: "$view.viewId", args: { view: "$view" } } },
    ] }
    nodes.entry = initiallyInteger ? integer : amount
    nodes["component.active"] = nodes.entry
    nodes["changed.kind"] = initiallyInteger ? amount : integer
    const uiBytes = encodeJson(ui)
    const cam = mutableRecord(JSON.parse(new TextDecoder().decode(resources[camURI])))
    mutableRecord(mutableRecord(cam.namespaces).ui).integrity = sha256Integrity(uiBytes)
    const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active")
    const session = createSession(sessionFixtureOptions({
      publicClient: createPublicClient(publicClientFixtureOptions({ routeResults, camHash: fixtureDigest(encodeJson(cam)) })),
      loadResource: createResourceLoader(bikeResourceBytes({ [camURI]: encodeJson(cam), [BIKE_UI_URI]: uiBytes })),
    }))
    await session.load()
    if (initiallyInteger) editInteger(session, "00023")
    else editAmount(session, "display", "0.0100")
    await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
    routeResults[BIKE_VIEW_ENTRY] = { ...bikeEntryRouteResult(userAddress), viewId: "changed.kind" }
    const restored = await session.back()
    if (initiallyInteger) {
      assert.equal(restored.state.amount, "1")
      assert.equal(amountDraft(restored).baseText, "1")
      assert.throws(() => session.editInteger("amount", "24"))
    } else {
      assert.equal(restored.state.amount, "2")
      assert.equal(integerDraft(restored).text, "2")
      assert.throws(() => session.editAmount("amount", "base", "24"))
    }
    assert.deepEqual(session.snapshot(), restored)
  }
})

test("duration editing keeps parts while canonical patches, Back and account changes retain their own meaning", async () => {
  const { session } = durationEditingSession("60", false)
  await session.load()
  const edited = session.editDuration("amount", "minutes", "0002")
  assert.equal(edited.state.amount, "120")
  assert.equal(durationDraft(edited).parts.minutes.text, "0002")
  const composing = session.editDuration("amount", "hours", "1", { composing: true })
  assert.equal(composing.state.amount, null)
  await assert.rejects(() => session.dispatchAction(resolvedUiButtons(composing.resolvedUi)[0]), CamEvmError)
  session.editDuration("amount", "hours", "")
  await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  const restored = await session.back()
  assert.equal(restored.state.amount, "120")
  assert.equal(durationDraft(restored).parts.minutes.text, "0002")
  const patched = session.updateState({ amount: "90061" })
  assert.equal(patched.state.amount, "90061")
  assert.equal(durationDraft(patched).parts.days.text, "1")
  const reset = await session.setAccount({ address: otherUserAddress })
  assert.equal(reset.state.amount, "60")
  assert.equal(reset.canGoBack, false)
})

test("Refresh revalidates duration parts against fresh bounds and rolls back a failed read", async () => {
  const resources = bikeResourceBytes(NO_RESOURCE_OVERRIDES)
  const ui = mutableRecord(JSON.parse(new TextDecoder().decode(resources[BIKE_UI_URI])))
  const nodes = mutableRecord(ui.nodes)
  nodes.app = { requires: ["view"], element: "Screen", props: { title: "Duration" }, children: [
    { element: "Button", props: { label: "Inspect" }, call: { namespace: "routes", function: BIKE_ROUTE_COMPONENT, args: { serialNumber: "$state.amount" } } },
    { element: "DurationField", props: { label: "Wait", min: "$view.tokenId", max: "$view.statusId" }, state: { key: "amount", defaultValue: "" } },
  ] }
  const uiBytes = encodeJson(ui)
  const cam = mutableRecord(JSON.parse(new TextDecoder().decode(resources[camURI])))
  mutableRecord(mutableRecord(cam.namespaces).ui).integrity = sha256Integrity(uiBytes)
  const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active")
  const result = bikeEntryRouteResult(userAddress)
  routeResults[BIKE_VIEW_ENTRY] = { ...result, tokenId: 1n, statusId: "120" }
  const publicClient = createPublicClient(publicClientFixtureOptions({ routeResults, camHash: fixtureDigest(encodeJson(cam)) }))
  const session = createSession(sessionFixtureOptions({ publicClient,
    loadResource: createResourceLoader(bikeResourceBytes({ [camURI]: encodeJson(cam), [BIKE_UI_URI]: uiBytes })),
  }))
  await session.load()
  session.editDuration("amount", "minutes", "0002")
  routeResults[BIKE_VIEW_ENTRY] = { ...result, tokenId: 1n, statusId: "119" }
  const invalid = await session.refresh()
  assert.equal(invalid.state.amount, null)
  assert.equal(durationDraft(invalid).parts.minutes.text, "0002")
  assert.equal(durationDraft(invalid).issue, "aboveMax")
  assert.equal(resolvedUiButtons(invalid.resolvedUi)[0].call.args.serialNumber, null)
  assert.equal(invalid.canGoBack, false)
  const readContract = publicClient.readContract
  Object.assign(publicClient, { readContract: async () => { throw new Error("fixture read unavailable") } })
  await assert.rejects(() => session.refresh())
  assert.deepEqual(session.snapshot(), invalid)
  Object.assign(publicClient, { readContract })
  routeResults[BIKE_VIEW_ENTRY] = { ...result, tokenId: 1n, statusId: "120" }
  const valid = await session.refresh()
  assert.equal(valid.state.amount, "120")
  assert.equal(durationDraft(valid).parts.minutes.text, "0002")
  assert.equal(resolvedUiButtons(valid.resolvedUi)[0].call.args.serialNumber, "120")
})

test("duration edits enforce rendered field ownership and fail atomically for malformed API calls", async () => {
  const disabled = durationEditingSession("60", true).session
  await disabled.load()
  const before = disabled.snapshot()
  assert.throws(() => disabled.editDuration("amount", "days", "1"), CamViewerError)
  assert.deepEqual(disabled.snapshot(), before)
  const { session } = durationEditingSession("60", false)
  await session.load()
  const coherent = session.snapshot()
  assert.throws(() => session.editDuration("amount", "weeks" as never, "1"), CamViewerError)
  assert.throws(() => session.editDuration("missing", "days", "1"), CamViewerError)
  assert.throws(() => session.updateState({ amount: 60 }), CamViewerError)
  assert.deepEqual(session.snapshot(), coherent)
})

function durationEditingSession(defaultValue: string, disabled: boolean) {
  return paymentPreparationSession({ amount: "$state.amount", recipients: [registeredOwnerAddress] }, undefined, "nonpayable", {
    element: "DurationField", props: { label: "Wait" }, state: { key: "amount", defaultValue },
    ...(disabled ? { enabledWhen: { member: "edit", in: [] } } : {}),
  })
}

function durationDraft(snapshot: CamViewerLoadedSnapshot) {
  let result: import("@cam/screen").ResolvedDurationFieldNode | undefined
  forEachResolvedUiNode(snapshot.resolvedUi, node => { if (node.element === "DurationField") result = node })
  assert.ok(result)
  return result.draft
}

function integerEditingSession(defaultValue?: string, bounds?: Record<string, unknown>, disabled?: boolean) {
  return paymentPreparationSession(
    { amount: "$state.amount", recipients: [registeredOwnerAddress] }, undefined, "nonpayable",
    { element: "NonNegativeIntegerField", props: { label: "Counter", ...(bounds === undefined ? {} : bounds) },
      state: { key: "amount", defaultValue: defaultValue === undefined ? "" : defaultValue },
      ...(disabled === true ? { enabledWhen: { member: "edit", in: [] } } : {}) },
  )
}

function editInteger(session: ReturnType<typeof createSession>, text: string, options?: { composing?: boolean }): CamViewerLoadedSnapshot {
  return session.editInteger("amount", text, options)
}

function integerDraft(snapshot: CamViewerLoadedSnapshot): ResolvedNonNegativeIntegerFieldNode["draft"] {
  let draft: ResolvedNonNegativeIntegerFieldNode["draft"] | undefined
  forEachResolvedUiNode(snapshot.resolvedUi, (node) => {
    if (node.element === "NonNegativeIntegerField") draft = node.draft
  })
  assert.ok(draft, "resolved integer field draft is missing")
  return draft
}

test("paired amount canonical state supplies identical exact ABI tuple and payable value", async () => {
  const { session } = paymentPreparationSession(
    { amount: "$state.amount", recipients: [registeredOwnerAddress] },
    "$inputs.payment.amount",
    "payable",
    { element: "AmountField", props: { label: "Deposit", unit: {
      assetId: "declared-native", baseLabel: "base units", displayLabel: "Declared asset", decimals: 18,
    } }, state: { key: "amount", defaultValue: "" } },
  )
  await session.load()
  for (const [display, base] of [
    ["0.0100", "10000000000000000"],
    ["0.009007199254740993", "9007199254740993"],
    ["0.000000000000000001", "1"],
    ["0", "0"],
  ]) {
    const snapshot = editAmount(session, "display", display)
    const action = resolvedUiButtons(snapshot.resolvedUi).find((button) => button.call.function === "payment")
    assert.ok(action)
    const prepared = await session.dispatchAction(action)
    assert.equal(prepared.type, "contractCall")
    assert.ok(prepared.type === "contractCall")
    assert.equal(prepared.call.value, base)
    assert.equal(mutableRecord(prepared.call.args.payment).amount, base)
    assert.deepEqual(session.snapshot(), snapshot, "preparation must preserve the exact active draft")
  }
})

test("zero-decimal amounts accept exact fractional-zero spelling without treating empty integers as zero", async () => {
  const { session } = amountEditingSession(0)
  await session.load()
  for (const text of [".0", ".000"]) {
    const edited = editAmount(session, "display", text)
    assert.equal(edited.state.amount, "0")
    assert.deepEqual(amountDraft(edited), toInertValue({ representation: "display", baseText: "0", displayText: text, status: "valid" }))
  }
  const integer = integerEditingSession().session
  assert.equal((await integer.load()).state.amount, null)
  assert.equal(editInteger(integer, "").state.amount, null)
})

test("amount edits synchronize exact paired representations without rewriting the active draft", async () => {
  for (const { decimals, display, base } of [
    { decimals: 0, display: "9007199254740993", base: "9007199254740993" },
    { decimals: 6, display: "9007199254.740993", base: "9007199254740993" },
    { decimals: 18, display: "0.009007199254740993", base: "9007199254740993" },
  ]) {
    const { session } = amountEditingSession(decimals)
    await session.load()
    const fromDisplay = editAmount(session, "display", display)
    assert.equal(fromDisplay.state.amount, base)
    assert.deepEqual(amountDraft(fromDisplay), toInertValue({ representation: "display", baseText: base, displayText: display, status: "valid" }))
    const fromBase = editAmount(session, "base", base)
    assert.equal(fromBase.state.amount, base)
    assert.deepEqual(amountDraft(fromBase), toInertValue({ representation: "base", baseText: base, displayText: display, status: "valid" }))
  }
  const { session } = amountEditingSession(6)
  await session.load()
  for (const { text, base } of [
    { text: "0.", base: "0" }, { text: "0.0100", base: "10000" }, { text: ".1", base: "100000" },
    { text: "1.", base: "1000000" }, { text: "0.010000000", base: "10000" },
  ]) {
    const snapshot = editAmount(session, "display", text)
    assert.equal(snapshot.state.amount, base)
    assert.equal(amountDraft(snapshot).displayText, text)
    assert.equal(amountDraft(snapshot).baseText, base)
  }
  const baseDraft = session.updateState({ amount: "000001" })
  assert.equal(baseDraft.state.amount, "1")
  assert.equal(amountDraft(baseDraft).baseText, "000001")
  assert.equal(amountDraft(baseDraft).displayText, "0.000001")
})

test("incomplete and invalid amount edits remove the usable value and any misleading counterpart", async () => {
  const { session } = amountEditingSession(6)
  await session.load()
  for (const { representation, text, status, issue } of [
    { representation: "display", text: "", status: "empty" },
    { representation: "display", text: ".", status: "incomplete" },
    ...["nonsense", " 1", "1 ", "1\t", "1e3", "-1", "+1", "1,000", "1.2.3"].map((text) => ({ representation: "display", text, status: "invalid", issue: "syntax" })),
    { representation: "display", text: "0.0000001", status: "invalid", issue: "precision" },
    { representation: "base", text: "0.", status: "invalid", issue: "syntax" },
    { representation: "base", text: "", status: "empty" },
  ]) {
    editAmount(session, "base", "25")
    const snapshot = editAmount(session, representation as "base" | "display", text)
    assert.equal(snapshot.state.amount, null, `${representation} ${JSON.stringify(text)} must not retain 25`)
    const draft = amountDraft(snapshot)
    assert.equal(draft.status, status)
    assert.equal(draft.issue, issue)
    assert.equal(draft.baseText, representation === "base" ? text : "")
    assert.equal(draft.displayText, representation === "display" ? text : "")
    const recovered = editAmount(session, "display", "0.01")
    assert.equal(recovered.state.amount, "10000")
    assert.equal(amountDraft(recovered).status, "valid")
  }
})

test("amount line breaks reject both representations without retaining text that native inputs sanitize", async () => {
  const { session, publicClient } = amountEditingSession(6)
  await session.load()
  for (const representation of ["base", "display"] as const) {
    for (const text of ["1\n2", "1\r2", "1\r\n2"]) {
      const valid = editAmount(session, "base", "10000")
      const staleAction = resolvedUiButtons(valid.resolvedUi).find((button) => button.call.function === "payment")
      assert.ok(staleAction)
      const rejected = editAmount(session, representation, text)
      assert.equal(rejected.state.amount, null)
      assert.equal(amountDraft(rejected).status, "invalid")
      assert.equal(amountDraft(rejected).issue, "lineBreak")
      assert.equal(amountDraft(rejected).baseText, "")
      assert.equal(amountDraft(rejected).displayText, "")
      const readsBefore = publicClient.calls.length
      await assert.rejects(() => session.dispatchAction(staleAction),
        (error: unknown) => error instanceof CamViewerError && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED")
      const currentAction = resolvedUiButtons(rejected.resolvedUi).find((button) => button.call.function === "payment")
      assert.ok(currentAction)
      await assert.rejects(() => session.dispatchAction(currentAction),
        (error: unknown) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT")
      assert.equal(publicClient.calls.length, readsBefore)
      assert.equal(editAmount(session, "display", "0.0100").state.amount, "10000")
    }
  }
  const patched = session.updateState({ amount: "1\r\n2" })
  assert.equal(patched.state.amount, null)
  assert.equal(amountDraft(patched).issue, "lineBreak")
  assert.equal(amountDraft(patched).baseText, "")
  assert.equal(amountDraft(patched).displayText, "")
})

test("paired amount conversion preserves independent integer arithmetic laws across declared scales", async () => {
  let seed = 0x5eedn
  const samples = [0n, 1n, 9007199254740993n, 2n ** 256n - 1n]
  for (let index = 0; index < 20; index++) {
    seed = (seed * 6364136223846793005n + 1442695040888963407n) & (2n ** 256n - 1n)
    samples.push(seed)
  }
  for (const decimals of [0, 6, 18, 255]) {
    const { session } = amountEditingSession(decimals)
    await session.load()
    const scale = 10n ** BigInt(decimals)
    for (const amount of samples) {
      const fraction = decimals === 0 ? "" : (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "")
      const expectedDisplay = `${amount / scale}${fraction === "" ? "" : `.${fraction}`}`
      const fromBase = editAmount(session, "base", amount.toString())
      assert.equal(amountDraft(fromBase).displayText, expectedDisplay)
      const displayDraft = `${expectedDisplay}${expectedDisplay.includes(".") ? "" : "."}0000`
      const fromDisplay = editAmount(session, "display", displayDraft)
      assert.equal(fromDisplay.state.amount, amount.toString())
      assert.equal(amountDraft(fromDisplay).baseText, amount.toString())
      assert.equal(amountDraft(fromDisplay).displayText, displayDraft)
      assert.equal(amountDraft(fromDisplay).status, "valid")
    }
  }
})

test("amount input bounds invalidate prior values rather than truncate or retain oversized drafts", async () => {
  const { session } = amountEditingSession(0)
  await session.load()
  const exactLimit = editAmount(session, "base", `${"0".repeat(1024)}${"1".repeat(1024)}`)
  assert.equal(amountDraft(exactLimit).baseText.length, 2048)
  assert.equal(exactLimit.state.amount, "1".repeat(1024))
  for (const text of ["0".repeat(2049), "\uD83D\uDE00".repeat(1025), "1".repeat(1025)]) {
    editAmount(session, "base", "25")
    const rejected = editAmount(session, "base", text)
    assert.equal(rejected.state.amount, null)
    assert.equal(amountDraft(rejected).status, "invalid")
    assert.equal(amountDraft(rejected).issue, "tooLong")
    assert.equal(amountDraft(rejected).baseText, text.length > 2048 ? "" : text)
    assert.equal(amountDraft(rejected).displayText, "")
    if (text.length > 2048) assert.equal(JSON.stringify(rejected).includes(text), false)
  }
})

test("invalid amount edits cannot dispatch a stale valid button or prepare a new unset amount", async () => {
  const { session, publicClient } = amountEditingSession(18)
  await session.load()
  const valid = editAmount(session, "base", "9007199254740993")
  const validAction = resolvedUiButtons(valid.resolvedUi).find((button) => button.call.function === "payment")
  assert.ok(validAction)
  const prepared = await session.dispatchAction(validAction)
  assert.equal(prepared.type, "contractCall")
  const readsBefore = publicClient.calls.length
  const invalid = editAmount(session, "display", ".")
  await assert.rejects(() => session.dispatchAction(validAction),
    (error: unknown) => error instanceof CamViewerError && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED")
  const invalidAction = resolvedUiButtons(invalid.resolvedUi).find((button) => button.call.function === "payment")
  assert.ok(invalidAction)
  await assert.rejects(() => session.dispatchAction(invalidAction),
    (error: unknown) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT")
  assert.equal(publicClient.calls.length, readsBefore)
  assert.deepEqual(session.snapshot(), invalid)
})

test("amount composition invalidates the previous amount before input and remains unavailable through Back", async () => {
  const { session, publicClient } = amountEditingSession(6)
  await session.load()
  const valid = editAmount(session, "display", "0.0100")
  const staleAction = resolvedUiButtons(valid.resolvedUi).find((button) => button.call.function === "payment")
  assert.ok(staleAction)
  const readsBefore = publicClient.calls.length
  const started = editAmount(session, "display", "0.0100", { composing: true })
  assert.equal(amountDraft(started).composing, true)
  assert.equal(started.state.amount, null)
  assert.equal(amountDraft(started).status, "incomplete")
  assert.equal(amountDraft(started).displayText, "0.0100")
  assert.equal(amountDraft(started).baseText, "")
  await assert.rejects(() => session.dispatchAction(staleAction),
    (error: unknown) => error instanceof CamViewerError && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED")
  const currentAction = resolvedUiButtons(started.resolvedUi).find((button) => button.call.function === "payment")
  assert.ok(currentAction)
  await assert.rejects(() => session.dispatchAction(currentAction),
    (error: unknown) => error instanceof CamEvmError && error.code === "CAM_WRITE_INVALID_ARGUMENT")
  const intermediate = editAmount(session, "display", "0.0200", { composing: true })
  assert.equal(intermediate.state.amount, null)
  assert.equal(amountDraft(intermediate).displayText, "0.0200")
  assert.equal(amountDraft(intermediate).status, "incomplete")
  assert.equal(publicClient.calls.length, readsBefore)
  await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  const restored = await session.back()
  assert.equal(restored.state.amount, null)
  assert.equal(amountDraft(restored).status, "incomplete")
  assert.equal(amountDraft(restored).displayText, "0.0200")
  assert.equal(amountDraft(restored).composing, true)
  const finished = editAmount(session, "display", "0.0200")
  assert.equal(finished.state.amount, "20000")
  assert.equal(amountDraft(finished).displayText, "0.0200")
  assert.equal(amountDraft(finished).baseText, "20000")
  assert.equal(amountDraft(finished).status, "valid")
  assert.equal(Object.hasOwn(amountDraft(finished), "composing"), false)
  const ordinaryIncomplete = editAmount(session, "display", ".")
  assert.equal(amountDraft(ordinaryIncomplete).status, "incomplete")
  assert.equal(Object.hasOwn(amountDraft(ordinaryIncomplete), "composing"), false)
})

test("amount editing honors current disabled fields and keeps failed patches atomic", async () => {
  const { session } = amountEditingSession(18, "0", true)
  const before = await session.load()
  for (const representation of ["base", "display"] as const) {
    assert.throws(() => editAmount(session, representation, "1"), /disabled/)
    assert.deepEqual(session.snapshot(), before)
  }
  assert.throws(() => session.updateState({ amount: "1" }), /disabled/)
  assert.deepEqual(session.snapshot(), before)
})

test("amount editing rejects fabricated targets, representations and non-string base patches atomically", async () => {
  const { session } = amountEditingSession(6)
  await session.load()
  const before = editAmount(session, "display", "0.0100")
  for (const operation of [
    () => session.editAmount("notRendered", "base", "1"),
    () => session.editAmount("amount", "notARepresentation" as "base", "1"),
    () => session.updateState({ amount: null }),
    () => session.updateState({ amount: 1 }),
    () => session.updateState({ amount: "1", notRendered: "2" }),
  ]) {
    assert.throws(operation, (error: unknown) => error instanceof Error)
    assert.deepEqual(session.snapshot(), before)
  }
})

test("amount drafts remain distinct from ordinary fields with prototype-like state names", async () => {
  const { session } = paymentPreparationSession({ amount: "$state.amount", recipients: [registeredOwnerAddress] }, undefined, "nonpayable", {
    element: "Fragment", children: [
      { element: "AmountField", props: { label: "Deposit", unit: {
        assetId: "eip155:31337/slip44:60", baseLabel: "wei", displayLabel: "ETH", decimals: 18,
      } }, state: { key: "amount", defaultValue: "0" } },
      ...["constructor", "toString"].map((key) => ({ element: "TextField", props: { label: key }, state: { key, defaultValue: "ordinary" } })),
    ],
  })
  await session.load()
  const mixed = session.updateState({ constructor: "ordinary constructor draft", toString: "ordinary toString draft", amount: "1" })
  assert.equal(mixed.state.constructor, "ordinary constructor draft")
  assert.equal(mixed.state.toString, "ordinary toString draft")
  assert.equal(mixed.state.amount, "1")
  assert.equal(amountDraft(mixed).baseText, "1")
  assert.equal(Object.hasOwn(mixed.state, "constructor"), true)
  assert.equal(Object.hasOwn(mixed.state, "toString"), true)
  const edited = editAmount(session, "display", "0.01")
  assert.equal(edited.state.constructor, mixed.state.constructor)
  assert.equal(edited.state.toString, mixed.state.toString)
  assert.equal(edited.state.amount, "10000000000000000")
})

test("amount lexical drafts are isolated snapshots, restored by Back and reset by fresh views or accounts", async () => {
  const { session } = amountEditingSession(6)
  await session.load()
  const edited = editAmount(session, "display", "0.0100")
  mutableRecord(amountDraft(edited)).displayText = "hostile snapshot mutation"
  mutableRecord(edited.state).amount = "999"
  const unchanged = session.snapshot() as CamViewerLoadedSnapshot
  assert.equal(unchanged.state.amount, "10000")
  assert.equal(amountDraft(unchanged).displayText, "0.0100")
  const fresh = await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  assert.equal(fresh.state.amount, "0")
  const restored = await session.back()
  assert.equal(restored.state.amount, "10000")
  assert.equal(amountDraft(restored).displayText, "0.0100")
  assert.equal(amountDraft(restored).representation, "display")
  const switched = await session.setAccount({ address: otherUserAddress })
  assert.equal(switched.state.amount, "0")
  assert.equal(amountDraft(switched).baseText, "0")
  assert.equal(switched.canGoBack, false)
  editAmount(session, "display", "0.02")
  assert.equal((await session.load()).state.amount, "0")
})

test("failed account refresh retains the exact amount draft and previous account atomically", async () => {
  const { session, publicClient } = amountEditingSession(6)
  await session.load()
  const before = editAmount(session, "display", "0.0100")
  const readContract = publicClient.readContract
  Object.assign(publicClient, { readContract: async () => { throw new Error("fixture read unavailable") } })
  await assert.rejects(() => session.setAccount({ address: otherUserAddress }))
  assert.deepEqual(session.snapshot(), before)
  Object.assign(publicClient, { readContract })
  assert.equal((await session.setAccount({ address: otherUserAddress })).state.amount, "0")
})

test("Back restores amount drafts only when the complete declared unit identity still matches", async () => {
  const initialUnit = { assetId: "eip155:31337/slip44:60", baseLabel: "base units", displayLabel: "Declared asset", decimals: 6 }
  for (const changedUnit of [
    { ...initialUnit, decimals: 18 }, { ...initialUnit, assetId: "eip155:1/slip44:60" },
    { ...initialUnit, baseLabel: "changed base label" }, { ...initialUnit, displayLabel: "changed asset label" },
  ]) {
    const resources = bikeResourceBytes(NO_RESOURCE_OVERRIDES)
    const ui = mutableRecord(JSON.parse(new TextDecoder().decode(resources[BIKE_UI_URI])))
    const field = (unit: typeof initialUnit, defaultValue: string) => ({ requires: ["view"], element: "AmountField",
      props: { label: "Deposit", unit }, state: { key: "amount", defaultValue } })
    const nodes = mutableRecord(ui.nodes)
    nodes.app = { requires: ["view"], element: "Screen", props: { title: "Deposit" }, children: [
      { element: "Include", call: { namespace: "ui", function: "$view.viewId", args: { view: "$view" } } },
    ] }
    nodes.entry = field(initialUnit, "0")
    nodes["component.active"] = field(initialUnit, "0")
    nodes["changed.unit"] = field(changedUnit, "2")
    const uiBytes = encodeJson(ui)
    const cam = mutableRecord(JSON.parse(new TextDecoder().decode(resources[camURI])))
    mutableRecord(mutableRecord(cam.namespaces).ui).integrity = sha256Integrity(uiBytes)
    const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active")
    const session = createSession(sessionFixtureOptions({
      publicClient: createPublicClient(publicClientFixtureOptions({ routeResults, camHash: fixtureDigest(encodeJson(cam)) })),
      loadResource: createResourceLoader(bikeResourceBytes({ [camURI]: encodeJson(cam), [BIKE_UI_URI]: uiBytes })),
    }))
    await session.load()
    editAmount(session, "display", "0.0100")
    await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
    routeResults[BIKE_VIEW_ENTRY] = { ...bikeEntryRouteResult(userAddress), viewId: "changed.unit" }
    const refreshed = await session.back()
    assert.equal(refreshed.state.amount, "2")
    assert.equal(amountDraft(refreshed).baseText, "2")
    assert.equal(amountDraft(refreshed).representation, "base")
  }
})

function amountEditingSession(decimals: number, defaultValue?: string, disabled?: boolean) {
  const initialAmount = defaultValue === undefined ? "0" : defaultValue
  return paymentPreparationSession({ amount: "$state.amount", recipients: [registeredOwnerAddress] }, undefined, "nonpayable", {
    element: "AmountField", props: { label: "Deposit", unit: {
      assetId: "eip155:31337/slip44:60", baseLabel: "base units", displayLabel: "Declared asset", decimals,
    } }, state: { key: "amount", defaultValue: initialAmount }, ...(disabled === true ? { enabledWhen: { member: "pay", in: [] } } : {}),
  })
}

function editAmount(session: ReturnType<typeof createSession>, representation: "base" | "display", text: string, options?: { composing?: boolean }): CamViewerLoadedSnapshot {
  return session.editAmount("amount", representation, text, options)
}

function amountDraft(snapshot: CamViewerLoadedSnapshot): ResolvedAmountFieldNode["draft"] {
  let draft: ResolvedAmountFieldNode["draft"] | undefined
  forEachResolvedUiNode(snapshot.resolvedUi, (node) => {
    if (node.element === "AmountField") draft = node.draft
  })
  assert.ok(draft && typeof draft === "object", "resolved amount control must expose its paired draft")
  return draft
}

test("history retains at most twenty previous visits", async () => {
  const session = createSession(sessionFixtureOptions({}))
  await session.load()
  for (let visit = 0; visit < 22; visit += 1) {
    session.updateState({ serialNumber: String(visit) })
    await session.navigate(BIKE_ROUTE_ENTRY, {})
  }
  for (let visit = 21; visit >= 2; visit -= 1) {
    assert.equal((await session.back()).state.serialNumber, String(visit))
  }
  assert.equal(session.snapshot().canGoBack, false)
  await assert.rejects(() => session.back(), /no previous view/)
})

test("a pending Back rejects competing mutations and preserves its account scope", async () => {
  let releaseRead: (() => void) | undefined
  let blockEntry = false
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({ publicClient: {
    ...publicClient,
    async readContract(request) {
      if (blockEntry && request.functionName === BIKE_VIEW_ENTRY) {
        await new Promise<void>((resolve) => { releaseRead = resolve })
      }
      return await publicClient.readContract(request)
    },
  } }))
  await session.load()
  session.updateState({ serialNumber: "unfinished" })
  await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  blockEntry = true
  const returning = session.back()
  await assert.rejects(() => session.navigate(BIKE_ROUTE_ENTRY, {}), /navigation is in progress/)
  await assert.rejects(() => session.setAccount({ address: otherUserAddress }), /navigation is in progress/)
  await assert.rejects(() => session.back(), /navigation is in progress/)
  assert.throws(() => session.updateState({ serialNumber: "competing edit" }), /navigation is in progress/)
  assert.ok(releaseRead)
  releaseRead()
  const restored = await returning
  assert.equal(restored.state.serialNumber, "unfinished")
  assert.equal(restored.account?.address, userAddress)
  assert.equal(restored.canGoBack, false)
})

test("snapshots retain the previous account and view until an account read succeeds", async () => {
  let releaseRead: (() => void) | undefined
  let startedRead: (() => void) | undefined
  const readStarted = new Promise<void>((resolve) => { startedRead = resolve })
  let changingAccount = false
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({ publicClient: {
    ...publicClient,
    async readContract(request) {
      if (changingAccount && request.functionName === BIKE_VIEW_ENTRY) {
        const pendingRead = new Promise<void>((resolve) => { releaseRead = resolve })
        startedRead?.()
        await pendingRead
        assert.deepEqual(request.args, [otherUserAddress])
        return bikeEntryRouteResult(otherUserAddress)
      }
      return await publicClient.readContract(request)
    },
  } }))
  await session.load()
  await session.navigate(BIKE_ROUTE_ENTRY, {})
  const before = session.updateState({ serialNumber: "unfinished" })
  changingAccount = true
  const changing = session.setAccount({ address: otherUserAddress })
  await readStarted
  assert.deepEqual(session.snapshot(), before)
  assert.ok(releaseRead)
  releaseRead()
  const after = await changing
  assert.equal(after.account?.address, otherUserAddress)
  assert.equal(mutableRecord(after.values[0]).account, otherUserAddress)
  assert.equal(after.canGoBack, false)
})

test("session creation validates host and account boundary values", () => {
  const options = sessionFixtureOptions({})

  assert.throws(
    () => createCamViewerSession({
      ...options,
      host: {
        ...host,
        chainId: "31337",
      },
      account: { address: userAddress },
      inputs: {},

    }),
    /expected CAIP-2 EVM chain id/,
  )

  assert.throws(
    () => createCamViewerSession({
      ...options,
      host: {
        ...host,
        address: "not-an-address" as Address,
      },
      account: { address: userAddress },
      inputs: {},

    }),
    /host\.address/,
  )

  assert.throws(
    () => createCamViewerSession({
      ...options,
      host,
      account: { address: "not-an-address" as Address },
      inputs: {},

    }),
    /account\.address/,
  )
})

test("load rejects routes that require an account when none is available", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createCamViewerSession({
    publicClient,
    host,
    inputs: {},
    loadResource: createResourceLoader(bikeResourceBytes(NO_RESOURCE_OVERRIDES)),
  })

  await assert.rejects(
    () => session.load(),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /requires an account/.test(error.message),
  )
  assert.equal(publicClient.calls.some((call) => call.functionName === BIKE_VIEW_ENTRY), false)
})

test("load rejects UI buttons that require an account when none is available", async () => {
  const abiBytes = encodeJson([
    {
      type: "function",
      name: "viewEntry",
      stateMutability: "view",
      inputs: [],
      outputs: [{
        name: "view",
        type: "tuple",
        components: [{ name: "title", type: "string" }],
      }],
    },
    {
      type: "function",
      name: "save",
      stateMutability: "nonpayable",
      inputs: [{ name: "owner", type: "address" }],
      outputs: [],
    },
  ])
  const uiBytes = encodeJson({
    ui: UI_VERSION,
    nodes: {
      app: {
        element: "Fragment",
        requires: ["view"],
        children: [{
          element: "Button",
          props: {
            label: "Save",
          },
          call: {
            namespace: "routes",
            function: "save",
            args: {
              owner: "$account.address",
            },
          },
        }],
      },
    },
  })
  const camBytes = encodeJson({
    cam: CAM_VERSION,
    protocol: JSON.parse(new TextDecoder().decode(bikeResourceBytes({})[camURI])).protocol,
    entry: "entry",
    namespaces: {
      [BIKE_UI_NAMESPACE]: {
        type: "contract",
        abiURI: "./abi/BicycleComponentManagerUI.json",
        integrity: sha256Integrity(abiBytes),
      },
      ui: {
        type: "ui",
        uri: "./ui.json",
        integrity: sha256Integrity(uiBytes),
      },
      routes: {
        type: "routes",
      },
    },
    routes: {
      entry: {
        kind: "read",
        inputs: [],
        call: {
          namespace: BIKE_UI_NAMESPACE,
          function: "viewEntry",
          args: {},
        },
        then: {
          namespace: "ui",
          function: "app",
          args: {
            view: "$outputs.0",
          },
        },
      },
      save: {
        kind: "write",
        inputs: ["owner"],
        call: {
          namespace: BIKE_UI_NAMESPACE,
          function: "save",
          args: {
            owner: "$inputs.owner",
          },
        },
        then: {
          namespace: "routes",
          function: "entry",
          args: {},
        },
      },
    },
  })
  const publicClient = createPublicClient(publicClientFixtureOptions({
    camHash: fixtureDigest(camBytes),
    routeResults: { viewEntry: { title: "Anonymous entry" } },
  }))
  const session = createCamViewerSession({
    publicClient,
    host,
    inputs: {},
    loadResource: createResourceLoader(bikeResourceBytes({
      [camURI]: camBytes,
      [BIKE_UI_ABI_URI]: abiBytes,
      [BIKE_UI_URI]: uiBytes,
    })),
  })

  await assert.rejects(
    () => session.load(),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /UI requires an account/.test(error.message),
  )
})

test("snapshot returns isolated copies of nested route and resolved UI data", async () => {
  const session = createSession(sessionFixtureOptions({}))
  const snapshot = await session.load()

  mutableRecord(snapshot.values[0]).accountInfo = "mutated route value"
  mutableRecord(snapshot.resolvedUi.props).title = "mutated title"

  const nextSnapshot = session.snapshot()
  assert.equal(mutableRecord(nextSnapshot.values?.[0]).accountInfo, "Mock registrar account")
  assert.equal(mutableRecord(nextSnapshot.resolvedUi?.props).title, "Bicycle component registry")
})

test("load failures do not expose a partially loaded session", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({
    publicClient: {
      ...publicClient,
      async readContract(request) {
        if (request.functionName === BIKE_VIEW_ENTRY) {
          throw new Error("entry route failed")
        }
        return await publicClient.readContract(request)
      },
    },
  }))

  await assert.rejects(
    () => session.load(),
    (error) => error instanceof Error,
  )
  const failedSnapshot = session.snapshot()
  assert.deepEqual(failedSnapshot.account, { address: userAddress })
  assert.deepEqual(Object.entries(failedSnapshot.inputs), [])
  assert.equal("route" in failedSnapshot, false)
  await assert.rejects(
    () => session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER }),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_NOT_LOADED",
  )
})

test("load rejects oversized UI resources at the loader boundary", async () => {
  const session = createSession(sessionFixtureOptions({
    loadResource: createResourceLoader(bikeResourceBytes({
      [BIKE_UI_URI]: new Uint8Array(CAM_RESOURCE_MAX_BYTES + 1),
    })),
  }))

  await assert.rejects(
    () => session.load(),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_UI_LOAD_FAILED"
      && error.cause instanceof Error
      && /too large/.test(error.cause.message),
  )
})

test("setAccount before load fails without mutating the session", async () => {
  const session = createSession(sessionFixtureOptions({}))

  await assert.rejects(
    () => session.setAccount({ address: otherUserAddress }),
    (error) => error instanceof CamViewerError && error.code === "CAM_VIEWER_NOT_LOADED",
  )

  assert.deepEqual(session.snapshot().account, { address: userAddress })
})

test("setAccount reload failures preserve the previous loaded snapshot", async () => {
  let entryCalls = 0
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({
    publicClient: {
      ...publicClient,
      async readContract(request) {
        if (request.functionName === BIKE_VIEW_ENTRY) {
          entryCalls += 1
          if (entryCalls > 1) {
            throw new Error("entry reload failed")
          }
        }
        return await publicClient.readContract(request)
      },
    },
  }))

  const before = await session.load()

  await assert.rejects(
    () => session.setAccount({ address: otherUserAddress }),
    (error) => error instanceof Error,
  )

  assert.deepEqual(session.snapshot(), before)
})

test("createCamViewerSession rejects cyclic initial inputs with their boundary path", () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic

  assert.throws(
    () => createCamViewerSession({
      publicClient: createPublicClient(publicClientFixtureOptions({})),
      host,
      account: { address: userAddress },
      inputs: cyclic as InertRecord,
      loadResource: createResourceLoader(bikeResourceBytes(NO_RESOURCE_OVERRIDES)),
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_INVALID_INERT_VALUE"
      && error.message === "CAM viewer data is not safely cloneable: inputs"
      && error.cause instanceof InertValueError
      && error.cause.path === "self",
  )
})

test("updateState rejects fields that are not backed by rendered inputs", async () => {
  const session = createSession(sessionFixtureOptions({}))
  const before = await session.load()

  assert.throws(
    () => session.updateState({ typoSerialNumber: BIKE_SERIAL_NUMBER }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_INVALID_INERT_VALUE",
  )
  assert.deepEqual(session.snapshot(), before)
})

test("updateState resolves route actions, while write routes are surfaced without sending", async () => {
  const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active")
  const publicClient = createPublicClient(publicClientFixtureOptions({ routeResults }))
  const session = createSession(sessionFixtureOptions({ publicClient }))
  await session.load()

  const accountSnapshot = session.updateState({
    accountInfo: BIKE_ACCOUNT_INFO_URI,
  })
  assert.equal("children" in accountSnapshot.resolvedUi, true)
  if (!("children" in accountSnapshot.resolvedUi)) {
    assert.fail("expected entry root children")
  }
  const accountButton = resolvedUiButtons(accountSnapshot.resolvedUi).find((child) =>
    child.element === "Button" && child.call.function === "setAccountInfo"
  )
  assert.equal(accountButton?.element, "Button")
  if (accountButton?.element !== "Button") {
    assert.fail("expected account-info write button")
  }

  const accountResult = await session.dispatchAction(accountButton)
  assert.equal(accountResult.type, "contractCall")
  assert.equal(session.snapshot().canGoBack, false)
  if (accountResult.type !== "contractCall") {
    assert.fail("expected account-info contract call action result")
  }
  assert.equal(accountResult.call.route, "setAccountInfo")
  assert.equal(accountResult.call.address, managerAddress)
  assert.equal(accountResult.call.function, "setAccountInfo")
  assert.deepEqual(accountResult.call.args, toInertValue({ infoURI: BIKE_ACCOUNT_INFO_URI }))
  assert.equal(accountResult.call.then.namespace, "routes")
  assert.equal(accountResult.call.then.function, BIKE_ROUTE_ENTRY)

  routeResults[BIKE_VIEW_REGISTER] = bikeRegisterRouteResult(BIKE_UNKNOWN_SERIAL_NUMBER, userAddress)
  const registerSnapshot = await session.navigate("register", { serialNumber: BIKE_UNKNOWN_SERIAL_NUMBER })
  assert.equal(registerSnapshot.state.owner, "")
  const preparedRegisterSnapshot = session.updateState({
    owner: registeredOwnerAddress,
    tokenURI: BIKE_REGISTRATION_TOKEN_URI,
  })
  assert.deepEqual(preparedRegisterSnapshot.values, registerSnapshot.values)
  assert.equal("children" in preparedRegisterSnapshot.resolvedUi, true)
  if (!("children" in preparedRegisterSnapshot.resolvedUi)) {
    assert.fail("expected register root children")
  }
  const registerButton = resolvedUiButtons(preparedRegisterSnapshot.resolvedUi).find((child) =>
    child.element === "Button" && child.call.function === "registerComponent"
  )
  assert.equal(registerButton?.element, "Button")
  if (registerButton?.element !== "Button") {
    assert.fail("expected registration write button")
  }

  const registerResult = await session.dispatchAction(registerButton)
  assert.equal(registerResult.type, "contractCall")
  if (registerResult.type !== "contractCall") {
    assert.fail("expected registration contract call action result")
  }
  assert.equal(registerResult.call.route, "registerComponent")
  assert.equal(registerResult.call.address, managerAddress)
  assert.equal(registerResult.call.function, "registerComponent")
  assert.deepEqual(registerResult.call.args, toInertValue({
    owner: registeredOwnerAddress,
    serialNumber: BIKE_UNKNOWN_SERIAL_NUMBER,
    tokenURI_: BIKE_REGISTRATION_TOKEN_URI,
  }))
  assert.equal(registerResult.call.then.namespace, "routes")
  assert.equal(registerResult.call.then.function, BIKE_ROUTE_COMPONENT)

  await session.navigate(BIKE_ROUTE_ENTRY, {})
  const snapshot = session.updateState({
    serialNumber: BIKE_SERIAL_NUMBER,
  })

  assert.equal("children" in snapshot.resolvedUi, true)
  if (!("children" in snapshot.resolvedUi)) {
    assert.fail("expected resolved root children")
  }
  const action = resolvedUiButtons(snapshot.resolvedUi).find((child) => child.call.function === BIKE_ROUTE_COMPONENT)
  assert.equal(action?.element, "Button")
  if (action?.element !== "Button") {
    assert.fail("expected resolved action")
  }
  assert.equal(action.call.function, BIKE_ROUTE_COMPONENT)
  assert.equal(action.call.args.serialNumber, BIKE_SERIAL_NUMBER)

  const result = await session.dispatchAction(action)

  assert.equal(result.type, "navigated")
  if (result.type !== "navigated") {
    assert.fail("expected navigation action result")
  }
  assert.equal(result.snapshot.route, BIKE_ROUTE_COMPONENT)
  assert.equal(result.snapshot.inputs.serialNumber, BIKE_SERIAL_NUMBER)
  assert.equal(publicClient.calls.at(-1)?.functionName, BIKE_VIEW_COMPONENT)
  assert.deepEqual(publicClient.calls.at(-1)?.args, [BIKE_SERIAL_NUMBER, userAddress])

  const reportSnapshot = session.updateState({
    reportURI: BIKE_REPORT_URI,
  })

  assert.equal("children" in reportSnapshot.resolvedUi, true)
  if (!("children" in reportSnapshot.resolvedUi)) {
    assert.fail("expected resolved root children")
  }
  const writeButton = resolvedUiButtons(reportSnapshot.resolvedUi).find((child) =>
    child.element === "Button" && child.call.function === "markComponentMissing"
  )
  assert.equal(writeButton?.element, "Button")
  if (writeButton?.element !== "Button") {
    assert.fail("expected resolved write button")
  }

  const callsBefore = publicClient.calls.length
  const contractResult = await session.dispatchAction(writeButton)

  assert.equal(contractResult.type, "contractCall")
  if (contractResult.type !== "contractCall") {
    assert.fail("expected contract call action result")
  }
  assert.equal(contractResult.call.route, "markComponentMissing")
  assert.equal(contractResult.call.address, managerAddress)
  assert.equal(contractResult.call.function, BIKE_MARK_MISSING)
  assert.deepEqual(contractResult.call.abi, toInertValue(bikeManagerAbi))
  assert.deepEqual(
    contractResult.call.args,
    toInertValue({ serialNumber: BIKE_SERIAL_NUMBER, reportURI: BIKE_REPORT_URI }),
  )
  assert.equal(contractResult.call.then.namespace, "routes")
  assert.equal(contractResult.call.then.function, BIKE_ROUTE_COMPONENT)
  assert.equal(publicClient.calls.length, callsBefore)

  const missingResult = bikeComponentRouteResult(BIKE_SERIAL_NUMBER, userAddress, "missing")
  routeResults[BIKE_VIEW_COMPONENT] = missingResult
  const missingSnapshot = await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  assert.equal(
    resolvedStatusValue(missingSnapshot.resolvedUi, "Current missing report URI"),
    BIKE_MISSING_REPORT_URI,
  )
  const resolutionSnapshot = session.updateState({
    resolutionURI: BIKE_RESOLUTION_URI,
  })

  assert.deepEqual(resolutionSnapshot.values, missingSnapshot.values)
  assert.equal("children" in resolutionSnapshot.resolvedUi, true)
  if (!("children" in resolutionSnapshot.resolvedUi)) {
    assert.fail("expected missing resolved root children")
  }
  const clearButton = resolvedUiButtons(resolutionSnapshot.resolvedUi).find((child) =>
    child.element === "Button" && child.call.function === "clearComponentMissing"
  )
  assert.equal(clearButton?.element, "Button")
  if (clearButton?.element !== "Button") {
    assert.fail("expected resolved clear button")
  }

  const clearResult = await session.dispatchAction(clearButton)
  assert.equal(clearResult.type, "contractCall")
  if (clearResult.type !== "contractCall") {
    assert.fail("expected clear contract call action result")
  }
  assert.equal(clearResult.call.route, "clearComponentMissing")
  assert.equal(clearResult.call.address, managerAddress)
  assert.equal(clearResult.call.function, "clearComponentMissing")
  assert.deepEqual(clearResult.call.args, toInertValue({
    serialNumber: BIKE_SERIAL_NUMBER,
    resolutionURI: BIKE_RESOLUTION_URI,
  }))
})

function resolvedStatusValue(root: ResolvedUiNode, label: string): unknown {
  let value: unknown
  forEachResolvedUiNode(root, (node) => {
    if (node.element === "Status" && node.props.label === label) {
      value = node.props.value
    }
  })
  return value
}

test("dispatchAction rejects actions that are not rendered in the current view", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({ publicClient }))
  await session.load()
  const callsBefore = publicClient.calls.length

  await assert.rejects(
    () => session.dispatchAction({
      element: "Button",
      props: {
        label: "Hidden write",
      },
      call: {
        namespace: "routes",
        function: BIKE_MARK_MISSING,
        args: {
          serialNumber: BIKE_SERIAL_NUMBER,
          reportURI: BIKE_REPORT_URI,
        },
      },
    }),
    (error) => error instanceof CamViewerError
      && error.code === "CAM_VIEWER_ACTION_UNSUPPORTED"
      && /not rendered/.test(error.message),
  )
  assert.equal(publicClient.calls.length, callsBefore)
})

function createSession({
  publicClient,
  loadResource,
}: SessionFixtureOptions) {
  return createCamViewerSession({
    publicClient,
    host,
    account: { address: userAddress },
    inputs: {},

    loadResource,
  })
}

function createPublicClient({
  chainId,
  camHash,
  supportsCamInterface,
  addresses,
  routeResults,
}: PublicClientFixtureOptions) {
  // This fake models raw viem return values before @cam/evm-viem normalizes
  // them to RouteResult.values.
  return createMockCamPublicClient({
    chainId,
    camURI,
    camHash,
    supportsCamInterface,
    addresses,
    routeResults,
  })
}

type SessionFixtureOptions = {
  readonly publicClient: ReturnType<typeof createPublicClient>
  readonly loadResource: CreateCamViewerSessionOptions["loadResource"]
}

type PublicClientFixtureOptions = {
  readonly chainId: number
  readonly camHash: Hex
  readonly supportsCamInterface: boolean
  readonly addresses: Readonly<Record<string, Address>>
  readonly routeResults: Record<string, unknown>
}

function sessionFixtureOptions(overrides: Partial<SessionFixtureOptions>): SessionFixtureOptions {
  return {
    publicClient: createPublicClient(publicClientFixtureOptions({})),
    loadResource: createResourceLoader(bikeResourceBytes(NO_RESOURCE_OVERRIDES)),
    ...overrides,
  }
}

function publicClientFixtureOptions(overrides: Partial<PublicClientFixtureOptions>): PublicClientFixtureOptions {
  return {
    chainId: 31337,
    camHash: fixtureDigest(bikeResourceBytes({})[camURI]),
    supportsCamInterface: true,
    addresses: bikeContractAddresses,
    routeResults: bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active"),
    ...overrides,
  }
}

function assertBikeProjection(
  actual: Record<string, unknown>,
  expected: Readonly<Record<string, unknown>>,
): void {
  for (const [key, value] of Object.entries(expected)) {
    assert.deepEqual(actual[key], value)
  }
}

function mutableRecord(value: unknown): Record<string, unknown> {
  assert.equal(typeof value, "object")
  assert.notEqual(value, null)
  assert.equal(Array.isArray(value), false)
  return value as Record<string, unknown>
}

function sha256Integrity(bytes: Uint8Array): string {
  return `sha256:0x${createHash("sha256").update(bytes).digest("hex")}`
}

test("an explicit initial read route bypasses entry and starts with no Back history", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const options = {
    ...sessionFixtureOptions({ publicClient }), host, account: { address: userAddress as Address },
    route: BIKE_ROUTE_COMPONENT,
    inputs: { serialNumber: BIKE_SERIAL_NUMBER },
  }
  const session = createCamViewerSession(options)
  const snapshot = await session.load()
  assert.equal(snapshot.route, BIKE_ROUTE_COMPONENT)
  assert.deepEqual(snapshot.inputs, toInertValue(options.inputs))
  assert.equal(snapshot.canGoBack, false)
  assert.equal(publicClient.calls.some((call) => call.functionName === BIKE_VIEW_ENTRY), false)
  assert.equal(publicClient.calls.at(-1)?.functionName, BIKE_VIEW_COMPONENT)
  assert.deepEqual(publicClient.calls.at(-1)?.args, [BIKE_SERIAL_NUMBER, userAddress])
})

test("unknown and write initial routes fail before any projection call", async () => {
  for (const route of ["unknown", "registerComponent"]) {
    const publicClient = createPublicClient(publicClientFixtureOptions({}))
    const options = {
      ...sessionFixtureOptions({ publicClient }), host, account: { address: userAddress as Address },
      route, inputs: {},
    }
    const session = createCamViewerSession(options)
    await assert.rejects(() => session.load(), /must be declared as read/)
    assert.equal(publicClient.calls.some((call) => [BIKE_VIEW_ENTRY, BIKE_VIEW_COMPONENT].includes(call.functionName)), false)
    assert.equal(session.snapshot().route, undefined)
  }
})
test("undefined navigation returns to the manifest entry through the ordinary read path", async () => {
  const session = createSession(sessionFixtureOptions({}))
  await session.load()
  await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
  const snapshot = await session.navigate(undefined, {})
  assert.equal(snapshot.route, BIKE_ROUTE_ENTRY)
  assert.deepEqual(snapshot.inputs, toInertValue({}))
  assert.equal(snapshot.canGoBack, true)
  assert.equal((await session.back()).route, BIKE_ROUTE_COMPONENT)
})

function documentHashSession() {
  const resources = bikeResourceBytes({})
  const ui = mutableRecord(JSON.parse(new TextDecoder().decode(resources[BIKE_UI_URI])))
  const nodes = mutableRecord(ui.nodes)
  nodes.app = { requires: ["view"], element: "Fragment", children: [
    { element: "TextField", props: { label: "URI" }, state: { key: "uri", defaultValue: "https://example.test/terms" } },
    { element: "DocumentHashField", props: { label: "Digest", algorithm: "sha256", sourceURI: "$state.uri" }, state: { key: "digest", defaultValue: "manual" } },
  ] }
  const bytes = encodeJson(ui)
  const cam = mutableRecord(JSON.parse(new TextDecoder().decode(resources[camURI])))
  mutableRecord(mutableRecord(cam.namespaces).ui).integrity = sha256Integrity(bytes)
  return createSession(sessionFixtureOptions({ publicClient: createPublicClient(publicClientFixtureOptions({ camHash: fixtureDigest(encodeJson(cam)) })), loadResource: createResourceLoader(bikeResourceBytes({ [camURI]: encodeJson(cam), [BIKE_UI_URI]: bytes })) }))
}
const calculatedDigest = `0x${"ab".repeat(32)}`

test("document hash calculation is explicit and preserves manual input on failure and cancellation", async () => {
  const session = documentHashSession()
  await session.load()
  assert.equal(session.snapshot().state?.digest, "manual")
  const failed = session.beginDocumentHash("digest", "url")
  assert.equal(session.snapshot().documentHashes?.digest?.status, "pending")
  failed.fail("Document could not be read")
  assert.equal(session.snapshot().state?.digest, "manual")
  assert.equal(session.snapshot().documentHashes?.digest?.message, "Document could not be read")
  const canceled = session.beginDocumentHash("digest", "file")
  session.cancelDocumentHash("digest")
  assert.equal(canceled.signal.aborted, true)
  assert.equal(canceled.complete(calculatedDigest), undefined)
  assert.equal(canceled.fail("late failure"), undefined)
  assert.equal(session.snapshot().state?.digest, "manual")
})

test("document hash URI and manual edits invalidate late completions and remote correspondence", async () => {
  const session = documentHashSession()
  await session.load()
  const uriWork = session.beginDocumentHash("digest", "url")
  session.updateState({ uri: "https://example.test/moved" })
  assert.equal(uriWork.signal.aborted, true)
  assert.equal(uriWork.complete(calculatedDigest), undefined)
  assert.equal(session.snapshot().state?.digest, "manual")
  const manualWork = session.beginDocumentHash("digest", "file")
  session.updateState({ digest: "manual" })
  assert.equal(manualWork.complete(calculatedDigest), undefined)
  const remote = session.beginDocumentHash("digest", "url")
  remote.complete(calculatedDigest)
  assert.equal(session.snapshot().documentHashes?.digest?.sourceURI, "https://example.test/moved")
  session.updateState({ uri: "https://example.test/other" })
  assert.equal(session.snapshot().state?.digest, calculatedDigest)
  assert.equal(session.snapshot().documentHashes?.digest, undefined)
  const local = session.beginDocumentHash("digest", "file")
  local.complete(calculatedDigest)
  assert.equal(session.snapshot().documentHashes?.digest?.sourceURI, undefined)
})

test("document hash replacement and all view transition intents invalidate pending writes", async () => {
  const session = documentHashSession()
  await session.load()
  const replaced = session.beginDocumentHash("digest", "url")
  const replacement = session.beginDocumentHash("digest", "file")
  assert.equal(replaced.signal.aborted, true)
  assert.equal(replaced.complete(calculatedDigest), undefined)
  assert.equal(replaced.fail("late failure"), undefined)
  replacement.fail("Canceled read")
  for (const transition of [() => session.navigate("unknown", {}), () => session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER }), () => session.back(), () => session.setAccount({ address: otherUserAddress }), () => session.load()]) {
    const pending = session.beginDocumentHash("digest", "url")
    const changing = transition()
    assert.equal(pending.signal.aborted, true)
    assert.equal(pending.complete(calculatedDigest), undefined)
    assert.equal(pending.fail("late failure"), undefined)
    await changing.catch(() => undefined)
  }
})
function fixtureDigest(bytes: Uint8Array): Hex {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`
}
