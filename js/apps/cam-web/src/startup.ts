import type {
  CamHost,
  ResourceLoader,
} from "@cam/evm-viem"
import {
  evmChainIdNumber,
  requireEvmAddress,
  requireEvmChainId,
} from "@cam/evm-viem"
import {
  createSameOriginHttpResourceLoader,
  requireHttpOrigin,
  requireHttpURL,
} from "@cam/protocol"
import type {
  Address,
  Hex,
} from "viem"

export type StartupOptions = {
  readonly chainId: string
  readonly host: CamHost["address"]
  readonly account: CamHost["address"]
  readonly rpcUrl: string
  readonly resourceOrigin: string
  readonly allowUnsignedCamHash: boolean
}

export type StartupPolicy = {
  readonly resourceOrigin: string
  readonly allowUnsignedCamHash: boolean
}

export type StartupEnv = {
  readonly VITE_CAM_WEB_ALLOW_UNSIGNED_CAM_HASH?: string
  readonly VITE_CAM_WEB_RESOURCE_ORIGIN?: string
}

type HostCodeClient = {
  readonly getCode: (request: { readonly address: Address }) => Promise<Hex | undefined>
}

type ChainIdClient = {
  readonly getChainId: () => Promise<number>
}

export function parseStartupOptions(url: URL, policy: StartupPolicy): StartupOptions {
  const params = url.searchParams
  return {
    chainId: requireEvmChainId(requiredParam(params, "chainId")),
    host: requireEvmAddress(requiredParam(params, "host"), "host"),
    account: requireEvmAddress(requiredParam(params, "account"), "account"),
    rpcUrl: requireHttpURL(requiredParam(params, "rpcUrl"), "rpcUrl").href,
    resourceOrigin: policy.resourceOrigin,
    allowUnsignedCamHash: policy.allowUnsignedCamHash,
  }
}

export function readStartupPolicy(env: StartupEnv): StartupPolicy {
  return {
    resourceOrigin: requireHttpOrigin(
      requiredEnv(env.VITE_CAM_WEB_RESOURCE_ORIGIN, "VITE_CAM_WEB_RESOURCE_ORIGIN"),
      "VITE_CAM_WEB_RESOURCE_ORIGIN",
    ),
    allowUnsignedCamHash: parseRequiredBoolean(
      env.VITE_CAM_WEB_ALLOW_UNSIGNED_CAM_HASH,
      "VITE_CAM_WEB_ALLOW_UNSIGNED_CAM_HASH",
    ),
  }
}

export function createPinnedOriginResourceLoader(resourceOrigin: string): ResourceLoader {
  return createSameOriginHttpResourceLoader({
    originInput: resourceOrigin,
    originLabel: "resourceOrigin",
    fetchResource: fetch,
    cache: "no-store",
    loadFailurePrefix: "failed to load CAM resource",
  })
}

export async function assertHostHasCode(
  publicClient: HostCodeClient,
  host: StartupOptions["host"],
): Promise<void> {
  const code = await publicClient.getCode({ address: host })
  if (code === undefined || code === "0x") {
    throw new Error(`CAM host has no contract code at ${host}. Check that the host URL parameter matches the currently running chain.`)
  }
}

export async function assertRpcChain(
  publicClient: ChainIdClient,
  expectedChainId: StartupOptions["chainId"],
): Promise<void> {
  const actual = await publicClient.getChainId()
  const expected = evmChainIdNumber(expectedChainId)
  if (actual !== expected) {
    throw new Error(`RPC chain mismatch: expected ${expectedChainId}, got eip155:${actual}`)
  }
}

function requiredParam(params: URLSearchParams, name: string): string {
  const values = params.getAll(name)
  if (values.length === 0 || values[0]?.length === 0) {
    throw new Error(`missing URL parameter: ${name}`)
  }
  if (values.length > 1) {
    throw new Error(`duplicate URL parameter: ${name}`)
  }

  return values[0]
}

function requiredEnv(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) {
    throw new Error(`missing environment setting: ${name}`)
  }

  return value
}

function parseRequiredBoolean(value: string | undefined, name: string): boolean {
  value = requiredEnv(value, name)
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`${name}: expected "true" or "false"`)
}
