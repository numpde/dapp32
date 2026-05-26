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
  ScreenElement,
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
  // TODO(silent-defaults): empty params/state are convenient for the entry
  // route, but they also hide whether the host intentionally supplied context.
  // Consider requiring explicit params/state once route schemas exist.
  params: initialParams = {},
  state: initialState = {},
}: CreateCamViewerSessionOptions): CamViewerSession {
  let loadedState: CamViewerLoadedState | undefined
  let route: string | undefined
  let params = cloneRecord(initialParams, "params")
  let state = cloneRecord(initialState, "state")
  let account = initialAccount === undefined ? undefined : cloneAccount(initialAccount)
  let screenURI: string | undefined
  let screen: CamViewerSnapshot["screen"]
  let resolvedScreen: CamViewerSnapshot["resolvedScreen"]
  let values: readonly InertValue[] | undefined

  function snapshot(): CamViewerSnapshot {
    return {
      loaded: loadedState !== undefined,
      ...(route === undefined ? {} : { route }),
      params: cloneRecord(params, "params"),
      state: cloneRecord(state, "state"),
      ...(account === undefined ? {} : { account: cloneAccount(account) }),
      ...(screenURI === undefined ? {} : { screenURI }),
      ...(screen === undefined ? {} : { screen: cloneValue(screen, "screen") as ScreenDocument }),
      ...(resolvedScreen === undefined
        ? {}
        : { resolvedScreen: cloneValue(resolvedScreen, "resolvedScreen") as ResolvedScreen }),
      ...(values === undefined ? {} : { values: cloneArray(values, "values") }),
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
    nextParams: Record<string, InertValue> = params,
  ): Promise<CamViewerSnapshot> {
    // TODO(silent-defaults): defaulting to the current params makes route
    // changes concise, but can accidentally carry stale params across routes.
    // Revisit when route params are explicit protocol data.
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
      ...cloneRecord(patch, "state"),
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
    const routeParams = cloneRecord(nextParams, "params")

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
    state = seedInputState(parsedScreen, state)
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

function cloneRecord(source: Record<string, InertValue>, path: string): Record<string, InertValue> {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, cloneViewerInertValue(value, `${path}.${key}`)]),
  )
}

function cloneArray(source: readonly InertValue[], path: string): readonly InertValue[] {
  return source.map((value, index) => cloneViewerInertValue(value, `${path}.${index}`))
}

function cloneViewerInertValue(value: InertValue, path: string): InertValue {
  try {
    return toInertValue(value)
  } catch (cause) {
    throw new CamViewerError(
      "CAM_VIEWER_INVALID_SNAPSHOT",
      `CAM viewer data is not safely cloneable: ${path}`,
      { cause },
    )
  }
}

function cloneValue(value: unknown, path: string): unknown {
  if (Array.isArray(value)) {
    return cloneUnknownArray(value, path)
  }

  if (isPlainRecord(value)) {
    return clonePlainRecord(value, path)
  }

  if (
    value !== null
    && typeof value === "object"
  ) {
    throw new CamViewerError(
      "CAM_VIEWER_INVALID_SNAPSHOT",
      `CAM viewer data is not safely cloneable: ${path}`,
    )
  }

  return value
}

function cloneUnknownArray(source: readonly unknown[], path: string): readonly unknown[] {
  return source.map((value, index) => cloneValue(value, `${path}.${index}`))
}

function clonePlainRecord(source: Record<string, unknown>, path: string): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).map(([key, value]) => [key, cloneValue(value, `${path}.${key}`)]),
  )
}

function seedInputState(screen: ScreenDocument, currentState: Record<string, InertValue>): Record<string, InertValue> {
  const nextState = { ...currentState }
  for (const element of screen.elements) {
    seedInputElementState(element, nextState)
  }

  return nextState
}

function seedInputElementState(element: ScreenElement, state: Record<string, InertValue>): void {
  if (element.type !== "input" || Object.hasOwn(state, element.name)) {
    return
  }

  // TODO(silent-defaults): defaulting unresolved input values to "" is UI
  // behavior embedded in the headless session. A renderer-owned state layer may
  // be the better place for this default.
  state[element.name] = typeof element.value === "string" && !element.value.startsWith("$")
    ? element.value
    : ""
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
