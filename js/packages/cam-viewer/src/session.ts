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
    return {
      params: cloneViewerData<InertRecord>(currentScreen?.params ?? initialRouteParams, "params"),
      ...(account === undefined ? {} : { account: cloneAccount(account) }),
      ...(currentScreen === undefined
        ? {}
        : {
            route: currentScreen.route,
            form: cloneViewerData<InertRecord>(currentScreen.form, "form"),
            screenURI: currentScreen.screenURI,
            resolvedScreen: cloneViewerData<ResolvedScreen>(currentScreen.resolvedScreen, "resolvedScreen"),
            values: cloneViewerData<readonly InertValue[]>(currentScreen.values, "values"),
          }),
    }
  }

  async function load(): Promise<CamViewerSnapshot> {
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
  ): Promise<CamViewerSnapshot> {
    assertLoaded()
    return await navigateLoaded(nextRoute, nextParams)
  }

  async function setAccount(nextAccount?: CamViewerAccount): Promise<CamViewerSnapshot> {
    account = nextAccount === undefined ? undefined : cloneAccount(nextAccount)

    if (loadedState === undefined || currentScreen === undefined) {
      return snapshot()
    }

    return await navigateLoaded(currentScreen.route, currentScreen.params)
  }

  function updateForm(patch: InertRecord): CamViewerSnapshot {
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

    return snapshot()
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
  ): Promise<CamViewerSnapshot> {
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

    return snapshot()
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
