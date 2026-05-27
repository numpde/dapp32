import { readFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import type {
  CamHost,
  CamPublicClient,
} from "../../../packages/cam-evm-viem/dist/index.js"
import {
  createHttpCamPublicClient,
} from "../../../packages/cam-evm-viem/dist/index.js"
import {
  createCamViewerSession,
} from "../../../packages/cam-viewer/dist/index.js"
import {
  hasOwn,
  isRecordObject,
  parseJsonText,
  toInertValue,
} from "../../../packages/cam-protocol/dist/index.js"
import type { InertRecord } from "../../../packages/cam-protocol/dist/index.js"

import type {
  DebugEvent,
  TerminalBackend,
} from "../types.ts"

type BroadcastDeployment = {
  readonly chainId: string
  readonly account: CamHost["address"]
  readonly camRoot: CamHost["address"]
}

export function createLocalRpcBackend(env: NodeJS.ProcessEnv): TerminalBackend {
  const rpcURL = requiredEnv(env, "CAM_VIEWER_RPC_URL")
  const fileRoot = resolve(requiredEnv(env, "CAM_VIEWER_FILE_ROOT"))
  const params = readInertRecordEnv(env, "CAM_VIEWER_INITIAL_PARAMS_JSON")
  const state = readInertRecordEnv(env, "CAM_VIEWER_INITIAL_STATE_JSON")
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
        params,
        state,
        loadResource: createLocalFileResourceLoader(fileRoot, events),
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

function createLocalFileResourceLoader(root: string, events: DebugEvent[]): (uri: string) => Promise<Uint8Array> {
  return async (uri: string): Promise<Uint8Array> => {
    const resourceURL = new URL(uri)
    if (resourceURL.protocol !== "file:") {
      throw new Error(`local-rpc terminal loads file resources only: ${resourceURL.protocol}`)
    }

    const path = resolve(fileURLToPath(resourceURL))
    if (path !== root && (relative(root, path).startsWith("..") || relative(root, path) === "")) {
      throw new Error(`local-rpc terminal file resource is outside CAM file root: ${resourceURL.href}`)
    }

    const bytes = await readFile(path)
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

function readInertRecordEnv(env: NodeJS.ProcessEnv, name: string): InertRecord {
  const value = toInertValue(parseJsonText(requiredEnv(env, name)))
  if (!isRecordObject(value)) {
    throw new Error(`${name}: expected a JSON object`)
  }

  return value
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
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${path}: expected an EVM address`)
  }

  return value as CamHost["address"]
}
