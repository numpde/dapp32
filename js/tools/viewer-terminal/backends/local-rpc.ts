import type {
  CamHost,
  CamPublicClient,
} from "../../../packages/cam-evm-viem/dist/index.js"
import {
  createHttpCamPublicClient,
  requireEvmAddress,
} from "../../../packages/cam-evm-viem/dist/index.js"
import {
  createCamViewerSession,
} from "../../../packages/cam-viewer/dist/index.js"
import {
  createSameOriginHttpResourceLoader,
  parseJsonBytes,
} from "../../../packages/cam-protocol/dist/index.js"

import type {
  DebugEvent,
  TerminalBackend,
  TerminalBackendOptions,
} from "../types.ts"
import {
  readBoundedFileSync,
} from "../../local-cam-files.ts"
import {
  requiredArray,
  requiredEnv,
  requiredField,
  requiredRecord,
  requiredString,
} from "../../input.ts"

type BroadcastDeployment = {
  readonly chainId: string
  readonly account: CamHost["address"]
  readonly camRoot: CamHost["address"]
}

type CreatedContract = {
  readonly address: CamHost["address"]
  readonly transactionHash: string
}

export function createLocalRpcBackend(
  env: NodeJS.ProcessEnv,
  {
    allowUnsignedCamHash,
    initialInputs,
  }: TerminalBackendOptions,
): TerminalBackend {
  const rpcURL = requiredEnv(env, "CAM_VIEWER_RPC_URL")
  const resourceOrigin = requiredEnv(env, "CAM_VIEWER_RESOURCE_ORIGIN")
  const deployment = readBroadcastDeployment(requiredEnv(env, "CAM_VIEWER_BROADCAST_PATH"))

  return {
    name: "local-rpc",
    description: "local Anvil RPC from Forge broadcast",
    hostLabel: `${deployment.chainId} ${deployment.camRoot}`,
    createSession(events) {
      const loadResource = createSameOriginHttpResourceLoader({
        originInput: resourceOrigin,
        originLabel: "CAM_VIEWER_RESOURCE_ORIGIN",
        fetchResource: fetch,
        loadFailurePrefix: "local-rpc terminal failed to load CAM resource",
      })

      return createCamViewerSession({
        publicClient: tracedPublicClient(createHttpCamPublicClient({ rpcURL }), events),
        host: {
          chainId: deployment.chainId,
          address: deployment.camRoot,
        },
        account: {
          address: deployment.account,
        },
        inputs: initialInputs,
        allowUnsignedCamHash,
        async loadResource(uri) {
          const bytes = await loadResource(uri)
          events.push({
            step: events.length + 1,
            kind: "resource-load",
            uri,
            bytes: bytes.byteLength,
          })
          return bytes
        },
      })
    },
  }
}

function tracedPublicClient(publicClient: CamPublicClient, events: DebugEvent[]): CamPublicClient {
  return {
    async getChainId() {
      return await publicClient.getChainId()
    },
    async readContract(request) {
      const result = await publicClient.readContract(request)
      const args = traceContractArgs(request.args)
      events.push({
        step: events.length + 1,
        kind: "contract-read",
        functionName: request.functionName,
        args,
        result,
      })
      return result
    },
  }
}

export function traceContractArgs(args: unknown): readonly unknown[] {
  return Array.isArray(args) ? [...args] : []
}

function readBroadcastDeployment(path: string): BroadcastDeployment {
  const broadcast = parseJsonBytes(readBoundedFileSync(path, "Forge broadcast"))
  return deploymentFromBroadcast(broadcast)
}

export function deploymentFromBroadcast(broadcast: unknown): BroadcastDeployment {
  const root = requiredRecord(broadcast, "broadcast")
  const transactions = requiredArray(root, "transactions")
  const receipts = requiredArray(root, "receipts")
  const chain = requiredField(root, "chain")

  const camRoot = findCreatedContract(transactions, "CamRoot")
  const account = receiptSenderForTransaction(receipts, camRoot.transactionHash)
  const chainId = `eip155:${requiredChainNumber(chain)}`

  return {
    chainId,
    account,
    camRoot: camRoot.address,
  }
}

function findCreatedContract(transactions: readonly unknown[], contractName: string): CreatedContract {
  const matches: CreatedContract[] = []
  transactions.forEach((item, index) => {
    const tx = requiredRecord(item, `transactions.${index}`)
    if (
      tx.transactionType === "CREATE"
      && tx.contractName === contractName
      && typeof tx.contractAddress === "string"
    ) {
      matches.push({
        address: requireEvmAddress(tx.contractAddress, `transactions.${index}.${contractName}.contractAddress`),
        transactionHash: requiredString(tx, "hash", `transactions.${index}.hash`),
      })
    }
  })

  if (matches.length === 0) {
    throw new Error(`Forge broadcast did not create required contract: ${contractName}`)
  }
  if (matches.length > 1) {
    throw new Error(`Forge broadcast created ${contractName} more than once`)
  }

  return matches[0]
}

function receiptSenderForTransaction(receipts: readonly unknown[], transactionHash: string): CamHost["address"] {
  const senders = new Set<CamHost["address"]>()
  receipts.forEach((item, index) => {
    const receipt = requiredRecord(item, `receipts.${index}`)
    if (receipt.transactionHash !== transactionHash) {
      return
    }
    senders.add(requireEvmAddress(requiredString(receipt, "from", `receipts.${index}.from`), `receipts.${index}.from`))
  })

  if (senders.size === 0) {
    throw new Error(`Forge broadcast has no receipt for deployment transaction: ${transactionHash}`)
  }
  if (senders.size > 1) {
    throw new Error(`Forge broadcast has multiple receipt senders for deployment transaction: ${transactionHash}`)
  }

  return [...senders][0]
}

function requiredChainNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Forge broadcast chain must be a positive integer")
  }

  return value
}
