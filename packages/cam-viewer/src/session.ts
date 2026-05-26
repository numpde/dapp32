import {
  callCamRoute,
  loadCamFromHost,
  resolveCamContracts,
} from "@cam/evm-viem"
import {
  toInertValue,
} from "@cam/core"
import type { CamDocument, InertValue } from "@cam/core"
import {
  parseScreen,
  resolveScreen,
} from "@cam/screen"
import type { ResolvedCamContract } from "@cam/evm-viem"
import type {
  ResolvedScreen,
  ResolvedScreenAction,
  ScreenDocument,
} from "@cam/screen"

import { CamViewerError } from "./errors.ts"
import type {
  CamViewerAccount,
  CamViewerActionResult,
  CamViewerSession,
  CamViewerSnapshot,
  CreateCamViewerSessionOptions,
} from "./types.ts"

type CamViewerLoadedState = {
  readonly cam: CamDocument
  readonly camURI: string
  readonly contracts: Record<string, ResolvedCamContract>
}

export function createCamViewerSession({
  publicClient,
  host,
  loadResource,
  account: initialAccount,
  params: initialParams,
  state: initialState,
}: CreateCamViewerSessionOptions): CamViewerSession {
  let loadedState: CamViewerLoadedState | undefined
  let route: string | undefined
  let params = cloneViewerData<Record<string, InertValue>>(initialParams, "params")
  let state = cloneViewerData<Record<string, InertValue>>(initialState, "state")
  let account = initialAccount === undefined ? undefined : cloneAccount(initialAccount)
  let screenURI: string | undefined
  let screen: ScreenDocument | undefined
  let resolvedScreen: CamViewerSnapshot["resolvedScreen"]
  let values: readonly InertValue[] | undefined

  function snapshot(): CamViewerSnapshot {
    return {
      ...(route === undefined ? {} : { route }),
      params: cloneViewerData<Record<string, InertValue>>(params, "params"),
      state: cloneViewerData<Record<string, InertValue>>(state, "state"),
      ...(account === undefined ? {} : { account: cloneAccount(account) }),
      ...(screenURI === undefined ? {} : { screenURI }),
      ...(resolvedScreen === undefined
        ? {}
        : { resolvedScreen: cloneViewerData<ResolvedScreen>(resolvedScreen, "resolvedScreen") }),
      ...(values === undefined ? {} : { values: cloneViewerData<readonly InertValue[]>(values, "values") }),
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

  async function navigate(
    nextRoute: string,
    nextParams: Record<string, InertValue>,
  ): Promise<CamViewerSnapshot> {
    assertLoaded()
    return await navigateLoaded(nextRoute, nextParams)
  }

  async function setAccount(nextAccount?: CamViewerAccount): Promise<CamViewerSnapshot> {
    account = nextAccount === undefined ? undefined : cloneAccount(nextAccount)

    if (loadedState === undefined || route === undefined) {
      return snapshot()
    }

    return await navigateLoaded(route, params)
  }

  function setState(patch: Record<string, InertValue>): CamViewerSnapshot {
    state = {
      ...state,
      ...cloneViewerData<Record<string, InertValue>>(patch, "state"),
    }

    if (screen !== undefined && values !== undefined) {
      resolvedScreen = resolveScreen(screen, {
        host,
        ...(account === undefined ? {} : { account }),
        params,
        state,
        values,
      })
    }

    return snapshot()
  }

  async function dispatchAction(action: ResolvedScreenAction): Promise<CamViewerActionResult> {
    assertLoaded()

    if ("route" in action && "params" in action) {
      return {
        type: "navigated",
        snapshot: await navigateLoaded(action.route, action.params),
      }
    }

    if ("contract" in action && "function" in action && "args" in action) {
      return {
        type: "contractCall",
        action,
      }
    }

    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "unsupported CAM viewer action")
  }

  async function navigateLoaded(
    nextRoute: string,
    nextParams: Record<string, InertValue>,
  ): Promise<CamViewerSnapshot> {
    const current = assertLoaded()
    const routeParams = cloneViewerData<Record<string, InertValue>>(nextParams, "params")

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

function cloneAccount(source: CamViewerAccount): CamViewerAccount {
  return { address: source.address }
}

function cloneViewerData<T>(value: T, path: string): T {
  try {
    return structuredClone(toInertValue(value)) as T
  } catch (cause) {
    throw new CamViewerError(
      "CAM_VIEWER_INVALID_INERT_VALUE",
      `CAM viewer data is not safely cloneable: ${path}`,
      { cause },
    )
  }
}
