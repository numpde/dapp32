import {
  loadCamFromHost,
  requireEvmAddress,
  requireEvmChainId,
  resolveCamContracts,
  verifyCamResourceIntegrity,
} from "@cam/evm-viem"
import {
  assertCamResourceSize,
  isDocumentHashDigest,
  isRecordObject,
  CAM_UI_NAMESPACE,
  parseJsonBytes,
  resolveCamResourceURI,
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
  editIntegerDraft,
  projectIntegerDraft,
  DURATION_PARTS,
  durationDraftFromSeconds,
  editDurationDraft,
  projectDurationDraft,
} from "@cam/screen"
import type { CamHost, ResolvedCamContract } from "@cam/evm-viem"
import type {
  NumericDraft,
  DurationPart,
  ResolvedButtonNode,
  ResolvedDocumentHashFieldNode,
  ResolvedUiNode,
  UiDocument,
} from "@cam/screen"

import { CamViewerError } from "./errors.ts"
import { cloneViewerData } from "./inert-data.ts"
import {
  assertActionIsRendered,
  assertStatePatchTargets,
  interpretRenderedAction,
  renderedActionKind,
} from "./interactions.ts"
import {
  resolveViewerCurrentUi,
} from "./ui-resolution.ts"
import { resolveViewerReadRoute } from "./read-resolution.ts"
import type { ViewerResolvedReadView } from "./read-resolution.ts"
import { prepareViewerContractCall } from "./write-preparation.ts"
import type {
  CamViewerAccount,
  CamViewerDocumentHashStatus,
  CamViewerDocumentHashOperation,
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

type CurrentView = ViewerResolvedReadView & { readonly numericDrafts: Record<string, NumericDraft> }
type PreviousView = Pick<CurrentView, "route" | "inputs" | "state" | "numericDrafts">
const HISTORY_LIMIT = 20

export function createCamViewerSession({
  publicClient,
  host,
  loadResource,
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
  let writePreparationRevision = 0
  const documentHashes: Record<string, CamViewerDocumentHashStatus> = Object.create(null)
  const documentHashOperations = new Map<string, AbortController>()

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
      documentHashes: cloneViewerData(documentHashes, "documentHashes"),
      route: view.route,
      state: cloneViewerData<InertRecord>(view.state, "state"),
      uiURI: current.uiURI,
      resolvedUi: cloneViewerData<ResolvedUiNode>(view.resolvedUi, "resolvedUi"),
      values: cloneViewerData<readonly InertValue[]>(view.values, "values"),
    }
  }

  async function load(): Promise<CamViewerLoadedSnapshot> {
    writePreparationRevision += 1
    const loadedCam = await loadCamFromHost({
      publicClient,
      host: sessionHost,
      loadResource,
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
    writePreparationRevision += 1
    const current = assertLoaded()
    const previous = history.at(-1)
    if (previous === undefined) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "Cannot go back: there is no previous view")
    }
    const refreshed = await resolveLoadedView(current, previous.route, previous.inputs, account)
    currentView = restoreDrafts(previous, refreshed)
    history.pop()
    return loadedSnapshot(currentView)
  }

  async function refresh(): Promise<CamViewerLoadedSnapshot> {
    writePreparationRevision += 1
    const view = assertCurrentView()
    const refreshed = await resolveLoadedView(assertLoaded(), view.route, view.inputs, account)
    currentView = restoreDrafts(view, refreshed)
    return loadedSnapshot(currentView)
  }

  function restoreDrafts(previous: PreviousView, refreshed: CurrentView): CurrentView {
    const state = { ...refreshed.state }
    const numericDrafts = { ...refreshed.numericDrafts }
    for (const name of resolvedUiInputNames(refreshed.resolvedUi)) {
      const fresh = Object.hasOwn(numericDrafts, name) ? numericDrafts[name] : undefined
      if (fresh !== undefined) {
        const saved = Object.hasOwn(previous.numericDrafts, name) ? previous.numericDrafts[name] : undefined
        if (saved !== undefined && saved.kind === fresh.kind && (saved.kind === "integer" || saved.kind === "duration" || saved.kind === "amount" && fresh.kind === "amount" && sameAmountUnit(saved.unit, fresh.unit))) {
          numericDrafts[name] = saved
          state[name] = projectNumericField(saved, refreshed.resolvedUi, name)
        }
      } else if (Object.hasOwn(previous.state, name) && !Object.hasOwn(previous.numericDrafts, name)) state[name] = previous.state[name]
    }
    const resolvedUi = resolveCurrentUi(refreshed.route, refreshed.inputs, refreshed.values, state, numericDrafts)
    return { ...refreshed, state, resolvedUi, numericDrafts }
  }

  async function setAccount(nextAccount?: CamViewerAccount): Promise<CamViewerLoadedSnapshot> {
    writePreparationRevision += 1
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

  function documentHashField(name: string, ui = assertCurrentView().resolvedUi): ResolvedDocumentHashFieldNode | undefined {
    let field: ResolvedDocumentHashFieldNode | undefined
    forEachResolvedUiNode(ui, (node) => {
      if (node.element === "DocumentHashField" && node.state.key === name) field = node
    })
    return field
  }

  function invalidateDocumentHash(name: string): void {
    documentHashOperations.get(name)?.abort()
    documentHashOperations.delete(name)
    delete documentHashes[name]
  }

  function cancelDocumentHash(name: string): CamViewerLoadedSnapshot {
    invalidateDocumentHash(name)
    return loadedSnapshot(assertCurrentView())
  }

  function beginDocumentHash(name: string, source: "url" | "file"): CamViewerDocumentHashOperation {
    assertViewAvailable()
    const field = documentHashField(name)
    if (field === undefined || field.disabled === true) throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `Cannot calculate document hash: field is not enabled in the current view: ${name}`)
    if (source !== "url" && source !== "file") throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "Cannot calculate document hash: source must be url or file")
    const sourceURI = source === "url" ? field.props.sourceURI : undefined
    if (source === "url" && (sourceURI === undefined || sourceURI.length === 0)) throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "Cannot calculate document hash from URL: the field has no source URI")
    invalidateDocumentHash(name)
    const controller = new AbortController()
    documentHashOperations.set(name, controller)
    const origin = { source, ...(sourceURI === undefined ? {} : { sourceURI }) }
    documentHashes[name] = { status: "pending", ...origin }
    function isCurrent(): boolean {
      return documentHashOperations.get(name) === controller && !controller.signal.aborted
    }
    return {
      snapshot: loadedSnapshot(assertCurrentView()),
      signal: controller.signal,
      ...(sourceURI === undefined ? {} : { sourceURI }),
      complete(digest) {
        if (!isCurrent()) return undefined
        if (!isDocumentHashDigest(digest)) throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", "Cannot apply document hash: SHA-256 digest must be 0x followed by 64 hexadecimal digits")
        editState({ [name]: digest })
        documentHashes[name] = { status: "succeeded", ...origin }
        return loadedSnapshot(assertCurrentView())
      },
      fail(failure) {
        if (!isCurrent()) return undefined
        if (!isRecordObject(failure) || typeof failure.message !== "string" || failure.diagnostic !== undefined && typeof failure.diagnostic !== "string") throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", "Cannot report document hash failure: message and optional diagnostic must be strings")
        documentHashOperations.delete(name)
        documentHashes[name] = { status: "failed", ...origin, message: failure.message, ...(failure.diagnostic === undefined ? {} : { diagnostic: failure.diagnostic }) }
        return loadedSnapshot(assertCurrentView())
      },
    }
  }

  function updateState(patch: InertRecord): CamViewerLoadedSnapshot {
    return editState(patch)
  }

  function editAmount(name: string, representation: "base" | "display", text: string, options?: { readonly composing?: boolean }): CamViewerLoadedSnapshot {
    if (representation !== "base" && representation !== "display" || typeof text !== "string" || typeof name !== "string" || options !== undefined && (typeof options !== "object" || options === null || Object.keys(options).some((key) => key !== "composing") || options.composing !== undefined && typeof options.composing !== "boolean")) {
      throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", "Amount edit requires a field name, base or display representation, text, and optional composing boolean")
    }
    const view = assertCurrentView()
    if (!Object.hasOwn(view.numericDrafts, name) || view.numericDrafts[name].kind !== "amount") throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", `Amount field is not rendered: ${name}`)
    return editState({ [name]: text }, { name, draft: editAmountDraft(view.numericDrafts[name].unit, representation, text, options?.composing) })
  }

  function editInteger(name: string, text: string, options?: { readonly composing?: boolean }): CamViewerLoadedSnapshot {
    if (typeof name !== "string" || typeof text !== "string" || options !== undefined && (typeof options !== "object" || options === null || Object.keys(options).some((key) => key !== "composing") || options.composing !== undefined && typeof options.composing !== "boolean")) {
      throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", "Integer edit requires a field name, text, and optional composing boolean")
    }
    const view = assertCurrentView()
    if (!Object.hasOwn(view.numericDrafts, name) || view.numericDrafts[name].kind !== "integer") throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", `Integer field is not rendered: ${name}`)
    return editState({ [name]: text }, { name, draft: editIntegerDraft(text, options?.composing) })
  }

  function editDuration(name: string, part: DurationPart, text: string, options?: { readonly composing?: boolean }): CamViewerLoadedSnapshot {
    if (typeof name !== "string" || !(DURATION_PARTS as readonly unknown[]).includes(part) || typeof text !== "string" || options !== undefined && (typeof options !== "object" || options === null || Object.keys(options).some((key) => key !== "composing") || options.composing !== undefined && typeof options.composing !== "boolean")) {
      throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", "Duration edit requires a field name, days, hours, minutes or seconds part, text, and optional composing boolean")
    }
    const view = assertCurrentView()
    const previous = Object.hasOwn(view.numericDrafts, name) ? view.numericDrafts[name] : undefined
    if (previous?.kind !== "duration") throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", `Duration field is not rendered: ${name}`)
    return editState({ [name]: text }, { name, draft: editDurationDraft(previous, part, text, options?.composing) })
  }

  function editState(patch: InertRecord, numericEdit?: { name: string; draft: NumericDraft }): CamViewerLoadedSnapshot {
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
    const numericDrafts = { ...currentView.numericDrafts }
    for (const [name, text] of Object.entries(statePatch)) {
      const previous = Object.hasOwn(numericDrafts, name) ? numericDrafts[name] : undefined
      if (previous === undefined) continue
      if (typeof text !== "string") throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", `Numeric field edit must be a string: ${name}`)
      const draft = numericEdit?.name === name ? numericEdit.draft
        : previous.kind === "amount" ? editAmountDraft(previous.unit, "base", text)
        : previous.kind === "duration" ? durationDraftFromSeconds(text) : editIntegerDraft(text)
      numericDrafts[name] = draft
      state[name] = projectNumericField(draft, currentView.resolvedUi, name)
    }

    const resolvedUi = resolveCurrentUi(currentView.route, currentView.inputs, currentView.values, state, numericDrafts)
    const nextView: CurrentView = {
      ...currentView,
      state,
      resolvedUi,
      numericDrafts,
    }

    for (const name of Object.keys(documentHashes)) {
      const before = documentHashField(name, currentView.resolvedUi)
      const after = documentHashField(name, nextView.resolvedUi)
      if (Object.hasOwn(statePatch, name) || after === undefined || after.disabled === true || before?.props.sourceURI !== after.props.sourceURI) invalidateDocumentHash(name)
    }
    currentView = nextView
    return loadedSnapshot(currentView)
  }

  function projectNumericField(draft: NumericDraft, ui: ResolvedUiNode, name: string): string | null {
    if (draft.kind === "amount") return projectAmountDraft(draft).canonical
    let bounds: { min?: string; max?: string } | undefined
    forEachResolvedUiNode(ui, (node) => {
      if ((node.element !== "NonNegativeIntegerField" && node.element !== "DurationField") || node.state.key !== name) return
      bounds = node.props
    })
    if (bounds === undefined) throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", `Numeric field is not rendered: ${name}`)
    return draft.kind === "duration" ? projectDurationDraft(draft, bounds).canonical : projectIntegerDraft(draft, bounds).canonical
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

    const revision = ++writePreparationRevision
    const call = await prepareViewerContractCall({
      publicClient,
      cam: current.cam,
      contracts: current.contracts,
      host: sessionHost,
      ...(account === undefined ? {} : { account }),
      route: interpretation.route,
      inputs: interpretation.inputs,
    })
    if (revision !== writePreparationRevision) {
      throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "Cannot prepare write: the account or view changed while the resolver was running")
    }
    return { type: "contractCall", call }
  }

  async function navigateLoaded(nextRoute: string, nextInputs: InertRecord): Promise<CamViewerLoadedSnapshot> {
    writePreparationRevision += 1
    const current = assertLoaded()
    const nextView = await resolveLoadedView(current, nextRoute, nextInputs, account)

    const previous = assertCurrentView()
    history.push({ route: previous.route, inputs: previous.inputs, state: previous.state, numericDrafts: previous.numericDrafts })
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
    const numericDrafts = Object.create(null) as Record<string, NumericDraft>
    forEachResolvedUiNode(view.resolvedUi, (node) => {
      if (node.element === "AmountField") numericDrafts[node.state.key] = editAmountDraft(node.unit, node.draft.representation, node.draft.representation === "base" ? node.draft.baseText : node.draft.displayText)
      if (node.element === "NonNegativeIntegerField") numericDrafts[node.state.key] = editIntegerDraft(node.draft.text)
      if (node.element === "DurationField") {
        let draft = durationDraftFromSeconds("")
        for (const part of DURATION_PARTS) draft = editDurationDraft(draft, part, node.draft.parts[part].text, node.draft.parts[part].composing)
        numericDrafts[node.state.key] = draft
      }
    })
    return { ...view, numericDrafts }
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
    numericDrafts: Record<string, NumericDraft>,
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
      numericDrafts,
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
    for (const name of Object.keys(documentHashes)) invalidateDocumentHash(name)
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
    actionKind: (action) => renderedActionKind(assertLoaded().cam, action),
    snapshot,
    load: () => changeView(load),
    back: () => changeView(back),
    refresh: () => changeView(refresh),
    navigate: (route, inputs) => changeView(() => navigate(route, inputs)),
    setAccount: (nextAccount) => changeView(() => setAccount(nextAccount)),
    beginDocumentHash,
    cancelDocumentHash,
    updateState,
    editAmount,
    editInteger,
    editDuration,
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
