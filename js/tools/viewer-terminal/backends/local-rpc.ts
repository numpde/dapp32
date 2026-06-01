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
  hasOwn,
  isRecordObject,
  parseJsonText,
  readBoundedResponseBytes,
  requireHttpOrigin,
  requireSameHttpOrigin,
  toInertValue,
} from "../../../packages/cam-protocol/dist/index.js"

import type {
  DebugEvent,
  TerminalBackend,
  TerminalBackendOptions,
} from "../types.ts"

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
  const resourceOrigin = requiredResourceOrigin(env)
  const deployment = readBroadcastDeployment(requiredEnv(env, "CAM_VIEWER_BROADCAST_PATH"))

  return {
    name: "local-rpc",
    description: "local Anvil RPC from Forge broadcast",
    hostLabel: `${deployment.chainId} ${deployment.camRoot}`,
    createSession(events) {
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
        loadResource: createHttpResourceLoader(resourceOrigin, events),
      })
    },
  }
}

function tracedPublicClient(publicClient: CamPublicClient, events: DebugEvent[]): CamPublicClient {
  return {
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

function createHttpResourceLoader(origin: string, events: DebugEvent[]): (uri: string) => Promise<Uint8Array> {
  return async (uri: string): Promise<Uint8Array> => {
    const resourceURL = requireSameHttpOrigin(uri, origin, "CAM resource URI")
    const response = await fetch(resourceURL.href, { redirect: "error" })
    if (!response.ok) {
      throw new Error(`local-rpc terminal failed to load CAM resource ${resourceURL.href}: HTTP ${response.status}`)
    }
    const bytes = await readBoundedResponseBytes(response, resourceURL.href)
    events.push({
      step: events.length + 1,
      kind: "resource-load",
      uri: resourceURL.href,
      bytes: bytes.byteLength,
    })
    return bytes
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

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required environment variable: ${name}`)
  }

  return value
}

function requiredResourceOrigin(env: NodeJS.ProcessEnv): string {
  return requireHttpOrigin(requiredEnv(env, "CAM_VIEWER_RESOURCE_ORIGIN"), "CAM_VIEWER_RESOURCE_ORIGIN")
}

function requiredRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecordObject(value)) {
    throw new Error(`${path}: expected an object`)
  }

  return value
}

function requiredArray(source: Record<string, unknown>, key: string): readonly unknown[] {
  const value = requiredField(source, key)
  if (!Array.isArray(value)) {
    throw new Error(`${key}: expected an array`)
  }

  return value
}

function requiredString(source: Record<string, unknown>, key: string, path: string): string {
  const value = requiredField(source, key)
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${path}: expected a non-empty string`)
  }

  return value
}

function requiredField(source: Record<string, unknown>, key: string): unknown {
  if (!hasOwn(source, key)) {
    throw new Error(`Forge broadcast missing field: ${key}`)
  }

  return source[key]
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
