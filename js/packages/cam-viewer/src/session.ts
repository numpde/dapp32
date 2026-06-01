import {
  callCamRoute,
  loadCamFromHost,
  resolveCamContracts,
} from "@cam/evm-viem"
import {
  createStringMap,
  parseJsonBytes,
  toInertValue,
} from "@cam/protocol"
import {
  resolveResourceURI,
  resolveRouteCall,
  resolveRouteThen,
} from "@cam/core"
import type { CamDocument } from "@cam/core"
import type { CamRuntimeContext, InertRecord, InertValue } from "@cam/protocol"
import {
  parseUi,
  resolveInitialUiNode,
  resolveUiNode,
} from "@cam/screen"
import type { CamHost, ResolvedCamContract } from "@cam/evm-viem"
import type {
  ResolvedActionNode,
  ResolvedUiCall,
  ResolvedUiNode,
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
  readonly form: InertRecord
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
      form: cloneViewerData<InertRecord>(view.form, "form"),
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

    const uiURI = uiResourceURI(loadedCam.cam, loadedCam.camURI)
    const ui = await loadUi(uiURI)

    loadedState = {
      cam: loadedCam.cam,
      camURI: loadedCam.camURI,
      contracts,
      uiURI,
      ui,
    }

    return await navigateLoaded(loadedCam.cam.entry, initialRouteInputs)
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

  function updateForm(patch: InertRecord): CamViewerLoadedSnapshot {
    if (currentView === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session has no loaded form")
    }

    const formPatch = cloneViewerData<InertRecord>(patch, "form")
    const form = cloneViewerData<InertRecord>(
      {
        ...currentView.form,
        ...formPatch,
      },
      "form",
    )

    const resolvedUi = resolveCurrentUi(currentView.route, currentView.inputs, currentView.values, form)
    currentView = {
      ...currentView,
      form,
      resolvedUi,
    }

    return loadedSnapshot(currentView)
  }

  async function dispatchAction(action: ResolvedActionNode): Promise<CamViewerActionResult> {
    assertLoaded()

    if (action.call.namespace !== "routes") {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM action must call routes namespace: ${action.call.namespace}`)
    }

    const route = action.call.function
    const camRoute = assertLoaded().cam.routes[route]
    if (camRoute === undefined) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM action references unknown route: ${route}`)
    }

    const targetNamespace = camRoute.then.namespace
    if (targetNamespace === "ui") {
      return {
        type: "navigated",
        snapshot: await navigateLoaded(route, action.call.args),
      }
    }

    if (targetNamespace === "routes") {
      return {
        type: "contractCall",
        call: prepareContractCall(route, action.call.args),
      }
    }

    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `unsupported CAM route continuation: ${targetNamespace}`)
  }

  async function navigateLoaded(nextRoute: string, nextInputs: InertRecord): Promise<CamViewerLoadedSnapshot> {
    const current = assertLoaded()
    const routeInputs = cloneViewerData<InertRecord>(nextInputs, "inputs")

    const routeResult = await callCamRoute({
      publicClient,
      cam: current.cam,
      contracts: current.contracts,
      route: nextRoute,
      context: routeContext(routeInputs, [], activeForm()),
    })

    const initial = resolveInitialUi(current.cam, nextRoute, routeInputs, routeResult.values)
    currentView = {
      route: nextRoute,
      inputs: routeInputs,
      form: initial.form,
      resolvedUi: initial.resolvedUi,
      values: routeResult.values,
    }

    return loadedSnapshot(currentView)
  }

  async function loadUi(uri: string): Promise<UiDocument> {
    let bytes: Uint8Array
    try {
      bytes = await loadResource(uri)
    } catch (cause) {
      throw new CamViewerError("CAM_VIEWER_SCREEN_LOAD_FAILED", `failed to load CAM UI resource: ${uri}`, cause)
    }

    try {
      return parseUi(parseJsonBytes(bytes))
    } catch (cause) {
      throw new CamViewerError("CAM_VIEWER_SCREEN_PARSE_FAILED", `failed to parse CAM UI resource: ${uri}`, cause)
    }
  }

  function resolveInitialUi(
    cam: CamDocument,
    route: string,
    inputs: InertRecord,
    values: readonly InertValue[],
  ): {
    readonly form: InertRecord
    readonly resolvedUi: ResolvedUiNode
  } {
    const current = assertLoaded()
    const context = routeContext(inputs, values, activeForm())
    const then = resolveRouteThen(cam, route, context)
    if (then.namespace !== "ui") {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM read route must continue to ui namespace: ${route}`)
    }

    // UI initial resolution is deliberately two-pass: input nodes establish the
    // form values first, then action nodes can safely read $form.
    return resolveInitialUiNode(current.ui, then.function, then.args, context)
  }

  function resolveCurrentUi(
    route: string,
    inputs: InertRecord,
    values: readonly InertValue[],
    form: InertRecord,
  ): ResolvedUiNode {
    const current = assertLoaded()
    const context = routeContext(inputs, values, form)
    const then = resolveRouteThen(current.cam, route, context)
    if (then.namespace !== "ui") {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM read route must continue to ui namespace: ${route}`)
    }

    return resolveUiNode(current.ui, then.function, then.args, context)
  }

  function prepareContractCall(route: string, inputs: InertRecord): CamViewerPreparedContractCall {
    const current = assertLoaded()
    if (current.cam.routes[route] === undefined) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM write route does not exist: ${route}`)
    }

    const context = routeContext(inputs, [], activeForm())
    const call = resolveRouteCall(current.cam, route, context)
    if (call === undefined || !call.namespace.startsWith("contracts.")) {
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
    form: InertRecord,
  ): CamRuntimeContext {
    return {
      host: sessionHost,
      ...(account === undefined ? {} : { account }),
      inputs,
      outputs,
      form,
    }
  }

  function activeForm(): InertRecord {
    if (currentView !== undefined) {
      return currentView.form
    }

    // Route calls can run before any UI has been resolved, so there may be no
    // form yet. Use an explicit empty inert record instead of hiding this as a
    // nullable snapshot fallback.
    return createStringMap<InertValue>()
  }

  function assertLoaded(): CamViewerLoadedState {
    if (loadedState === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session is not loaded")
    }

    return loadedState
  }

  return {
    snapshot,
    load,
    navigate,
    setAccount,
    updateForm,
    dispatchAction,
  }
}

function uiResourceURI(cam: CamDocument, camURI: string): string {
  const ui = cam.namespaces.ui
  if (ui?.type !== "ui") {
    throw new CamViewerError("CAM_VIEWER_SCREEN_LOAD_FAILED", "CAM manifest does not declare namespaces.ui")
  }

  return resolveResourceURI(camURI, ui.uri)
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
