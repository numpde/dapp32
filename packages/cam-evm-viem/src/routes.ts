import { resolveResourceURI, resolveRouteCall, toInertValue } from "@cam/core"
import type { CamDocument, CamRuntimeContext, InertValue } from "@cam/core"
import type { Abi, AbiFunction, Address, PublicClient } from "viem"

import { CamEvmError } from "./errors.ts"
import type { ResolvedCamContract, RouteResult } from "./types.ts"

export async function callCamRoute({
  publicClient,
  cam,
  camURI,
  contracts,
  route,
  context,
}: CallCamRouteOptions): Promise<RouteResult> {
  const routeCall = resolveRouteCall(cam, route, context)
  const contract = contracts[routeCall.contract]

  if (contract === undefined) {
    throw new CamEvmError(
      "CAM_UNKNOWN_CONTRACT",
      `CAM route references unresolved contract: ${routeCall.contract}`,
    )
  }
  assertRouteFunctionAbi(contract.abi, routeCall.function)

  let raw: unknown
  try {
    raw = await publicClient.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName: routeCall.function,
      args: routeCall.args,
      account: context.account?.address as Address | undefined,
    })
  } catch (cause) {
    throw new CamEvmError("CAM_ROUTE_CALL_FAILED", `failed to call CAM route: ${route}`, cause)
  }

  const values = Array.isArray(raw) ? raw : [raw]
  const screenURI = values[0]

  if (typeof screenURI !== "string" || screenURI.length === 0) {
    throw new CamEvmError(
      "CAM_ROUTE_INVALID_RESULT",
      `CAM route did not return a screen URI as its first output: ${route}`,
    )
  }
  assertLocalScreenURI(screenURI, route)

  return {
    screenURI: resolveResourceURI(camURI, screenURI),
    values: normalizeRouteValues(values.slice(1), route),
  }
}

type CallCamRouteOptions = {
  readonly publicClient: PublicClient
  readonly cam: CamDocument
  readonly camURI: string
  readonly contracts: Record<string, ResolvedCamContract>
  readonly route: string
  readonly context: CamRuntimeContext
}

function normalizeRouteValues(values: readonly unknown[], route: string): readonly InertValue[] {
  return values.map((value, index) => normalizeRouteValue(value, `${route}.${index}`))
}

function normalizeRouteValue(value: unknown, path: string): InertValue {
  if (typeof value === "bigint") {
    // viem decodes Solidity integers as bigint; CAM screen data carries them
    // as decimal strings because InertValue deliberately has no bigint scalar.
    return value.toString()
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeRouteValue(item, `${path}.${index}`))
  }
  if (isPlainRecord(value)) {
    const record = Object.create(null) as Record<string, InertValue>
    for (const [key, item] of Object.entries(value)) {
      record[key] = normalizeRouteValue(item, `${path}.${key}`)
    }
    return record
  }

  try {
    return toInertValue(value)
  } catch (cause) {
    throw new CamEvmError(
      "CAM_ROUTE_INVALID_RESULT",
      `CAM route returned a non-inert value at ${path}`,
      cause,
    )
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function assertLocalScreenURI(screenURI: string, route: string): void {
  if (!/^\.\/screens\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(screenURI)) {
    throw new CamEvmError(
      "CAM_ROUTE_INVALID_RESULT",
      `CAM route returned an unsafe screen URI for ${route}: ${screenURI}`,
    )
  }
}

function assertRouteFunctionAbi(abi: Abi, functionName: string): void {
  const matches = abi.filter(
    (item): item is AbiFunction => item.type === "function" && item.name === functionName,
  )

  if (matches.length === 0) {
    throw new CamEvmError("CAM_ROUTE_FUNCTION_NOT_FOUND", `CAM route function not found in ABI: ${functionName}`)
  }

  if (matches.length > 1) {
    throw new CamEvmError(
      "CAM_ROUTE_FUNCTION_AMBIGUOUS",
      `CAM route function is overloaded and not supported in CAM V1: ${functionName}`,
    )
  }

  const [fn] = matches
  if (fn.stateMutability !== "view" && fn.stateMutability !== "pure") {
    throw new CamEvmError("CAM_ROUTE_FUNCTION_NOT_VIEW", `CAM route function must be view or pure: ${functionName}`)
  }
}
