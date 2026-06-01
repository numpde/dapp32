import { readFileSync } from "node:fs"

import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem"
import type { Address, Chain, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import {
  callCamRoute,
  createHttpCamPublicClient,
  evmChainIdNumber,
  loadCamFromHost,
  requireEvmAddress,
  requireEvmChainId,
  resolveCamContracts,
  sendCamContractCall,
  simulateCamContractCall,
} from "../../packages/cam-evm-viem/dist/index.js"
import type {
  CamHost,
  CamPublicClient,
  CamSimulationClient,
} from "../../packages/cam-evm-viem/dist/index.js"
import type {
  CamDocument,
  CamRoute,
} from "../../packages/cam-core/dist/index.js"
import {
  createCamViewerSession,
} from "../../packages/cam-viewer/dist/index.js"
import type {
  CamViewerPreparedContractCall,
  CamViewerSession,
  CamViewerSnapshot,
} from "../../packages/cam-viewer/dist/index.js"
import type {
  ResolvedActionNode,
  ResolvedUiNode,
} from "../../packages/cam-screen/dist/index.js"
import {
  isRecordObject,
  parseJsonText,
  readBoundedResponseBytes,
  requireHttpOrigin,
  requireSameHttpOrigin,
  toInertValue,
} from "../../packages/cam-protocol/dist/index.js"
import type {
  InertRecord,
  InertValue,
} from "../../packages/cam-protocol/dist/index.js"

type Descriptor = {
  readonly camIntegration: "1.0.0"
  readonly chainId: string
  readonly rpcUrl: string
  readonly camHost: Address
  readonly resourceOrigin: string
  readonly accounts: readonly Address[]
  readonly allowUnsignedCamHash: boolean
}

type RunnerOptions = {
  readonly descriptor: Descriptor
  readonly seed: string
  readonly runs: number
  readonly steps: number
  readonly writeMode: WriteMode
}

type ValueGenerationMode = "broad" | "write-positive"

type WriteMode =
  | { readonly kind: "simulate" }
  | {
    readonly kind: "local-fixture"
    readonly privateKey: Hex
  }

type WriteContext =
  | { readonly kind: "simulate" }
  | {
    readonly kind: "local-fixture"
    readonly chain: Chain
    readonly walletClient: Parameters<typeof sendCamContractCall>[0]["walletClient"]
  }

type ReceiptClient = {
  readonly waitForTransactionReceipt: (request: { readonly hash: Hex }) => Promise<{
    readonly status: string
    readonly transactionHash: Hex
  }>
}

type JsonObject = {
  readonly [key: string]: unknown
}

async function main(): Promise<void> {
  const options = readOptions(process.env)
  const prng = createPrng(options.seed)
  const account = options.descriptor.accounts[0]
  if (account === undefined) {
    throw new Error("descriptor.accounts must contain at least one address")
  }

  const host = {
    chainId: options.descriptor.chainId,
    address: options.descriptor.camHost,
  } satisfies CamHost
  const publicClient = createHttpCamPublicClient({ rpcURL: options.descriptor.rpcUrl })
  const fullPublicClient = createPublicClient({
    transport: http(options.descriptor.rpcUrl),
  })
  const writeContext = createWriteContext(options, account)
  // The local write lane is a positive validation gate: every presented write
  // action must simulate and execute. The broad read-only lane keeps invalid
  // strings in its corpus so negative simulations remain observable there.
  const valueMode = options.writeMode.kind === "local-fixture" ? "write-positive" : "broad"
  const loadResource = httpResourceLoader(options.descriptor.resourceOrigin)

  emit({
    event: "start",
    seed: options.seed,
    runs: options.runs,
    steps: options.steps,
    chainId: host.chainId,
    host: host.address,
    account,
    writeMode: options.writeMode.kind,
    resourceOrigin: options.descriptor.resourceOrigin,
    allowUnsignedCamHash: options.descriptor.allowUnsignedCamHash,
  })

  await assertHostBoundary(fullPublicClient, host)

  const loadedCam = await loadCamFromHost({
    publicClient,
    host,
    loadResource,
    allowUnsignedCamHash: options.descriptor.allowUnsignedCamHash,
  })
  emit({
    event: "cam_loaded",
    camURI: loadedCam.camURI,
    entry: loadedCam.cam.entry,
    routeCount: Object.keys(loadedCam.cam.routes).length,
    namespaceCount: Object.keys(loadedCam.cam.namespaces).length,
  })
  const contracts = await resolveCamContracts({
    publicClient,
    host,
    camURI: loadedCam.camURI,
    cam: loadedCam.cam,
    loadResource,
  })
  await assertResolvedContractsHaveCode(fullPublicClient, contracts)
  emit({
    event: "contracts_resolved",
    contracts: Object.fromEntries(
      Object.entries(contracts).map(([namespace, contract]) => [
        namespace,
        {
          address: contract.address,
        },
      ]),
    ),
  })

  const session = createSession({
    publicClient,
    host,
    account,
    allowUnsignedCamHash: options.descriptor.allowUnsignedCamHash,
    initialInputs: generatedRouteInputs(loadedCam.cam.routes[loadedCam.cam.entry], account, prng, valueMode),
    loadResource,
  })
  const entry = await session.load()
  assertResolvedSnapshot(entry)
  emit({
    event: "entry_loaded",
    route: entry.route,
    inputs: entry.inputs,
    form: entry.form,
    values: entry.values,
    actions: actionSummaries(actionNodes(entry.resolvedUi)),
  })

  await callEveryReadRoute({
    cam: loadedCam.cam,
    contracts,
    publicClient,
    host,
    account,
    prng,
    valueMode,
  })

  for (let run = 0; run < options.runs; run++) {
    await walkSession({
      run,
      steps: options.steps,
      session,
      account,
      simulationClient: fullPublicClient,
      receiptClient: fullPublicClient,
      writeContext,
      prng,
      valueMode,
    })
  }

  emit({
    event: "ok",
    seed: options.seed,
    runs: options.runs,
    steps: options.steps,
  })
}

function createSession({
  publicClient,
  host,
  account,
  allowUnsignedCamHash,
  initialInputs,
  loadResource,
}: {
  readonly publicClient: CamPublicClient
  readonly host: CamHost
  readonly account: Address
  readonly allowUnsignedCamHash: boolean
  readonly initialInputs: InertRecord
  readonly loadResource: (uri: string) => Promise<Uint8Array>
}): CamViewerSession {
  return createCamViewerSession({
    publicClient,
    host,
    account: { address: account },
    inputs: initialInputs,
    allowUnsignedCamHash,
    loadResource,
  })
}

async function callEveryReadRoute({
  cam,
  contracts,
  publicClient,
  host,
  account,
  prng,
  valueMode,
}: {
  readonly cam: CamDocument
  readonly contracts: Parameters<typeof callCamRoute>[0]["contracts"]
  readonly publicClient: CamPublicClient
  readonly host: CamHost
  readonly account: Address
  readonly prng: Prng
  readonly valueMode: ValueGenerationMode
}): Promise<void> {
  for (const [routeName, route] of Object.entries(cam.routes)) {
    if (route.kind !== "read") continue
    const inputs = generatedRouteInputs(route, account, prng, valueMode)

    await callCamRoute({
      publicClient,
      cam,
      contracts,
      route: routeName,
      context: {
        host,
        account: { address: account },
        inputs,
        outputs: [],
        form: {},
      },
    })
    emit({
      event: "read_route_checked",
      route: routeName,
      inputs,
    })
  }
}

async function walkSession({
  run,
  steps,
  session,
  account,
  simulationClient,
  receiptClient,
  writeContext,
  prng,
  valueMode,
}: {
  readonly run: number
  readonly steps: number
  readonly session: CamViewerSession
  readonly account: Address
  readonly simulationClient: CamSimulationClient
  readonly receiptClient: ReceiptClient
  readonly writeContext: WriteContext
  readonly prng: Prng
  readonly valueMode: ValueGenerationMode
}): Promise<void> {
  requireLoadedSnapshot(session.snapshot())

  for (let step = 0; step < steps; step++) {
    const before = requireLoadedSnapshot(session.snapshot())
    const formPatch = generatedFormPatch(before, account, prng, valueMode)
    const current = Object.keys(formPatch).length === 0
      ? before
      : session.updateForm(formPatch)
    assertResolvedSnapshot(current)

    const actions = actionNodes(current.resolvedUi)
    if (actions.length === 0) {
      emit({
        event: "step",
        run,
        step,
        route: current.route,
        inputs: current.inputs,
        formPatch,
        form: current.form,
        values: current.values,
        actionCount: 0,
        result: "no_actions",
      })
      continue
    }

    const action = actions[prng.integer(actions.length)]
    if (action === undefined) {
      throw new Error("internal action selection failed")
    }

    emit({
      event: "step",
      run,
      step,
      route: current.route,
      inputs: current.inputs,
      formPatch,
      form: current.form,
      values: current.values,
      actionCount: actions.length,
      action: actionSummary(action),
    })
    const result = await session.dispatchAction(action)
    if (result.type === "navigated") {
      assertResolvedSnapshot(result.snapshot)
      emit({
        event: "navigation",
        run,
        step,
        fromRoute: current.route,
        toRoute: result.snapshot.route,
        inputs: result.snapshot.inputs,
        form: result.snapshot.form,
        values: result.snapshot.values,
        actions: actionSummaries(actionNodes(result.snapshot.resolvedUi)),
      })
      continue
    }

    await handlePreparedWrite({
      publicClient: simulationClient,
      receiptClient,
      account,
      run,
      step,
      session,
      writeContext,
      call: result.call,
    })
  }
}

async function handlePreparedWrite({
  publicClient,
  receiptClient,
  account,
  run,
  step,
  session,
  writeContext,
  call,
}: {
  readonly publicClient: CamSimulationClient
  readonly receiptClient: ReceiptClient
  readonly account: Address
  readonly run: number
  readonly step: number
  readonly session: CamViewerSession
  readonly writeContext: WriteContext
  readonly call: CamViewerPreparedContractCall
}): Promise<void> {
  try {
    await simulateCamContractCall({
      publicClient,
      account,
      call,
    })
    emit({
      event: "write_simulation",
      run,
      step,
      route: call.route,
      status: "accepted",
      call: contractCallSummary(call),
    })
  } catch (cause) {
    const error = cause instanceof Error ? cause : new Error(String(cause))
    if (error.message.length === 0) {
      throw new Error(`write simulation for ${call.route} failed without a useful error`)
    }
    emit({
      event: "write_simulation",
      run,
      step,
      route: call.route,
      status: "rejected",
      call: contractCallSummary(call),
      error: error.message,
    })
    if (writeContext.kind === "local-fixture") {
      throw new Error(`presented write action failed simulation: ${call.route}: ${error.message}`)
    }
    return
  }

  if (writeContext.kind === "simulate") {
    return
  }

  const hash = await sendCamContractCall({
    walletClient: writeContext.walletClient,
    chain: writeContext.chain,
    call,
  })
  emit({
    event: "write_transaction",
    run,
    step,
    route: call.route,
    status: "submitted",
    hash,
    call: contractCallSummary(call),
  })

  const receipt = await receiptClient.waitForTransactionReceipt({ hash })
  emit({
    event: "write_transaction",
    run,
    step,
    route: call.route,
    status: receipt.status,
    hash: receipt.transactionHash,
  })
  if (receipt.status !== "success") {
    throw new Error(`write transaction did not succeed for route ${call.route}: ${receipt.status}`)
  }

  if (call.then.namespace !== "routes") {
    throw new Error(`write route must continue to routes namespace after transaction: ${call.route}`)
  }
  const snapshot = await session.navigate(call.then.function, call.then.args)
  emit({
    event: "navigation",
    run,
    step,
    fromRoute: call.route,
    toRoute: snapshot.route,
    inputs: snapshot.inputs,
    form: snapshot.form,
    values: snapshot.values,
    actions: actionSummaries(actionNodes(snapshot.resolvedUi)),
    afterWriteHash: receipt.transactionHash,
  })
}

function createWriteContext(options: RunnerOptions, account: Address): WriteContext {
  if (options.writeMode.kind === "simulate") {
    return { kind: "simulate" }
  }
  if (options.descriptor.chainId !== "eip155:31337") {
    throw new Error("local-fixture write mode only runs on eip155:31337")
  }

  const walletAccount = privateKeyToAccount(options.writeMode.privateKey)
  if (walletAccount.address.toLowerCase() !== account.toLowerCase()) {
    throw new Error("local-fixture write key does not match descriptor account")
  }

  const chain = {
    id: evmChainIdNumber(options.descriptor.chainId),
    name: "CAM local fixture",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [options.descriptor.rpcUrl],
      },
    },
  } satisfies Chain

  return {
    kind: "local-fixture",
    chain,
    walletClient: createWalletClient({
      account: walletAccount,
      chain,
      transport: http(options.descriptor.rpcUrl),
    }),
  }
}

function actionSummaries(actions: readonly ResolvedActionNode[]): readonly JsonObject[] {
  return actions.map((action) => actionSummary(action))
}

function actionSummary(action: ResolvedActionNode): JsonObject {
  return {
    tag: action.tag,
    props: action.props,
    call: action.call,
  }
}

function contractCallSummary(call: CamViewerPreparedContractCall): JsonObject {
  return {
    route: call.route,
    address: call.address,
    function: call.function,
    args: call.args,
  }
}

function generatedRouteInputs(
  route: CamRoute | undefined,
  account: Address,
  prng: Prng,
  mode: ValueGenerationMode,
): InertRecord {
  if (route === undefined) {
    throw new Error("cannot generate inputs for missing route")
  }

  const inputs: Record<string, InertValue> = {}
  for (const name of route.inputs) {
    inputs[name] = generatedNamedValue(name, account, prng, mode)
  }

  return toInertValue(inputs) as InertRecord
}

function generatedFormPatch(
  snapshot: CamViewerSnapshot,
  account: Address,
  prng: Prng,
  mode: ValueGenerationMode,
): InertRecord {
  const resolved = snapshot.resolvedUi
  if (resolved === undefined) {
    throw new Error("cannot generate form values without resolved UI")
  }

  const patch: Record<string, InertValue> = {}
  for (const name of inputNames(resolved)) {
    patch[name] = generatedNamedValue(name, account, prng, mode)
  }

  return toInertValue(patch) as InertRecord
}

function generatedNamedValue(name: string, account: Address, prng: Prng, mode: ValueGenerationMode): InertValue {
  const lower = name.toLowerCase()
  if (lower.includes("account") || lower.includes("owner") || lower.includes("address")) {
    return account
  }
  if (lower.includes("uri")) {
    return `fixture://cam-integration/${1 + prng.integer(3)}.json`
  }
  if (lower.includes("serial")) {
    if (mode === "write-positive") {
      return prng.pick(["CAM-TEST-001", "CAM-TEST-002"])
    }
    return prng.pick(["", "CAM-TEST-001", "CAM-TEST-002"])
  }

  if (mode === "write-positive") {
    return prng.pick(["CAM-TEST-001", "1"])
  }

  return prng.pick(["", "CAM-TEST-001", "1"])
}

function assertResolvedSnapshot(snapshot: CamViewerSnapshot): void {
  const loaded = requireLoadedSnapshot(snapshot)
  if (actionNodes(loaded.resolvedUi).some((action) => action.call.namespace !== "routes")) {
    throw new Error(`route ${loaded.route}: resolved action outside routes namespace`)
  }
}

function requireLoadedSnapshot(snapshot: CamViewerSnapshot): Required<Pick<CamViewerSnapshot, "route" | "form" | "resolvedUi">> & CamViewerSnapshot {
  if (snapshot.route === undefined || snapshot.form === undefined || snapshot.resolvedUi === undefined) {
    throw new Error("viewer snapshot is not loaded")
  }

  return snapshot as Required<Pick<CamViewerSnapshot, "route" | "form" | "resolvedUi">> & CamViewerSnapshot
}

function inputNames(node: ResolvedUiNode): readonly string[] {
  const names = new Set<string>()
  visitNodes(node, (candidate) => {
    if (candidate.tag !== "Input") return
    const name = candidate.props.name
    if (typeof name !== "string" || name.length === 0) {
      throw new Error("resolved Input node has no non-empty name")
    }
    names.add(name)
  })
  return [...names].sort()
}

function actionNodes(node: ResolvedUiNode): readonly ResolvedActionNode[] {
  const actions: ResolvedActionNode[] = []
  visitNodes(node, (candidate) => {
    if (candidate.tag === "Action") {
      actions.push(candidate)
    }
  })
  return actions
}

function visitNodes(node: ResolvedUiNode, visit: (node: ResolvedUiNode) => void): void {
  visit(node)
  if ("children" in node) {
    for (const child of node.children) {
      visitNodes(child, visit)
    }
  }
}

async function assertHostBoundary(
  publicClient: ReturnType<typeof createPublicClient>,
  host: CamHost,
): Promise<void> {
  const chainId = await publicClient.getChainId()
  if (`eip155:${chainId}` !== host.chainId) {
    throw new Error(`RPC chain mismatch: expected ${host.chainId}, got eip155:${chainId}`)
  }

  const code = await publicClient.getCode({ address: host.address })
  if (code === undefined || code === "0x") {
    throw new Error(`CAM host has no code: ${host.address}`)
  }
}

async function assertResolvedContractsHaveCode(
  publicClient: ReturnType<typeof createPublicClient>,
  contracts: Awaited<ReturnType<typeof resolveCamContracts>>,
): Promise<void> {
  for (const [namespace, contract] of Object.entries(contracts)) {
    const code = await publicClient.getCode({ address: contract.address })
    if (code === undefined || code === "0x") {
      throw new Error(`CAM contract namespace has no code: ${namespace} ${contract.address}`)
    }
  }
}

function httpResourceLoader(originInput: string): (uri: string) => Promise<Uint8Array> {
  const origin = requireHttpOrigin(originInput, "descriptor.resourceOrigin")
  return async (uri: string): Promise<Uint8Array> => {
    const resourceURL = requireSameHttpOrigin(uri, origin, "CAM resource URI")
    const response = await fetch(resourceURL.href, { redirect: "error" })
    if (!response.ok) {
      throw new Error(`failed to load CAM resource ${resourceURL.href}: HTTP ${response.status}`)
    }
    return await readBoundedResponseBytes(response, resourceURL.href)
  }
}

function readOptions(env: NodeJS.ProcessEnv): RunnerOptions {
  return {
    descriptor: readDescriptor(requiredEnv(env, "CAM_INTEGRATION_DESCRIPTOR_PATH")),
    seed: requiredEnv(env, "CAM_INTEGRATION_SEED"),
    runs: requiredPositiveIntegerEnv(env, "CAM_INTEGRATION_RUNS"),
    steps: requiredPositiveIntegerEnv(env, "CAM_INTEGRATION_STEPS"),
    writeMode: readWriteMode(env),
  }
}

function readWriteMode(env: NodeJS.ProcessEnv): WriteMode {
  const value = requiredEnv(env, "CAM_INTEGRATION_WRITE_MODE")
  if (value === "simulate") {
    return { kind: "simulate" }
  }
  if (value === "local-fixture") {
    return {
      kind: "local-fixture",
      privateKey: requiredPrivateKey(env, "CAM_INTEGRATION_PRIVATE_KEY"),
    }
  }

  throw new Error(`CAM_INTEGRATION_WRITE_MODE: unsupported write mode: ${value}`)
}

function requiredPrivateKey(env: NodeJS.ProcessEnv, name: string): Hex {
  const value = requiredEnv(env, name)
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name}: expected a 32-byte hex private key`)
  }

  return value as Hex
}

function readDescriptor(path: string): Descriptor {
  const value = parseJsonText(readFileSync(path, "utf8"))
  if (!isRecordObject(value)) {
    throw new Error("CAM integration descriptor must be an object")
  }
  if (value.camIntegration !== "1.0.0") {
    throw new Error("CAM integration descriptor version must be 1.0.0")
  }
  const accountsValue = value.accounts
  if (!Array.isArray(accountsValue)) {
    throw new Error("descriptor.accounts must be an array")
  }

  return {
    camIntegration: "1.0.0",
    chainId: requireEvmChainId(requiredString(value, "chainId")),
    rpcUrl: requiredString(value, "rpcUrl"),
    camHost: requireEvmAddress(requiredString(value, "camHost"), "descriptor.camHost"),
    resourceOrigin: requireHttpOrigin(requiredString(value, "resourceOrigin"), "descriptor.resourceOrigin"),
    accounts: accountsValue.map((account, index) =>
      requireEvmAddress(requiredStringValue(account, `descriptor.accounts.${index}`), `descriptor.accounts.${index}`),
    ),
    allowUnsignedCamHash: requiredBoolean(value, "allowUnsignedCamHash"),
  }
}

function requiredString(source: Record<string, unknown>, key: string): string {
  return requiredStringValue(source[key], `descriptor.${key}`)
}

function requiredStringValue(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path}: expected a non-empty string`)
  }

  return value
}

function requiredBoolean(source: Record<string, unknown>, key: string): boolean {
  const value = source[key]
  if (typeof value !== "boolean") {
    throw new Error(`descriptor.${key}: expected a boolean`)
  }

  return value
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required environment variable: ${name}`)
  }

  return value
}

function requiredPositiveIntegerEnv(env: NodeJS.ProcessEnv, name: string): number {
  const value = requiredEnv(env, name)
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name}: expected a positive integer`)
  }

  return parsed
}

type Prng = {
  readonly integer: (exclusiveMax: number) => number
  readonly pick: <T>(values: readonly T[]) => T
}

function createPrng(seed: string): Prng {
  let state = 0x811c9dc5
  for (let index = 0; index < seed.length; index++) {
    state ^= seed.charCodeAt(index)
    state = Math.imul(state, 0x01000193) >>> 0
  }
  if (state === 0) state = 1

  function next(): number {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return state >>> 0
  }

  return {
    integer(exclusiveMax) {
      if (!Number.isInteger(exclusiveMax) || exclusiveMax <= 0) {
        throw new Error(`invalid PRNG bound: ${exclusiveMax}`)
      }
      return next() % exclusiveMax
    },
    pick(values) {
      if (values.length === 0) {
        throw new Error("cannot pick from an empty array")
      }
      const value = values[this.integer(values.length)]
      if (value === undefined) {
        throw new Error("internal PRNG pick failed")
      }
      return value
    },
  }
}

main().catch((error: unknown) => {
  const message = errorMessage(error)
  emit({
    event: "error",
    error: message,
  })
  process.exitCode = 1
})

function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error)
  }
  if (error.stack !== undefined && error.stack.length > 0) {
    return error.stack
  }

  return error.message
}

function emit(event: JsonObject): void {
  console.log(JSON.stringify({
    source: "cam-integration-fuzz",
    ...event,
  }))
}
