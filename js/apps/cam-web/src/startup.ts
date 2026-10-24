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
  createCamResourceLoader,
  requireHttpOrigin,
  requireHttpURL,
  isRecordObject,
  parseJsonText,
} from "@cam/protocol"
import type { InertRecord } from "@cam/protocol"
import type { CamViewerLoadedSnapshot } from "@cam/viewer"
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
  readonly route?: string
  readonly inputs: InertRecord
}

export type StartupPolicy = {
  readonly resourceOrigin: string
}

export type StartupEnv = {
  readonly VITE_CAM_WEB_RESOURCE_ORIGIN?: string
}

type HostCodeClient = {
  readonly getCode: (request: { readonly address: Address }) => Promise<Hex | undefined>
}

type ChainIdClient = {
  readonly getChainId: () => Promise<number>
}

const STARTUP_PARAM_NAMES = new Set(["chainId", "host", "account", "rpcUrl"])

export function parseStartupOptions(url: URL, policy: StartupPolicy): StartupOptions {
  const params = url.searchParams
  rejectUnknownParams(params, STARTUP_PARAM_NAMES)
  return {
    chainId: requireEvmChainId(requiredParam(params, "chainId")),
    host: requireEvmAddress(requiredParam(params, "host"), "host"),
    account: requireEvmAddress(requiredParam(params, "account"), "account"),
    rpcUrl: requireHttpURL(requiredParam(params, "rpcUrl"), "rpcUrl").href,
    resourceOrigin: policy.resourceOrigin,
    ...parseViewFragment(url.hash),
  }
}

export function readStartupPolicy(env: StartupEnv): StartupPolicy {
  return {
    resourceOrigin: requireHttpOrigin(
      requiredEnv(env.VITE_CAM_WEB_RESOURCE_ORIGIN, "VITE_CAM_WEB_RESOURCE_ORIGIN"),
      "VITE_CAM_WEB_RESOURCE_ORIGIN",
    ),
  }
}

export function createPinnedOriginResourceLoader(resourceOrigin: string, ipfsGatewayTemplate?: string, signal?: AbortSignal): ResourceLoader {
  return createCamResourceLoader({
    originInput: resourceOrigin,
    originLabel: "resourceOrigin",
    fetchResource: (uri, init) => fetch(uri, signal === undefined ? init : { ...init, signal }),
    ...(ipfsGatewayTemplate === undefined ? {} : { ipfsGatewayTemplate }),
    cache: "no-store",
    loadFailurePrefix: "failed to load CAM resource",
  })
}

export function displayRpcEndpoint(rpcUrl: string): string {
  return requireHttpURL(rpcUrl, "rpcUrl").origin
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

function rejectUnknownParams(params: URLSearchParams, allowedNames: ReadonlySet<string>): void {
  for (const name of params.keys()) {
    if (!allowedNames.has(name)) {
      throw new Error(`unknown URL parameter: ${name}`)
    }
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

// These web-link bounds limit untrusted URL work before the protocol's recursive
// duplicate-key parser runs. They do not change CAM resource or ABI limits.
const VIEW_FRAGMENT_MAX_LENGTH = 16_384
const VIEW_INPUT_MAX_BYTES = 4_096
const VIEW_INPUT_MAX_DEPTH = 32
const VIEW_PARAM_NAMES = new Set(["route", "inputs"])

export function parseViewFragment(hash: string): { readonly route?: string; readonly inputs: InertRecord } {
  if (hash === "" || hash === "#") return { inputs: {} }
  if (hash.length > VIEW_FRAGMENT_MAX_LENGTH) throw new Error("View URL fragment is too large (limit: 16,384 characters).")
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash
  try {
    // URLSearchParams is intentionally tolerant of broken percent escapes.
    // A navigation request must instead preserve its exact supplied text.
    decodeURIComponent(fragment.replace(/\+/g, " "))
  } catch (cause) {
    throw new Error("Cannot open view: the URL fragment has invalid percent encoding.", { cause })
  }
  const params = new URLSearchParams(fragment)
  const route = requiredParam(params, "route")
  if (!params.has("inputs")) {
    const entries = [...params.entries()].filter(([name]) => name !== "route")
    for (const [name] of entries) {
      if (params.getAll(name).length > 1) throw new Error(`duplicate URL parameter: ${name}`)
    }
    const inputs = Object.fromEntries(entries)
    assertViewInputBounds(JSON.stringify(inputs))
    return { route, inputs }
  }
  rejectUnknownParams(params, VIEW_PARAM_NAMES)
  const text = requiredParam(params, "inputs")
  assertViewInputBounds(text)
  let inputs: unknown
  try {
    inputs = parseJsonText(text)
  } catch (cause) {
    throw new Error("Cannot open view: inputs must be valid JSON with no duplicate object keys.", { cause })
  }
  if (!isRecordObject(inputs)) throw new Error("Cannot open view: inputs must be a JSON object.")
  assertViewInputNumbers(inputs)
  return { route, inputs: inputs as InertRecord }
}

export function urlForView(url: URL, view: Pick<CamViewerLoadedSnapshot, "route" | "inputs" | "account">): URL {
  assertViewInputNumbers(view.inputs)
  const inputs = JSON.stringify(view.inputs)
  assertViewInputBounds(inputs)
  const fragment = new URLSearchParams({ route: view.route })
  if (fragment.get("route") !== view.route) {
    throw new Error("View URL route must contain valid Unicode so it can be represented exactly.")
  }
  const entries = Object.entries(view.inputs)
  // Flat parameters preserve string inputs without a JSON wrapper. Other values,
  // reserved names and text that URLSearchParams would alter retain the envelope.
  const flat = new URLSearchParams()
  const useFlat = entries.every(([name, value]) => {
    if (VIEW_PARAM_NAMES.has(name) || typeof value !== "string") return false
    const entry = new URLSearchParams([[name, value]]).entries().next().value
    if (entry?.[0] !== name || entry[1] !== value) return false
    flat.append(name, value)
    return true
  })
  if (useFlat) {
    for (const [name, value] of flat) fragment.append(name, value)
  } else fragment.set("inputs", inputs)
  const next = new URL(url.href)
  next.hash = fragment.toString()
  if (next.hash.length > VIEW_FRAGMENT_MAX_LENGTH) throw new Error("View URL fragment is too large (limit: 16,384 characters).")
  if (view.account !== undefined) next.searchParams.set("account", view.account.address)
  return next
}

function assertViewInputNumbers(inputs: unknown): void {
  const remaining: unknown[] = [inputs]
  while (remaining.length > 0) {
    const value = remaining.pop()
    if (typeof value === "number") {
      throw new Error("View URL inputs must encode numeric values as decimal strings, not JSON numbers, to preserve exact values.")
    }
    if (Array.isArray(value)) remaining.push(...value)
    else if (isRecordObject(value)) remaining.push(...Object.values(value))
  }
}

function assertViewInputBounds(text: string): void {
  if (text.length > VIEW_INPUT_MAX_BYTES || new TextEncoder().encode(text).length > VIEW_INPUT_MAX_BYTES) {
    throw new Error("View URL inputs are too large (limit: 4,096 UTF-8 bytes).")
  }
  let depth = 0
  let inString = false
  let escaped = false
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '\"') inString = false
    } else if (character === '\"') inString = true
    else if (character === "{" || character === "[") {
      depth += 1
      if (depth > VIEW_INPUT_MAX_DEPTH) throw new Error("View URL inputs exceed the nesting limit of 32.")
    } else if (character === "}" || character === "]") depth -= 1
  }
}
