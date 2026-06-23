import {
  callCamRoute,
  loadCamFromHost,
  resolveCamContracts,
  verifyCamResourceIntegrity,
} from "@cam/evm-viem"
import {
  assertCamResourceSize,
  CAM_UI_NAMESPACE,
  createStringMap,
  isCamNamespaceNameForType,
  parseJsonBytes,
  resolveCamResourceURI,
  toInertValue,
  UI_CALL_NAMESPACE_BY_ELEMENT,
} from "@cam/protocol"
import {
  createContext,
  routeRequiresAccount,
  resolveRouteCall,
  resolveRouteThen,
} from "@cam/core"
import type { CamDocument } from "@cam/core"
import type { CamRuntimeContext, InertRecord, InertValue } from "@cam/protocol"
import {
  UiError,
  parseUi,
  resolvedUiInputNames,
  resolveInitialUiNode,
  resolveUiNode,
} from "@cam/screen"
import type { CamHost, ResolvedCamContract } from "@cam/evm-viem"
import type {
  ResolvedButtonNode,
  ResolvedUiCall,
  ResolvedUiNode,
  UiRuntimeContext,
  UiDocument,
} from "@cam/screen"

import { CamViewerError } from "./errors.ts"
import type {
  CamViewerAccount,
  CamViewerActionResult,
  CamViewerLoadedSnapshot,
  CamViewerPreparedContractCall,
  CamViewerSession,
  CamViewerSnapshot,
  CreateCamViewerSessionOptions,
} from "./types.ts"

type CamViewerLoadedState = {
  readonly cam: CamDocument
  readonly camURI: string
  readonly contracts: Record<string, ResolvedCamContract>
  readonly uiURI: string
  readonly ui: UiDocument
}

type CurrentView = {
  readonly route: string
  readonly inputs: InertRecord
  readonly state: InertRecord
  readonly resolvedUi: ResolvedUiNode
  readonly values: readonly InertValue[]
}

export function createCamViewerSession({
  publicClient,
  host,
  loadResource,
  allowUnsignedCamHash,
  account: initialAccount,
  inputs: initialInputs,
}: CreateCamViewerSessionOptions): CamViewerSession {
  const sessionHost = cloneHost(host)
  const initialRouteInputs = cloneViewerData<InertRecord>(initialInputs, "inputs")
  let account = initialAccount === undefined ? undefined : cloneAccount(initialAccount)
  let loadedState: CamViewerLoadedState | undefined
  let currentView: CurrentView | undefined

  function snapshot(): CamViewerSnapshot {
    if (currentView === undefined) {
      return sessionSnapshot(initialRouteInputs)
    }

    return loadedSnapshot(currentView)
  }

  function sessionSnapshot(inputs: InertRecord): CamViewerSnapshot {
    return {
      inputs: cloneViewerData<InertRecord>(inputs, "inputs"),
      ...(account === undefined ? {} : { account: cloneAccount(account) }),
    }
  }

  function loadedSnapshot(view: CurrentView): CamViewerLoadedSnapshot {
    const current = assertLoaded()
    return {
      ...sessionSnapshot(view.inputs),
      route: view.route,
      state: cloneViewerData<InertRecord>(view.state, "state"),
      uiURI: current.uiURI,
      resolvedUi: cloneViewerData<ResolvedUiNode>(view.resolvedUi, "resolvedUi"),
      values: cloneViewerData<readonly InertValue[]>(view.values, "values"),
    }
  }

  async function load(): Promise<CamViewerLoadedSnapshot> {
    const loadedCam = await loadCamFromHost({
      publicClient,
      host: sessionHost,
      loadResource,
      allowUnsignedCamHash,
    })

    const contracts = await resolveCamContracts({
      publicClient,
      host: sessionHost,
      camURI: loadedCam.camURI,
      cam: loadedCam.cam,
      loadResource,
    })

    const uiResource = uiResourceDeclaration(loadedCam.cam, loadedCam.camURI)
    const ui = await loadUi(uiResource.uri, uiResource.integrity)

    const nextLoadedState = {
      cam: loadedCam.cam,
      camURI: loadedCam.camURI,
      contracts,
      uiURI: uiResource.uri,
      ui,
    }
    const nextView = await resolveLoadedView(nextLoadedState, loadedCam.cam.entry, initialRouteInputs)

    loadedState = nextLoadedState
    currentView = nextView

    return loadedSnapshot(currentView)
  }

  async function navigate(nextRoute: string, nextInputs: InertRecord): Promise<CamViewerLoadedSnapshot> {
    assertLoaded()
    return await navigateLoaded(nextRoute, nextInputs)
  }

  async function setAccount(nextAccount?: CamViewerAccount): Promise<CamViewerLoadedSnapshot> {
    const view = currentView
    if (view === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session has no loaded view")
    }

    const previousAccount = account
    account = nextAccount === undefined ? undefined : cloneAccount(nextAccount)
    try {
      return await navigateLoaded(view.route, view.inputs)
    } catch (cause) {
      account = previousAccount
      throw cause
    }
  }

  function updateState(patch: InertRecord): CamViewerLoadedSnapshot {
    if (currentView === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session has no loaded state")
    }

    const statePatch = cloneViewerData<InertRecord>(patch, "state")
    assertStatePatchTargets(currentView.resolvedUi, statePatch)
    const state = cloneViewerData<InertRecord>(
      {
        ...currentView.state,
        ...statePatch,
      },
      "state",
    )

    const resolvedUi = resolveCurrentUi(currentView.route, currentView.inputs, currentView.values, state)
    const nextView: CurrentView = {
      ...currentView,
      state,
      resolvedUi,
    }

    currentView = nextView
    return loadedSnapshot(currentView)
  }

  async function dispatchAction(action: ResolvedButtonNode): Promise<CamViewerActionResult> {
    assertLoaded()

    if (action.call.namespace !== UI_CALL_NAMESPACE_BY_ELEMENT.Button) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM action must call routes namespace: ${action.call.namespace}`)
    }

    const route = action.call.function
    const camRoute = assertLoaded().cam.routes[route]
    if (camRoute === undefined) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM action references unknown route: ${route}`)
    }

    if (camRoute.kind === "read") {
      return {
        type: "navigated",
        snapshot: await navigateLoaded(route, action.call.args),
      }
    }

    if (camRoute.kind === "write") {
      return {
        type: "contractCall",
        call: prepareContractCall(route, action.call.args),
      }
    }

    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `unsupported CAM route kind: ${camRoute.kind}`)
  }

  async function navigateLoaded(nextRoute: string, nextInputs: InertRecord): Promise<CamViewerLoadedSnapshot> {
    const current = assertLoaded()
    const nextView = await resolveLoadedView(current, nextRoute, nextInputs)

    currentView = nextView

    return loadedSnapshot(currentView)
  }

  async function resolveLoadedView(
    current: CamViewerLoadedState,
    nextRoute: string,
    nextInputs: InertRecord,
  ): Promise<CurrentView> {
    const routeInputs = cloneViewerData<InertRecord>(nextInputs, "inputs")
    const routeDeclaration = current.cam.routes[nextRoute]
    if (routeDeclaration === undefined || routeDeclaration.kind !== "read") {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM navigation route must be declared as read: ${nextRoute}`)
    }
    assertRouteAccountAvailable(current.cam, nextRoute)

    const routeResult = await callCamRoute({
      publicClient,
      cam: current.cam,
      contracts: current.contracts,
      route: nextRoute,
      context: routeContext(routeInputs, []),
    })

    const initial = resolveInitialUi(current, nextRoute, routeInputs, routeResult.values)
    return {
      route: nextRoute,
      inputs: routeInputs,
      state: initial.state,
      resolvedUi: initial.resolvedUi,
      values: routeResult.values,
    }
  }

  async function loadUi(uri: string, integrity: string): Promise<UiDocument> {
    let bytes: Uint8Array
    try {
      bytes = await loadResource(uri)
      assertCamResourceSize(bytes, uri)
    } catch (cause) {
      throw new CamViewerError("CAM_VIEWER_UI_LOAD_FAILED", `failed to load CAM UI resource: ${uri}`, cause)
    }
    try {
      verifyCamResourceIntegrity({ bytes, integrity, uri })
    } catch (cause) {
      throw new CamViewerError("CAM_VIEWER_UI_LOAD_FAILED", `failed to verify CAM UI resource: ${uri}`, cause)
    }

    try {
      return parseUi(parseJsonBytes(bytes))
    } catch (cause) {
      throw new CamViewerError("CAM_VIEWER_UI_PARSE_FAILED", `failed to parse CAM UI resource: ${uri}`, cause)
    }
  }

  function resolveInitialUi(
    current: CamViewerLoadedState,
    route: string,
    inputs: InertRecord,
    values: readonly InertValue[],
  ): {
    readonly state: InertRecord
    readonly resolvedUi: ResolvedUiNode
  } {
    const context = routeContext(inputs, values)
    const then = resolveRouteThen(current.cam, route, context)
    if (then.namespace !== CAM_UI_NAMESPACE) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM read route must continue to ui namespace: ${route}`)
    }

    // UI initial resolution is deliberately two-pass: input nodes establish the
    // state values first, then action nodes can safely read $state.
    try {
      return resolveInitialUiNode(current.ui, then.function, then.args, uiContext(inputs, values, createStringMap<InertValue>()))
    } catch (cause) {
      throw accountAwareUiError(cause)
    }
  }

  function resolveCurrentUi(
    route: string,
    inputs: InertRecord,
    values: readonly InertValue[],
    state: InertRecord,
  ): ResolvedUiNode {
    const current = assertLoaded()
    const context = routeContext(inputs, values)
    const then = resolveRouteThen(current.cam, route, context)
    if (then.namespace !== CAM_UI_NAMESPACE) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM read route must continue to ui namespace: ${route}`)
    }

    try {
      return resolveUiNode(current.ui, then.function, then.args, uiContext(inputs, values, state))
    } catch (cause) {
      throw accountAwareUiError(cause)
    }
  }

  function prepareContractCall(route: string, inputs: InertRecord): CamViewerPreparedContractCall {
    const current = assertLoaded()
    const routeDeclaration = current.cam.routes[route]
    if (routeDeclaration === undefined) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM write route does not exist: ${route}`)
    }
    if (routeDeclaration.kind !== "write") {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM contract action route must be declared as write: ${route}`)
    }
    assertRouteAccountAvailable(current.cam, route)

    const context = routeContext(inputs, [])
    const call = resolveRouteCall(current.cam, route, context)
    if (call === undefined || !isCamNamespaceNameForType(call.namespace, "contract")) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM write route must call a contract namespace: ${route}`)
    }
    const contract = current.contracts[call.namespace]
    if (contract === undefined) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM contract action references unresolved namespace: ${call.namespace}`)
    }

    return {
      route,
      address: contract.address,
      abi: cloneViewerData<ResolvedCamContract["abi"]>(contract.abi, "contract.abi"),
      function: call.function,
      args: call.args,
      then: resolveRouteThen(current.cam, route, context),
    }
  }

  function routeContext(
    inputs: InertRecord,
    outputs: readonly InertValue[],
  ): CamRuntimeContext {
    return createContext({
      host: sessionHost,
      ...(account === undefined ? {} : { account }),
      inputs,
      outputs,
    })
  }

  function uiContext(
    inputs: InertRecord,
    outputs: readonly InertValue[],
    state: InertRecord,
  ): UiRuntimeContext {
    return {
      ...routeContext(inputs, outputs),
      state,
    }
  }

  function assertLoaded(): CamViewerLoadedState {
    if (loadedState === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session is not loaded")
    }

    return loadedState
  }

  function assertRouteAccountAvailable(cam: CamDocument, route: string): void {
    if (account === undefined && routeRequiresAccount(cam, route)) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM route requires an account: ${route}`)
    }
  }

  function accountAwareUiError(cause: unknown): never {
    if (
      account === undefined
      && cause instanceof UiError
      && cause.code === "UI_UNRESOLVED_VALUE"
      && cause.unresolvedRoot === "account"
    ) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "CAM UI requires an account", cause)
    }

    throw cause
  }

  return {
    snapshot,
    load,
    navigate,
    setAccount,
    updateState,
    dispatchAction,
  }
}

function assertStatePatchTargets(ui: ResolvedUiNode, patch: InertRecord): void {
  const renderedInputs = new Set(resolvedUiInputNames(ui))
  for (const name of Object.keys(patch)) {
    if (!renderedInputs.has(name)) {
      throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", `CAM viewer state field has no rendered input: ${name}`)
    }
  }
}

function uiResourceDeclaration(cam: CamDocument, camURI: string): {
  readonly uri: string
  readonly integrity: string
} {
  const ui = cam.namespaces[CAM_UI_NAMESPACE]
  if (ui?.type !== "ui") {
    throw new CamViewerError("CAM_VIEWER_UI_LOAD_FAILED", "CAM manifest does not declare namespaces.ui")
  }

  return {
    uri: resolveCamResourceURI(camURI, ui.uri),
    integrity: ui.integrity,
  }
}

function cloneAccount(source: CamViewerAccount): CamViewerAccount {
  return { address: source.address }
}

function cloneHost(source: CamHost): CamHost {
  return {
    chainId: source.chainId,
    address: source.address,
  }
}

function cloneViewerData<T>(value: T, path: string): T {
  try {
    return toInertValue(value) as T
  } catch (cause) {
    throw new CamViewerError(
      "CAM_VIEWER_INVALID_INERT_VALUE",
      `CAM viewer data is not safely cloneable: ${path}`,
      cause,
    )
  }
}
