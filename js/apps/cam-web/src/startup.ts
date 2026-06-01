import type {
  CamHost,
  ResourceLoader,
} from "@cam/evm-viem"
import type {
  Address,
  Hex,
} from "viem"

import {
  evmChainIdNumber,
  requireAddress,
  requireEvmChainId,
} from "./evm"

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

const MAX_CAM_RESOURCE_BYTES = 2 * 1024 * 1024

export function parseStartupOptions(url: URL, policy: StartupPolicy): StartupOptions {
  const params = url.searchParams
  return {
    chainId: requireEvmChainId(requiredParam(params, "chainId")),
    host: requireAddress(requiredParam(params, "host"), "host"),
    account: requireAddress(requiredParam(params, "account"), "account"),
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

    const response = await fetch(url, {
      cache: "no-store",
      redirect: "error",
    })
    if (!response.ok) {
      throw new Error(`failed to load CAM resource ${url.href}: HTTP ${response.status}`)
    }
    const contentLength = responseContentLength(response, url.href)
    if (contentLength !== undefined && contentLength > MAX_CAM_RESOURCE_BYTES) {
      throw new Error(`CAM resource is too large: ${url.href}`)
    }

    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_CAM_RESOURCE_BYTES) {
      throw new Error(`CAM resource is too large: ${url.href}`)
    }

    return bytes
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

function responseContentLength(response: Response, uri: string): number | undefined {
  const value = response.headers.get("content-length")
  if (value === null) return undefined

  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`CAM resource has invalid Content-Length: ${uri}`)
  }

  return Number(value)
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
