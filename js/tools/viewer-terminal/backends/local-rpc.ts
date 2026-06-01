import { readFileSync } from "node:fs"

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
  parseJsonText,
  toInertValue,
} from "../../../packages/cam-protocol/dist/index.js"

import type {
  DebugEvent,
  TerminalBackend,
  TerminalBackendOptions,
} from "../types.ts"
import {
  requiredArray,
  requiredEnv,
  requiredField,
  requiredRecord,
  requiredString,
} from "../../input.ts"
import { createSameOriginHttpResourceLoader } from "../../http-resource.ts"

type BroadcastDeployment = {
  readonly chainId: string
  readonly account: CamHost["address"]
  readonly camRoot: CamHost["address"]
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
      const args = Array.isArray(request.args)
        ? request.args.map((arg: unknown) => toInertValue(arg))
        : []
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

function readBroadcastDeployment(path: string): BroadcastDeployment {
  const broadcast = parseJsonText(readFileSync(path, "utf8"))
  const root = requiredRecord(broadcast, "broadcast")
  const transactions = requiredArray(root, "transactions")
  const receipts = requiredArray(root, "receipts")
  const chain = requiredField(root, "chain")

  const camRoot = findCreatedContract(transactions, "CamRoot")
  const account = firstReceiptSender(receipts)
  const chainId = `eip155:${requiredChainNumber(chain)}`

  return {
    chainId,
    account,
    camRoot,
  }
}

function findCreatedContract(transactions: readonly unknown[], contractName: string): CamHost["address"] {
  for (const item of transactions) {
    const tx = requiredRecord(item, "transactions[]")
    if (
      tx.transactionType === "CREATE"
      && tx.contractName === contractName
      && typeof tx.contractAddress === "string"
    ) {
      return requiredAddress(tx.contractAddress, `transactions[].${contractName}.contractAddress`)
    }
  }

  throw new Error(`Forge broadcast did not create required contract: ${contractName}`)
}

function firstReceiptSender(receipts: readonly unknown[]): CamHost["address"] {
  const receipt = requiredRecord(receipts[0], "receipts.0")
  return requiredAddress(requiredString(receipt, "from", "receipts.0.from"), "receipts.0.from")
}

function requiredChainNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("Forge broadcast chain must be a positive integer")
  }

  return value
}

function requiredAddress(value: string, path: string): CamHost["address"] {
  return requireEvmAddress(value, path)
}
