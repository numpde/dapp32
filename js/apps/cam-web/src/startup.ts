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
  readBoundedResponseBytes,
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
  readonly allowUnsignedCamHash: boolean
}

export type StartupPolicy = {
  readonly allowUnsignedCamHash: boolean
}

export type StartupEnv = {
  readonly VITE_CAM_WEB_ALLOW_UNSIGNED_CAM_HASH?: string
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
    allowUnsignedCamHash: policy.allowUnsignedCamHash,
  }
}

export function readStartupPolicy(env: StartupEnv): StartupPolicy {
  return {
    allowUnsignedCamHash: parseRequiredBoolean(
      env.VITE_CAM_WEB_ALLOW_UNSIGNED_CAM_HASH,
      "VITE_CAM_WEB_ALLOW_UNSIGNED_CAM_HASH",
    ),
  }
}

export function createPinnedOriginResourceLoader(): ResourceLoader {
  let origin: string | undefined

  return async (uri: string): Promise<Uint8Array> => {
    const url = requireHttpURL(uri, "CAM resource URI")
    if (origin === undefined) {
      origin = url.origin
    } else if (url.origin !== origin) {
      throw new Error(`CAM resource escaped pinned origin: ${url.href}`)
    }

    const response = await fetch(url.href, {
      cache: "no-store",
      redirect: "error",
    })
    if (!response.ok) {
      throw new Error(`failed to load CAM resource ${url.href}: HTTP ${response.status}`)
    }
    return readBoundedResponseBytes(response, url.href)
  }
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
  const value = params.get(name)
  if (value === null || value.length === 0) {
    throw new Error(`missing URL parameter: ${name}`)
  }

  return value
}

function parseRequiredBoolean(value: string | undefined, name: string): boolean {
  if (value === undefined || value.length === 0) {
    throw new Error(`missing environment setting: ${name}`)
  }

  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`${name}: expected "true" or "false"`)
}
