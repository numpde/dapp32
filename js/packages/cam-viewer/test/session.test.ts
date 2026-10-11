import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"

import { CAM_RESOURCE_MAX_BYTES, CAM_VERSION, toInertValue, UI_VERSION } from "@cam/protocol"
import { forEachResolvedUiNode, type ResolvedUiNode } from "@cam/screen"

import {
  createCamViewerSession,
} from "../src/index.ts"
import { CamViewerError } from "../src/errors.ts"
import type {
  CamHost,
} from "@cam/evm-viem"
import type { CreateCamViewerSessionOptions } from "../src/index.ts"
import type { Address, Hex } from "viem"
import {
  BIKE_ACCOUNT_ADDRESS as userAddress,
  BIKE_CAM_URI as camURI,
  BIKE_MARK_MISSING,
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
  BIKE_UNSIGNED_CAM_HASH,
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

test("load resolves host CAM, entry route, UI resource, and entry view", async () => {
  const publicClient = createPublicClient(publicClientFixtureOptions({}))
  const session = createSession(sessionFixtureOptions({ publicClient }))

  const snapshot = await session.load()

  assert.equal(snapshot.route, BIKE_ROUTE_ENTRY)
  assert.equal(snapshot.resolvedUi.element, "Screen")
  assert.equal(snapshot.resolvedUi.children[0]?.element, "Status")
  assert.equal(snapshot.resolvedUi.children[0]?.props.label, "Registry paused")
  assert.equal(snapshot.resolvedUi.children[0]?.props.value, false)
  assert.equal(snapshot.resolvedUi.children[1]?.element, "Fragment")
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
    "camURI",
    "camHash",
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
  routeResults[BIKE_VIEW_REGISTER] = bikeRegisterRouteResult(BIKE_SERIAL_NUMBER, userAddress)
  const restored = await session.back()
  assert.equal(Object.hasOwn(restored.state, "owner"), false)
  assert.equal(Object.hasOwn(restored.state, "tokenURI"), false)
})

test("Back preserves visible drafts while refreshed contract availability disables and re-enables their controls", async () => {
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
  const appChildren = mutableRecord(nodes.app).children as Record<string, unknown>[]
  const actionInclude = appChildren.find((child) => child.element === "Include"
    && mutableRecord(child.call).function === "$view.actions")
  assert.ok(actionInclude)
  mutableRecord(actionInclude.call).function = "lookupComponent"
  const uiBytes = encodeJson(ui)
  const cam = mutableRecord(JSON.parse(new TextDecoder().decode(resources[camURI])))
  mutableRecord(mutableRecord(cam.namespaces).ui).integrity = sha256Integrity(uiBytes)
  const routeResults = bikeRouteResults(BIKE_SERIAL_NUMBER, userAddress, "active")
  const session = createSession(sessionFixtureOptions({
    publicClient: createPublicClient(publicClientFixtureOptions({ routeResults })),
    loadResource: createResourceLoader(bikeResourceBytes({
      [camURI]: encodeJson(cam),
      [BIKE_UI_URI]: uiBytes,
    })),
  }))
  await session.load()
  session.updateState({ serialNumber: "unfinished draft" })

  for (const available of [false, true]) {
    await session.navigate(BIKE_ROUTE_COMPONENT, { serialNumber: BIKE_SERIAL_NUMBER })
    routeResults[BIKE_VIEW_ENTRY] = {
      ...bikeEntryRouteResult(userAddress),
      actions: available ? ["lookupComponent"] : [],
    }
    const restored = await session.back()
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

test("failed navigation, Back, account changes and reloads preserve the view and history", async () => {
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
    () => session.setAccount({ address: otherUserAddress }),
    () => session.load(),
  ]) {
    await assert.rejects(operation)
    assert.deepEqual(session.snapshot(), before)
  }
  failReads = false
  assert.equal((await session.back()).state.serialNumber, "unfinished")
})

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
      allowUnsignedCamHash: true,
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
      allowUnsignedCamHash: true,
    }),
    /host\.address/,
  )

  assert.throws(
    () => createCamViewerSession({
      ...options,
      host,
      account: { address: "not-an-address" as Address },
      inputs: {},
      allowUnsignedCamHash: true,
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
    allowUnsignedCamHash: true,
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
  const publicClient = createPublicClient(publicClientFixtureOptions({
    routeResults: {
      viewEntry: {
        title: "Anonymous entry",
      },
    },
  }))
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
  const session = createCamViewerSession({
    publicClient,
    host,
    inputs: {},
    allowUnsignedCamHash: true,
    loadResource: createResourceLoader({
      [camURI]: camBytes,
      [BIKE_UI_ABI_URI]: abiBytes,
      [BIKE_UI_URI]: uiBytes,
    }),
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
  const accountButton = accountSnapshot.resolvedUi.children.find((child) =>
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
  const registerButton = preparedRegisterSnapshot.resolvedUi.children.find((child) =>
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
  const action = snapshot.resolvedUi.children.find((child) => child.element === "Button")
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
  const writeButton = reportSnapshot.resolvedUi.children.find((child) =>
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
    resolvedStatusValue(missingSnapshot.resolvedUi, "Missing report URI"),
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
  const clearButton = resolutionSnapshot.resolvedUi.children.find((child) =>
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
    allowUnsignedCamHash: true,
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
    camHash: BIKE_UNSIGNED_CAM_HASH,
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
