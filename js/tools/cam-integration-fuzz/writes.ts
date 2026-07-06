import {
  createWalletClient,
  http,
} from "viem"
import type { Address, Chain, Hex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

import {
  evmChainIdNumber,
  sendCamContractCall,
  simulateCamContractCall,
} from "../../packages/cam-evm-viem/dist/index.js"
import type {
  CamSimulationClient,
} from "../../packages/cam-evm-viem/dist/index.js"
import type {
  CamViewerPreparedContractCall,
  CamViewerSession,
} from "../../packages/cam-viewer/dist/index.js"
import {
  resolvedUiButtons,
} from "../../packages/cam-screen/dist/index.js"
import {
  emit,
  errorMessage,
} from "./events.ts"
import type {
  RunnerOptions,
} from "./options.ts"
import {
  assertResolvedSnapshot,
} from "./snapshots.ts"
import {
  actionSummaries,
  contractCallSummary,
} from "./summaries.ts"

// Write-enabled fuzz is a CI gate, not an operator console; a stalled local
// chain must fail with replay data instead of hanging the lane indefinitely.
const RECEIPT_WAIT_TIMEOUT_MS = 20_000
const RECEIPT_POLLING_INTERVAL_MS = 500

export type WriteContext =
  | { readonly kind: "simulate" }
  | {
    readonly kind: "local-fixture"
    readonly chain: Chain
    readonly walletClient: Parameters<typeof sendCamContractCall>[0]["walletClient"]
  }

export type ReceiptClient = {
  readonly waitForTransactionReceipt: (request: {
    readonly hash: Hex
    readonly pollingInterval?: number
    readonly timeout?: number
  }) => Promise<{
    readonly status: string
    readonly transactionHash: Hex
  }>
}

export async function handlePreparedWrite({
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
    const message = errorMessage(cause)
    if (message.length === 0) {
      throw new Error(`write simulation for ${call.route} failed without a useful error`)
    }
    emit({
      event: "write_simulation",
      run,
      step,
      route: call.route,
      status: "rejected",
      call: contractCallSummary(call),
      error: message,
    })
    if (writeContext.kind === "local-fixture") {
      throw new Error(`presented write button failed simulation: ${call.route}: ${message}`)
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

export function createWriteContext(options: RunnerOptions, account: Address): WriteContext {
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
