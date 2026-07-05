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
  resolveCamContracts,
  sendCamContractCall,
  simulateCamContractCall,
} from "../../packages/cam-evm-viem/dist/index.js"
import type {
  CamHost,
  CamPublicClient,
  CamSimulationClient,
} from "../../packages/cam-evm-viem/dist/index.js"
import {
  createContext,
} from "../../packages/cam-core/dist/index.js"
import type {
  CamDocument,
} from "../../packages/cam-core/dist/index.js"
import {
  createCamViewerSession,
} from "../../packages/cam-viewer/dist/index.js"
import type {
  CamViewerLoadedSnapshot,
  CamViewerPreparedContractCall,
  CamViewerSession,
  CamViewerSnapshot,
} from "../../packages/cam-viewer/dist/index.js"
import {
  resolvedUiButtons,
} from "../../packages/cam-screen/dist/index.js"
import type {
  ResolvedButtonNode,
} from "../../packages/cam-screen/dist/index.js"
import {
  createSameOriginHttpResourceLoader,
} from "../../packages/cam-protocol/dist/index.js"
import type {
  InertRecord,
} from "../../packages/cam-protocol/dist/index.js"
import {
  emit,
  errorMessage,
} from "./events.ts"
import {
  createPrng,
} from "./prng.ts"
import type {
  Prng,
} from "./prng.ts"
import {
  readOptions,
} from "./options.ts"
import type {
  RunnerOptions,
} from "./options.ts"
import {
  generatedRouteInputs,
  generatedStatePatch,
} from "./values.ts"
import type {
  ValueGenerationMode,
} from "./values.ts"

// Write-enabled fuzz is a CI gate, not an operator console; a stalled local
// chain must fail with replay data instead of hanging the lane indefinitely.
const RECEIPT_WAIT_TIMEOUT_MS = 20_000
const RECEIPT_POLLING_INTERVAL_MS = 500

type WriteContext =
  | { readonly kind: "simulate" }
  | {
    readonly kind: "local-fixture"
    readonly chain: Chain
    readonly walletClient: Parameters<typeof sendCamContractCall>[0]["walletClient"]
  }

type ReceiptClient = {
  readonly waitForTransactionReceipt: (request: {
    readonly hash: Hex
    readonly pollingInterval?: number
    readonly timeout?: number
  }) => Promise<{
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
  const loadResource = createSameOriginHttpResourceLoader({
    originInput: options.descriptor.resourceOrigin,
    originLabel: "descriptor.resourceOrigin",
    fetchResource: fetch,
    loadFailurePrefix: "failed to load CAM resource",
  })

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
    initialInputs: generatedRouteInputs({
      route: loadedCam.cam.routes[loadedCam.cam.entry],
      account,
      prng,
      mode: valueMode,
    }),
    loadResource,
  })
  const entry = await session.load()
  assertResolvedSnapshot(entry)
  emit({
    event: "entry_loaded",
    route: entry.route,
    inputs: entry.inputs,
    state: entry.state,
    values: entry.values,
    actions: actionSummaries(resolvedUiButtons(entry.resolvedUi)),
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

  // Keep the terminal success event replay-friendly: a failed CI log often
  // preserves the tail, not the full walk, so include the final resolved state.
  const finalSnapshot = requireLoadedSnapshot(session.snapshot())
  emit({
    event: "ok",
    seed: options.seed,
    runs: options.runs,
    steps: options.steps,
    finalSnapshot: snapshotSummary(finalSnapshot),
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
    const inputs = generatedRouteInputs({
      route,
      account,
      prng,
      mode: valueMode,
    })

    await callCamRoute({
      publicClient,
      cam,
      contracts,
      route: routeName,
      context: createContext({
        host,
        account: { address: account },
        inputs,
        outputs: [],
      }),
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
    const statePatch = generatedStatePatch({
      snapshot: before,
      account,
      prng,
      mode: valueMode,
    })
    const current = Object.keys(statePatch).length === 0
      ? before
      : session.updateState(statePatch)
    assertResolvedSnapshot(current)

    const actions = resolvedUiButtons(current.resolvedUi)
    if (actions.length === 0) {
      emit({
        event: "step",
        run,
        step,
        route: current.route,
        inputs: current.inputs,
        statePatch,
        state: current.state,
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
      statePatch,
      state: current.state,
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
        state: result.snapshot.state,
        values: result.snapshot.values,
        actions: actionSummaries(resolvedUiButtons(result.snapshot.resolvedUi)),
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
      throw new Error(`presented write button failed simulation: ${call.route}: ${error.message}`)
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

  let receipt: Awaited<ReturnType<ReceiptClient["waitForTransactionReceipt"]>>
  try {
    receipt = await receiptClient.waitForTransactionReceipt({
      hash,
      pollingInterval: RECEIPT_POLLING_INTERVAL_MS,
      timeout: RECEIPT_WAIT_TIMEOUT_MS,
    })
  } catch (cause) {
    throw new Error(
      `write transaction receipt was not observed within ${RECEIPT_WAIT_TIMEOUT_MS / 1000}s for route ${call.route}: ${hash}`,
      { cause },
    )
  }
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
  assertResolvedSnapshot(snapshot)
  emit({
    event: "navigation",
    run,
    step,
    fromRoute: call.route,
    toRoute: snapshot.route,
    inputs: snapshot.inputs,
    state: snapshot.state,
    values: snapshot.values,
    actions: actionSummaries(resolvedUiButtons(snapshot.resolvedUi)),
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

function actionSummaries(actions: readonly ResolvedButtonNode[]): readonly JsonObject[] {
  return actions.map((action) => actionSummary(action))
}

function actionSummary(action: ResolvedButtonNode): JsonObject {
  return {
    element: action.element,
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

function snapshotSummary(snapshot: CamViewerLoadedSnapshot): JsonObject {
  return {
    route: snapshot.route,
    inputs: snapshot.inputs,
    state: snapshot.state,
    values: snapshot.values,
    actions: actionSummaries(resolvedUiButtons(snapshot.resolvedUi)),
  }
}

function assertResolvedSnapshot(snapshot: CamViewerSnapshot): void {
  const loaded = requireLoadedSnapshot(snapshot)
  if (resolvedUiButtons(loaded.resolvedUi).some((action) => action.call.namespace !== "routes")) {
    throw new Error(`route ${loaded.route}: resolved action outside routes namespace`)
  }
}

function requireLoadedSnapshot(snapshot: CamViewerSnapshot): CamViewerLoadedSnapshot {
  if (
    snapshot.route === undefined
    || snapshot.inputs === undefined
    || snapshot.state === undefined
    || snapshot.uiURI === undefined
    || snapshot.resolvedUi === undefined
    || snapshot.values === undefined
  ) {
    throw new Error("viewer snapshot is not loaded")
  }

  return {
    ...(snapshot.account === undefined ? {} : { account: snapshot.account }),
    route: snapshot.route,
    inputs: snapshot.inputs,
    state: snapshot.state,
    uiURI: snapshot.uiURI,
    resolvedUi: snapshot.resolvedUi,
    values: snapshot.values,
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

main().catch((error: unknown) => {
  const message = errorMessage(error)
  emit({
    event: "error",
    error: message,
  })
  process.exitCode = 1
})
