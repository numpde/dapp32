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
  resolvedUiInputNames,
  forEachResolvedUiNode,
  editAmountDraft,
  projectAmountDraft,
  sameAmountUnit,
} from "@cam/screen"
import type { CamHost, ResolvedCamContract } from "@cam/evm-viem"
import type {
  AmountDraft,
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

type CurrentView = ViewerResolvedReadView & { readonly amountDrafts: Record<string, AmountDraft> }
type PreviousView = Pick<CurrentView, "route" | "inputs" | "state" | "amountDrafts">
const HISTORY_LIMIT = 20

export function createCamViewerSession({
  publicClient,
  host,
  loadResource,
  allowUnsignedCamHash,
  account: initialAccount,
  inputs: initialInputs,
  route: initialRoute,
}: CreateCamViewerSessionOptions): CamViewerSession {
  const sessionHost = cloneHost(host)
  const initialRouteInputs = cloneViewerData<InertRecord>(initialInputs, "inputs")
  let account = initialAccount === undefined ? undefined : cloneAccount(initialAccount)
  let loadedState: CamViewerLoadedState | undefined
  let currentView: CurrentView | undefined
  const history: PreviousView[] = []
  let changingView = false

  function snapshot(): CamViewerSnapshot {
    if (currentView === undefined) {
      return sessionSnapshot(initialRouteInputs)
    }

    return loadedSnapshot(currentView)
  }

  function sessionSnapshot(inputs: InertRecord): CamViewerSnapshot {
    return {
      canGoBack: history.length > 0,
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
    const route = initialRoute === undefined ? loadedCam.cam.entry : initialRoute
    const nextView = await resolveLoadedView(nextLoadedState, route, initialRouteInputs, account)

    loadedState = nextLoadedState
    currentView = nextView
    history.length = 0

    return loadedSnapshot(currentView)
  }

  async function navigate(nextRoute: string | undefined, nextInputs: InertRecord): Promise<CamViewerLoadedSnapshot> {
    const current = assertLoaded()
    const route = nextRoute === undefined ? current.cam.entry : nextRoute
    return await navigateLoaded(route, nextInputs)
  }

  async function back(): Promise<CamViewerLoadedSnapshot> {
    const current = assertLoaded()
    const previous = history.at(-1)
    if (previous === undefined) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "Cannot go back: there is no previous view")
    }
    const refreshed = await resolveLoadedView(current, previous.route, previous.inputs, account)
    const state = { ...refreshed.state }
    const amountDrafts = { ...refreshed.amountDrafts }
    for (const name of resolvedUiInputNames(refreshed.resolvedUi)) {
      const fresh = Object.hasOwn(amountDrafts, name) ? amountDrafts[name] : undefined
      if (fresh !== undefined) {
        const saved = Object.hasOwn(previous.amountDrafts, name) ? previous.amountDrafts[name] : undefined
        if (saved !== undefined && sameAmountUnit(saved.unit, fresh.unit)) {
          amountDrafts[name] = saved
          state[name] = projectAmountDraft(saved).canonical
        }
      } else if (Object.hasOwn(previous.state, name) && !Object.hasOwn(previous.amountDrafts, name)) state[name] = previous.state[name]
    }
    const resolvedUi = resolveCurrentUi(refreshed.route, refreshed.inputs, refreshed.values, state, amountDrafts)
    currentView = { ...refreshed, state, resolvedUi, amountDrafts }
    history.pop()
    return loadedSnapshot(currentView)
  }

  async function setAccount(nextAccount?: CamViewerAccount): Promise<CamViewerLoadedSnapshot> {
    const view = currentView
    if (view === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session has no loaded view")
    }

    const candidateAccount = nextAccount === undefined ? undefined : cloneAccount(nextAccount)
    const nextView = await resolveLoadedView(assertLoaded(), view.route, view.inputs, candidateAccount)
    account = candidateAccount
    currentView = nextView
    history.length = 0
    return loadedSnapshot(nextView)
  }

  function updateState(patch: InertRecord): CamViewerLoadedSnapshot {
    return editState(patch)
  }

  function editAmount(name: string, representation: "base" | "display", text: string, options?: { readonly composing?: boolean }): CamViewerLoadedSnapshot {
    if (representation !== "base" && representation !== "display" || typeof text !== "string" || typeof name !== "string" || options !== undefined && (typeof options !== "object" || options === null || Object.keys(options).some((key) => key !== "composing") || options.composing !== undefined && typeof options.composing !== "boolean")) {
      throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", "Amount edit requires a field name, base or display representation, text, and optional composing boolean")
    }
    const view = assertCurrentView()
    if (!Object.hasOwn(view.amountDrafts, name)) throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", `Amount field is not rendered: ${name}`)
    return editState({ [name]: text }, { name, representation, composing: options?.composing === true })
  }

  function editState(patch: InertRecord, amountEdit?: { name: string; representation: "base" | "display"; composing: boolean }): CamViewerLoadedSnapshot {
    assertViewAvailable()
    if (currentView === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session has no loaded state")
    }

    const statePatch = cloneViewerData<InertRecord>(patch, "state")
    assertStatePatchTargets(currentView.resolvedUi, statePatch)
    const state = cloneViewerData<Record<string, InertValue>>(
      {
        ...currentView.state,
        ...statePatch,
      },
      "state",
    )
    const amountDrafts = { ...currentView.amountDrafts }
    for (const [name, text] of Object.entries(statePatch)) {
      const previous = Object.hasOwn(amountDrafts, name) ? amountDrafts[name] : undefined
      if (previous === undefined) continue
      if (typeof text !== "string") throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", `Amount field edit must be a string: ${name}`)
      const draft = editAmountDraft(previous.unit, amountEdit?.name === name ? amountEdit.representation : "base", text, amountEdit?.name === name && amountEdit.composing)
      amountDrafts[name] = draft
      state[name] = projectAmountDraft(draft).canonical
    }

    const resolvedUi = resolveCurrentUi(currentView.route, currentView.inputs, currentView.values, state, amountDrafts)
    const nextView: CurrentView = {
      ...currentView,
      state,
      resolvedUi,
      amountDrafts,
    }

    currentView = nextView
    return loadedSnapshot(currentView)
  }

  async function dispatchAction(action: ResolvedButtonNode): Promise<CamViewerActionResult> {
    assertViewAvailable()
    const current = assertLoaded()
    const view = assertCurrentView()
    assertActionIsRendered(view.resolvedUi, action)
    const interpretation = interpretRenderedAction(current.cam, action)

    if (interpretation.type === "navigate") {
      return {
        type: "navigated",
        snapshot: await changeView(() => navigateLoaded(interpretation.route, interpretation.inputs)),
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
    const nextView = await resolveLoadedView(current, nextRoute, nextInputs, account)

    const previous = assertCurrentView()
    history.push({ route: previous.route, inputs: previous.inputs, state: previous.state, amountDrafts: previous.amountDrafts })
    if (history.length > HISTORY_LIMIT) history.shift()
    currentView = nextView

    return loadedSnapshot(currentView)
  }

  async function resolveLoadedView(
    current: CamViewerLoadedState,
    nextRoute: string,
    nextInputs: InertRecord,
    viewAccount: CamViewerAccount | undefined,
  ): Promise<CurrentView> {
    const routeInputs = cloneViewerData<InertRecord>(nextInputs, "inputs")
    const view = await resolveViewerReadRoute({
      publicClient,
      cam: current.cam,
      contracts: current.contracts,
      ui: current.ui,
      host: sessionHost,
      ...(viewAccount === undefined ? {} : { account: viewAccount }),
      route: nextRoute,
      inputs: routeInputs,
    })
    const amountDrafts = Object.create(null) as Record<string, AmountDraft>
    forEachResolvedUiNode(view.resolvedUi, (node) => {
      if (node.element !== "AmountField") return
      amountDrafts[node.state.key] = editAmountDraft(node.unit, node.draft.representation, node.draft.representation === "base" ? node.draft.baseText : node.draft.displayText)
    })
    return { ...view, amountDrafts }
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
    amountDrafts: Record<string, AmountDraft>,
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
      amountDrafts,
    })
  }

  function assertLoaded(): CamViewerLoadedState {
    if (loadedState === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session is not loaded")
    }

    return loadedState
  }

  function assertViewAvailable(): void {
    if (changingView) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "Cannot change the view while another navigation is in progress; wait for it to finish")
    }
  }

  async function changeView(operation: () => Promise<CamViewerLoadedSnapshot>): Promise<CamViewerLoadedSnapshot> {
    assertViewAvailable()
    changingView = true
    try {
      return await operation()
    } finally {
      changingView = false
    }
  }

  function assertCurrentView(): CurrentView {
    if (currentView === undefined) {
      throw new CamViewerError("CAM_VIEWER_NOT_LOADED", "CAM viewer session has no loaded view")
    }

    return currentView
  }

  return {
    snapshot,
    load: () => changeView(load),
    back: () => changeView(back),
    navigate: (route, inputs) => changeView(() => navigate(route, inputs)),
    setAccount: (nextAccount) => changeView(() => setAccount(nextAccount)),
    updateState,
    editAmount,
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
