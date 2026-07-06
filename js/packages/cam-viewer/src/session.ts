import {
  loadCamFromHost,
  requireEvmAddress,
  requireEvmChainId,
  resolveCamContracts,
  verifyCamResourceIntegrity,
} from "@cam/evm-viem"
import {
  assertCamResourceSize,
  CAM_UI_NAMESPACE,
  parseJsonBytes,
  resolveCamResourceURI,
  toInertValue,
} from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import type { InertRecord, InertValue } from "@cam/protocol"
import {
  parseUi,
} from "@cam/screen"
import type { CamHost, ResolvedCamContract } from "@cam/evm-viem"
import type {
  ResolvedButtonNode,
  ResolvedUiNode,
  UiDocument,
} from "@cam/screen"

import { CamViewerError } from "./errors.ts"
import {
  assertActionIsRendered,
  assertStatePatchTargets,
  interpretRenderedAction,
} from "./interactions.ts"
import {
  resolveViewerCurrentUi,
} from "./ui-resolution.ts"
import { resolveViewerReadRoute } from "./read-resolution.ts"
import type { ViewerResolvedReadView } from "./read-resolution.ts"
import { prepareViewerContractCall } from "./write-preparation.ts"
import type {
  CamViewerAccount,
  CamViewerActionResult,
  CamViewerLoadedSnapshot,
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

type CurrentView = ViewerResolvedReadView

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
    const current = assertLoaded()
    const view = assertCurrentView()
    assertActionIsRendered(view.resolvedUi, action)
    const interpretation = interpretRenderedAction(current.cam, action)

    if (interpretation.type === "navigate") {
      return {
        type: "navigated",
        snapshot: await navigateLoaded(interpretation.route, interpretation.inputs),
      }
    }

    return {
      type: "contractCall",
      call: prepareViewerContractCall({
        cam: current.cam,
        contracts: current.contracts,
        host: sessionHost,
        ...(account === undefined ? {} : { account }),
        route: interpretation.route,
        inputs: interpretation.inputs,
      }),
    }
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
    return await resolveViewerReadRoute({
      publicClient,
      cam: current.cam,
      contracts: current.contracts,
      ui: current.ui,
      host: sessionHost,
      ...(account === undefined ? {} : { account }),
      route: nextRoute,
      inputs: routeInputs,
    })
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

  function resolveCurrentUi(
    route: string,
    inputs: InertRecord,
    values: readonly InertValue[],
    state: InertRecord,
  ): ResolvedUiNode {
    const current = assertLoaded()
    return resolveViewerCurrentUi({
      cam: current.cam,
      ui: current.ui,
      host: sessionHost,
      ...(account === undefined ? {} : { account }),
      route,
      inputs,
      values,
      state,
    })
  }

  function assertLoaded(): CamViewerLoadedState {
    if (loadedState === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session is not loaded")
    }

    return loadedState
  }

  function assertCurrentView(): CurrentView {
    if (currentView === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session has no loaded view")
    }

    return currentView
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
  return { address: requireEvmAddress(source.address, "account.address") }
}

function cloneHost(source: CamHost): CamHost {
  return {
    chainId: requireEvmChainId(source.chainId),
    address: requireEvmAddress(source.address, "host.address"),
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
