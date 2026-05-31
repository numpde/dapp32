import { resolveResourceURI, resolveRouteCall } from "@cam/core"
import {
  createStringMap,
  isRecordObject,
  toInertValue,
} from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import type { CamRuntimeContext, InertValue } from "@cam/protocol"
import { isAddress } from "viem"
import type { Abi, AbiFunction, AbiParameter, Address } from "viem"

import { findUniqueAbiFunction } from "./abi-functions.ts"
import { CamEvmError } from "./errors.ts"
import type { CamPublicClient, ResolvedCamContract, RouteResult } from "./types.ts"

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
  const routeFunction = assertRouteFunctionAbi(contract.abi, routeCall.function)

  const account = routeAccount(context)
  let raw: unknown
  try {
    raw = await publicClient.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName: routeCall.function,
      args: routeCall.args,
      account,
    })
  } catch (cause) {
    throw new CamEvmError("CAM_ROUTE_CALL_FAILED", `failed to call CAM route: ${route}`, cause)
  }

  return normalizeRouteResult(raw, camURI, route, routeFunction)
}

type CallCamRouteOptions = {
  readonly publicClient: CamPublicClient
  readonly cam: CamDocument
  readonly camURI: string
  readonly contracts: Record<string, ResolvedCamContract>
  readonly route: string
  readonly context: CamRuntimeContext
}

function routeAccount(context: CamRuntimeContext): Address | undefined {
  const address = context.account?.address
  if (address === undefined) {
    return undefined
  }

  if (!isAddress(address)) {
    throw new CamEvmError("CAM_INVALID_ACCOUNT", `CAM account address is invalid: ${address}`)
  }

  return address
}

function normalizeRouteResult(raw: unknown, camURI: string, route: string, routeFunction: AbiFunction): RouteResult {
  const outputs = Array.isArray(raw) ? raw : [raw]
  if (outputs.length !== routeFunction.outputs.length) {
    throw new CamEvmError(
      "CAM_ROUTE_INVALID_RESULT",
      `CAM route ${route} returned ${outputs.length} value(s), but its ABI declares ${routeFunction.outputs.length}`,
    )
  }

  const screenURI = outputs[0]

  if (typeof screenURI !== "string" || screenURI.length === 0) {
    throw new CamEvmError(
      "CAM_ROUTE_INVALID_RESULT",
      `CAM route did not return a screen URI as its first output: ${route}`,
    )
  }
  assertLocalScreenURI(screenURI, route)

  return {
    screenURI: resolveResourceURI(camURI, screenURI),
    values: normalizeRouteValues(outputs.slice(1), routeFunction.outputs.slice(1), route),
  }
}

function normalizeRouteValues(
  values: readonly unknown[],
  outputs: readonly AbiParameter[],
  route: string,
): readonly InertValue[] {
  return values.map((value, index) => normalizeAbiValue(value, outputs[index], `${route}.${index}`))
}

function normalizeAbiValue(value: unknown, parameter: AbiParameter | undefined, path: string): InertValue {
  if (isTupleParameter(parameter)) {
    return normalizeTupleValue(value, parameter, path)
  }

  if (parameter?.type === "tuple") {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route ABI tuple has no components at ${path}`)
  }

  return normalizeRouteValue(value, path)
}

type AbiTupleParameter = AbiParameter & {
  readonly type: "tuple"
  readonly components: readonly AbiParameter[]
}

function isTupleParameter(parameter: AbiParameter | undefined): parameter is AbiTupleParameter {
  if (parameter?.type !== "tuple") {
    return false
  }

  return Array.isArray((parameter as { readonly components?: unknown }).components)
}

function normalizeTupleValue(value: unknown, parameter: AbiTupleParameter, path: string): InertValue {
  const record = createStringMap<InertValue>()
  parameter.components.forEach((component, index) => {
    const name = component.name
    if (name === undefined || name.length === 0) {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route ABI tuple component is unnamed at ${path}.${index}`)
    }

    const componentValue = readTupleComponent(value, name, index)
    if (componentValue === undefined) {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route tuple is missing component ${name} at ${path}`)
    }

    record[name] = normalizeAbiValue(componentValue, component, `${path}.${name}`)
  })

  return record
}

function readTupleComponent(value: unknown, name: string, index: number): unknown {
  if (isRecordObject(value) && Object.hasOwn(value, name)) {
    return value[name]
  }

  if (Array.isArray(value) && index in value) {
    return value[index]
  }

  return undefined
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
  if (isRecordObject(value)) {
    const record = createStringMap<InertValue>()
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

function assertLocalScreenURI(screenURI: string, route: string): void {
  if (!/^\.\/screens\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(screenURI)) {
    throw new CamEvmError(
      "CAM_ROUTE_INVALID_RESULT",
      `CAM route returned an unsafe screen URI for ${route}: ${screenURI}`,
    )
  }
}

function assertRouteFunctionAbi(abi: Abi, functionName: string): AbiFunction {
  const fn = findUniqueAbiFunction({
    abi,
    functionName,
    notFoundCode: "CAM_ROUTE_FUNCTION_NOT_FOUND",
    ambiguousCode: "CAM_ROUTE_FUNCTION_AMBIGUOUS",
    purpose: "route",
  })
  if (fn.stateMutability !== "view" && fn.stateMutability !== "pure") {
    throw new CamEvmError("CAM_ROUTE_FUNCTION_NOT_VIEW", `CAM route function must be view or pure: ${functionName}`)
  }

  return fn
}
