import {
  callCamRoute,
  loadCamFromHost,
  resolveCamContracts,
} from "@cam/evm-viem"
import {
  hasOwn,
  parseJsonBytes,
  toInertValue,
} from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import type { CamRuntimeContext, InertRecord, InertValue } from "@cam/protocol"
import {
  parseScreen,
  resolveInitialScreen,
  resolveScreen,
} from "@cam/screen"
import type { ResolvedCamContract } from "@cam/evm-viem"
import type {
  ResolvedScreen,
  ResolvedScreenAction,
  ScreenInitialContext,
  ScreenRuntimeContext,
  ScreenDocument,
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
}

type CurrentScreen = {
  readonly route: string
  readonly params: InertRecord
  readonly screenURI: string
  readonly screen: ScreenDocument
  readonly form: InertRecord
  readonly resolvedScreen: ResolvedScreen
  readonly values: readonly InertValue[]
}

export function createCamViewerSession({
  publicClient,
  host,
  loadResource,
  allowUnsignedCamHash,
  account: initialAccount,
  params: initialParams,
}: CreateCamViewerSessionOptions): CamViewerSession {
  let loadedState: CamViewerLoadedState | undefined
  const initialRouteParams = cloneViewerData<InertRecord>(initialParams, "params")
  let account = initialAccount === undefined ? undefined : cloneAccount(initialAccount)
  let currentScreen: CurrentScreen | undefined

  function snapshot(): CamViewerSnapshot {
    if (currentScreen === undefined) {
      return sessionSnapshot(initialRouteParams)
    }

    return loadedSnapshot(currentScreen)
  }

  function sessionSnapshot(params: InertRecord): CamViewerSnapshot {
    return {
      params: cloneViewerData<InertRecord>(params, "params"),
      ...(account === undefined ? {} : { account: cloneAccount(account) }),
    }
  }

  function loadedSnapshot(screen: CurrentScreen): CamViewerLoadedSnapshot {
    return {
      ...sessionSnapshot(screen.params),
      route: screen.route,
      form: cloneViewerData<InertRecord>(screen.form, "form"),
      screenURI: screen.screenURI,
      resolvedScreen: cloneViewerData<ResolvedScreen>(screen.resolvedScreen, "resolvedScreen"),
      values: cloneViewerData<readonly InertValue[]>(screen.values, "values"),
    }
  }

  async function load(): Promise<CamViewerLoadedSnapshot> {
    const loadedCam = await loadCamFromHost({
      publicClient,
      host,
      loadResource,
      allowUnsignedCamHash,
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

    return await navigateLoaded(loadedCam.cam.entry, initialRouteParams)
  }

  async function navigate(
    nextRoute: string,
    nextParams: InertRecord,
  ): Promise<CamViewerLoadedSnapshot> {
    assertLoaded()
    return await navigateLoaded(nextRoute, nextParams)
  }

  async function setAccount(nextAccount?: CamViewerAccount): Promise<CamViewerLoadedSnapshot> {
    const screen = currentScreen
    if (screen === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session has no loaded screen")
    }

    const previousAccount = account
    account = nextAccount === undefined ? undefined : cloneAccount(nextAccount)
    try {
      return await navigateLoaded(screen.route, screen.params)
    } catch (cause) {
      account = previousAccount
      throw cause
    }
  }

  function updateForm(patch: InertRecord): CamViewerLoadedSnapshot {
    if (currentScreen === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session has no loaded screen form")
    }

    const formPatch = cloneViewerData<InertRecord>(patch, "form")
    assertKnownFormFields(currentScreen.form, formPatch)
    const form = cloneViewerData<InertRecord>(
      {
        ...currentScreen.form,
        ...formPatch,
      },
      "form",
    )
    const resolvedScreen = resolveScreen(
      currentScreen.screen,
      screenContext(currentScreen.params, currentScreen.values, form),
    )
    currentScreen = {
      ...currentScreen,
      form,
      resolvedScreen,
    }

    return loadedSnapshot(currentScreen)
  }

  async function dispatchAction(action: ResolvedScreenAction): Promise<CamViewerActionResult> {
    assertLoaded()

    if (action.type === "navigate") {
      return {
        type: "navigated",
        snapshot: await navigateLoaded(action.route, action.params),
      }
    }

    if (action.type === "contract-call") {
      return {
        type: "contractCall",
        call: prepareContractCall(action),
      }
    }

    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "unsupported CAM viewer action")
  }

  async function navigateLoaded(
    nextRoute: string,
    nextParams: InertRecord,
  ): Promise<CamViewerLoadedSnapshot> {
    const current = assertLoaded()
    const routeParams = cloneViewerData<InertRecord>(nextParams, "params")

    const routeResult = await callCamRoute({
      publicClient,
      cam: current.cam,
      camURI: current.camURI,
      contracts: current.contracts,
      route: nextRoute,
      context: routeContext(routeParams),
    })

    const screenBytes = await loadScreenBytes(routeResult.screenURI)
    const parsedScreen = parseScreenBytes(screenBytes, routeResult.screenURI)
    const initialScreen = resolveInitialScreen(
      parsedScreen,
      screenBaseContext(routeParams, routeResult.values),
    )

    currentScreen = {
      route: nextRoute,
      params: routeParams,
      screenURI: routeResult.screenURI,
      screen: parsedScreen,
      form: initialScreen.form,
      resolvedScreen: initialScreen.resolvedScreen,
      values: routeResult.values,
    }

    return loadedSnapshot(currentScreen)
  }

  async function loadScreenBytes(uri: string): Promise<Uint8Array> {
    try {
      return await loadResource(uri)
    } catch (cause) {
      throw new CamViewerError(
        "CAM_VIEWER_SCREEN_LOAD_FAILED",
        `failed to load CAM screen resource: ${uri}`,
        cause,
      )
    }
  }

  function parseScreenBytes(bytes: Uint8Array, uri: string): ScreenDocument {
    try {
      return parseScreen(parseJsonBytes(bytes))
    } catch (cause) {
      throw new CamViewerError(
        "CAM_VIEWER_SCREEN_PARSE_FAILED",
        `failed to parse CAM screen resource: ${uri}`,
        cause,
      )
    }
  }

  function assertLoaded(): CamViewerLoadedState {
    if (loadedState === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session is not loaded")
    }

    return loadedState
  }

  function prepareContractCall(action: Extract<ResolvedScreenAction, { readonly type: "contract-call" }>): CamViewerPreparedContractCall {
    const current = assertLoaded()
    const contract = current.contracts[action.contract]
    if (contract === undefined) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM contract action references unresolved contract: ${action.contract}`)
    }

    return {
      contract: action.contract,
      address: contract.address,
      abi: cloneViewerData<ResolvedCamContract["abi"]>(contract.abi, "contract.abi"),
      function: action.function,
      args: cloneViewerData<readonly InertValue[]>(action.args, "action.args"),
      ...(action.onSuccess === undefined
        ? {}
        : { onSuccess: cloneViewerData<NonNullable<typeof action.onSuccess>>(action.onSuccess, "action.onSuccess") }),
    }
  }

  function routeContext(routeParams: InertRecord): CamRuntimeContext {
    return {
      host,
      ...(account === undefined ? {} : { account }),
      params: routeParams,
    }
  }

  function screenContext(
    routeParams: InertRecord,
    routeValues: readonly InertValue[],
    screenForm: InertRecord,
  ): ScreenRuntimeContext {
    return {
      ...screenBaseContext(routeParams, routeValues),
      form: screenForm,
    }
  }

  function screenBaseContext(
    routeParams: InertRecord,
    routeValues: readonly InertValue[],
  ): ScreenInitialContext {
    return {
      ...routeContext(routeParams),
      values: routeValues,
    }
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

function cloneAccount(source: CamViewerAccount): CamViewerAccount {
  return { address: source.address }
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

function assertKnownFormFields(form: InertRecord, patch: InertRecord): void {
  for (const key of Object.keys(patch)) {
    if (!hasOwn(form, key)) {
      throw new CamViewerError("CAM_VIEWER_UNKNOWN_FORM_FIELD", `CAM screen form has no field named: ${key}`)
    }
  }
}
