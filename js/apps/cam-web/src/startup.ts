import type {
  CamHost,
  ResourceLoader,
} from "@cam/evm-viem"

import {
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

export function parseStartupOptions(url: URL): StartupOptions {
  const params = url.searchParams
  return {
    chainId: requireEvmChainId(requiredParam(params, "chainId")),
    host: requireAddress(requiredParam(params, "host"), "host"),
    account: requireAddress(requiredParam(params, "account"), "account"),
    rpcUrl: requireHttpURL(requiredParam(params, "rpcUrl"), "rpcUrl").href,
    allowUnsignedCamHash: requiredBooleanParam(params, "allowUnsignedCamHash"),
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

    return new Uint8Array(await response.arrayBuffer())
  }
}

function requiredParam(params: URLSearchParams, name: string): string {
  const value = params.get(name)
  if (value === null || value.length === 0) {
    throw new Error(`missing URL parameter: ${name}`)
  }

  return value
}

function requiredBooleanParam(params: URLSearchParams, name: string): boolean {
  const value = requiredParam(params, name)
  if (value === "true") return true
  if (value === "false") return false
  throw new Error(`${name}: expected "true" or "false"`)
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
