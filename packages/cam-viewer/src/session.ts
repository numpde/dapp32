import {
  callCamRoute,
  loadCamFromHost,
  resolveCamContracts,
} from "@cam/evm-viem"
import {
  parseScreen,
  resolveScreen,
} from "@cam/screen"
import type {
  ContractCallAction,
  ScreenDocument,
} from "@cam/screen"

import { CamViewerError } from "./errors.ts"
import type {
  CamViewerAccount,
  CamViewerActionResult,
  CamViewerLoadedState,
  CamViewerSession,
  CamViewerSnapshot,
  CreateCamViewerSessionOptions,
} from "./types.ts"

export function createCamViewerSession({
  publicClient,
  host,
  loadResource,
  account: initialAccount,
  params: initialParams = {},
  state: initialState = {},
}: CreateCamViewerSessionOptions): CamViewerSession {
  let loadedState: CamViewerLoadedState | undefined
  let route: string | undefined
  let params = copyRecord(initialParams)
  let state = copyRecord(initialState)
  let account = initialAccount
  let screenURI: string | undefined
  let screen: CamViewerSnapshot["screen"]
  let resolvedScreen: CamViewerSnapshot["resolvedScreen"]
  let values: readonly unknown[] | undefined

  function snapshot(): CamViewerSnapshot {
    return {
      loaded: loadedState !== undefined,
      ...(route === undefined ? {} : { route }),
      params: copyRecord(params),
      state: copyRecord(state),
      ...(account === undefined ? {} : { account }),
      ...(screenURI === undefined ? {} : { screenURI }),
      ...(screen === undefined ? {} : { screen }),
      ...(resolvedScreen === undefined ? {} : { resolvedScreen }),
      ...(values === undefined ? {} : { values }),
    }
  }

  async function load(): Promise<CamViewerSnapshot> {
    const loadedCam = await loadCamFromHost({
      publicClient,
      host,
      loadResource,
    })

    const contracts = await resolveCamContracts({
      publicClient,
      host,
      camURI: loadedCam.camURI,
      cam: loadedCam.cam,
      loadResource,
    })

    loadedState = {
      cam: loadedCam.cam,
      camURI: loadedCam.camURI,
      contracts,
    }

    return await navigateLoaded(loadedCam.cam.entry, params)
  }

  async function navigate(nextRoute: string, nextParams: Record<string, unknown> = params): Promise<CamViewerSnapshot> {
    assertLoaded()
    return await navigateLoaded(nextRoute, nextParams)
  }

  async function setAccount(nextAccount?: CamViewerAccount): Promise<CamViewerSnapshot> {
    account = nextAccount

    if (loadedState === undefined || route === undefined) {
      return snapshot()
    }

    return await navigateLoaded(route, params)
  }

  function setState(patch: Record<string, unknown>): CamViewerSnapshot {
    state = {
      ...state,
      ...patch,
    }

    return snapshot()
  }

  async function dispatchAction(action: unknown): Promise<CamViewerActionResult> {
    assertLoaded()

    if (isNavigateAction(action)) {
      return {
        type: "navigated",
        snapshot: await navigateLoaded(action.route, action.params),
      }
    }

    if (isContractCallAction(action)) {
      return {
        type: "contractCall",
        action,
      }
    }

    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "unsupported CAM viewer action")
  }

  async function navigateLoaded(nextRoute: string, nextParams: Record<string, unknown>): Promise<CamViewerSnapshot> {
    const current = assertLoaded()
    const routeParams = copyRecord(nextParams)

    const routeResult = await callCamRoute({
      publicClient,
      cam: current.cam,
      camURI: current.camURI,
      contracts: current.contracts,
      route: nextRoute,
      context: {
        host,
        ...(account === undefined ? {} : { account }),
        params: routeParams,
      },
    })

    const screenBytes = await loadScreenBytes(routeResult.screenURI)
    const parsedScreen = parseScreenBytes(screenBytes, routeResult.screenURI)
    const nextResolvedScreen = resolveScreen(parsedScreen, {
      host,
      ...(account === undefined ? {} : { account }),
      params: routeParams,
      state,
      values: routeResult.values,
    })

    route = nextRoute
    params = routeParams
    screenURI = routeResult.screenURI
    screen = parsedScreen
    resolvedScreen = nextResolvedScreen
    values = routeResult.values

    return snapshot()
  }

  async function loadScreenBytes(uri: string): Promise<Uint8Array> {
    try {
      return await loadResource(uri)
    } catch (cause) {
      throw new CamViewerError(
        "CAM_VIEWER_SCREEN_LOAD_FAILED",
        `failed to load CAM screen resource: ${uri}`,
        { cause },
      )
    }
  }

  function parseScreenBytes(bytes: Uint8Array, uri: string): ScreenDocument {
    try {
      return parseScreen(JSON.parse(new TextDecoder().decode(bytes)))
    } catch (cause) {
      throw new CamViewerError(
        "CAM_VIEWER_SCREEN_PARSE_FAILED",
        `failed to parse CAM screen resource: ${uri}`,
        { cause },
      )
    }
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
    setState,
    dispatchAction,
  }
}

function copyRecord(source: Record<string, unknown>): Record<string, unknown> {
  return { ...source }
}

function isNavigateAction(action: unknown): action is { readonly route: string; readonly params: Record<string, unknown> } {
  return isRecord(action)
    && typeof action.route === "string"
    && isRecord(action.params)
}

function isContractCallAction(action: unknown): action is ContractCallAction {
  return isRecord(action)
    && typeof action.contract === "string"
    && typeof action.function === "string"
    && Array.isArray(action.args)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
