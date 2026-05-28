import { readFileSync } from "node:fs"

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
    initialParams,
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
        params: initialParams,
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
    const resourceURL = requireSameHttpOrigin(uri, origin)
    const response = await fetch(resourceURL, { redirect: "error" })
    if (!response.ok) {
      throw new Error(`local-rpc terminal failed to load CAM resource ${resourceURL.href}: HTTP ${response.status}`)
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
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
  const originURL = requireHttpURL(requiredEnv(env, "CAM_VIEWER_RESOURCE_ORIGIN"), "CAM_VIEWER_RESOURCE_ORIGIN")
  if (originURL.pathname !== "/" || originURL.search !== "" || originURL.hash !== "") {
    throw new Error("CAM_VIEWER_RESOURCE_ORIGIN must be an HTTP(S) origin without path, query, or fragment")
  }

  return originURL.origin
}

function requireSameHttpOrigin(uri: string, origin: string): URL {
  const resourceURL = requireHttpURL(uri, "CAM resource URI")
  if (resourceURL.origin !== origin) {
    throw new Error(`local-rpc terminal CAM resource is outside allowed origin: ${resourceURL.href}`)
  }

  return resourceURL
}

function requireHttpURL(value: string, label: string): URL {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label}: expected http or https URL`)
  }

  if (url.username !== "" || url.password !== "") {
    throw new Error(`${label}: credentials are not allowed`)
  }

  return url
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
