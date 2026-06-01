import { resolveRouteCall } from "@cam/core"
import {
  createStringMap,
  isRecordObject,
} from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import type { CamRuntimeContext, InertValue } from "@cam/protocol"
import { isAddress } from "viem"
import type { Abi, AbiFunction, AbiParameter, Address } from "viem"

import { abiFunctionInputs, normalizeAbiArgs } from "./arguments.ts"
import { findUniqueAbiFunction } from "./abi-functions.ts"
import { assertClientChain } from "./chain.ts"
import { CamEvmError } from "./errors.ts"
import type { CamPublicClient, ResolvedCamContract, RouteResult } from "./types.ts"

export async function callCamRoute({
  publicClient,
  cam,
  contracts,
  route,
  context,
}: CallCamRouteOptions): Promise<RouteResult> {
  await assertClientChain(publicClient, context.host)

  const routeCall = resolveRouteCall(cam, route, context)
  const contract = contracts[routeCall.namespace]

  if (contract === undefined) {
    throw new CamEvmError(
      "CAM_UNKNOWN_CONTRACT",
      `CAM route references unresolved contract namespace: ${routeCall.namespace}`,
    )
  }
  const routeFunction = assertRouteFunctionAbi(contract.abi, routeCall.function)
  const args = normalizeAbiArgs({
    inputs: abiFunctionInputs(routeFunction, "CAM_ROUTE_INVALID_ARGUMENT"),
    args: routeCall.args,
    functionName: routeCall.function,
    errorCode: "CAM_ROUTE_INVALID_ARGUMENT",
  })

  const account = routeAccount(context)
  let raw: unknown
  try {
    raw = await publicClient.readContract({
      address: contract.address,
      abi: contract.abi,
      functionName: routeCall.function,
      args,
      account,
    })
  } catch (cause) {
    throw new CamEvmError("CAM_ROUTE_CALL_FAILED", `failed to call CAM route: ${route}`, cause)
  }

  return normalizeRouteResult(raw, route, routeFunctionOutputs(routeFunction, route))
}

type CallCamRouteOptions = {
  readonly publicClient: CamPublicClient
  readonly cam: CamDocument
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

function normalizeRouteResult(
  raw: unknown,
  route: string,
  routeOutputs: readonly AbiParameter[],
): RouteResult {
  const outputs = normalizeRawRouteOutputs(raw, route, routeOutputs.length)
  if (outputs.length !== routeOutputs.length) {
    throw new CamEvmError(
      "CAM_ROUTE_INVALID_RESULT",
      `CAM route ${route} returned ${outputs.length} value(s), but its ABI declares ${routeOutputs.length}`,
    )
  }

  return {
    values: normalizeRouteValues(outputs, routeOutputs, route),
  }
}

function normalizeRawRouteOutputs(raw: unknown, route: string, outputCount: number): readonly unknown[] {
  if (outputCount === 0) {
    if (raw !== undefined) {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route ${route} returned a value, but its ABI declares none`)
    }

    return []
  }

  if (outputCount === 1) {
    return [raw]
  }

  if (!Array.isArray(raw)) {
    throw new CamEvmError(
      "CAM_ROUTE_INVALID_RESULT",
      `CAM route ${route} returned one value, but its ABI declares ${outputCount}`,
    )
  }

  return raw
}

function normalizeRouteValues(
  values: readonly unknown[],
  outputs: readonly AbiParameter[],
  route: string,
): readonly InertValue[] {
  return values.map((value, index) => {
    const output = outputs[index]
    if (output === undefined) {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route ABI is missing output metadata at ${route}.${index}`)
    }

    return normalizeAbiValue(value, output, `${route}.${index}`)
  })
}

function normalizeAbiValue(value: unknown, parameter: AbiParameter, path: string): InertValue {
  const type = parameter.type

  if (type.endsWith("[]")) {
    if (!Array.isArray(value)) {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected array for ${type} at ${path}`)
    }

    return value.map((item, index) =>
      normalizeAbiValue(item, { ...parameter, type: type.slice(0, -2) }, `${path}.${index}`),
    )
  }

  if (/\[[0-9]+\]$/.test(type)) {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output fixed-size arrays are not supported at ${path}`)
  }

  if (isTupleParameter(parameter)) {
    return normalizeTupleValue(value, parameter, path)
  }

  if (type === "tuple") {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route ABI tuple has no components at ${path}`)
  }

  if (type === "string") {
    if (typeof value !== "string") {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected string at ${path}`)
    }
    return value
  }

  if (type === "address") {
    if (typeof value !== "string" || !isAddress(value)) {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected address at ${path}`)
    }
    return value
  }

  if (type === "bool") {
    if (typeof value !== "boolean") {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected bool at ${path}`)
    }
    return value
  }

  const integerType = parseIntegerType(type)
  if (integerType !== undefined) {
    return normalizeIntegerOutput(value, integerType, path)
  }

  const fixedBytesLength = parseFixedBytesLength(type)
  if (type === "bytes" || fixedBytesLength !== undefined) {
    return normalizeBytesOutput(value, type, fixedBytesLength, path)
  }

  throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `unsupported CAM route output ABI type at ${path}: ${type}`)
}

type AbiTupleParameter = AbiParameter & {
  readonly type: "tuple"
  readonly components: readonly AbiParameter[]
}

function isTupleParameter(parameter: AbiParameter): parameter is AbiTupleParameter {
  if (parameter.type !== "tuple") {
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

type IntegerType = {
  readonly bits: number
  readonly signed: boolean
}

function normalizeIntegerOutput(value: unknown, type: IntegerType, path: string): string {
  if (typeof value !== "bigint") {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected bigint integer at ${path}`)
  }

  const bits = BigInt(type.bits)
  const min = type.signed ? -(1n << (bits - 1n)) : 0n
  const max = type.signed ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n
  if (value < min || value > max) {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output integer is out of range at ${path}`)
  }

  return value.toString()
}

function normalizeBytesOutput(value: unknown, type: string, fixedBytesLength: number | undefined, path: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/.test(value)) {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected hex bytes for ${type} at ${path}`)
  }
  if ((value.length - 2) % 2 !== 0) {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected whole-byte hex for ${type} at ${path}`)
  }
  if (fixedBytesLength !== undefined && (value.length - 2) / 2 !== fixedBytesLength) {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected ${fixedBytesLength} byte hex for ${type} at ${path}`)
  }

  return value
}

function parseIntegerType(type: string): IntegerType | undefined {
  const match = /^(u?)int([0-9]*)$/.exec(type)
  if (match === null) return undefined

  const bits = match[2] === "" ? 256 : Number(match[2])
  if (!Number.isInteger(bits) || bits < 8 || bits > 256 || bits % 8 !== 0) {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `unsupported CAM route output integer type: ${type}`)
  }

  return { bits, signed: match[1] === "" }
}

function parseFixedBytesLength(type: string): number | undefined {
  const match = /^bytes([0-9]+)$/.exec(type)
  if (match === null) return undefined

  const bytes = Number(match[1])
  if (!Number.isInteger(bytes) || bytes < 1 || bytes > 32) {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `unsupported CAM route output bytes type: ${type}`)
  }

  return bytes
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

function routeFunctionOutputs(fn: AbiFunction, route: string): readonly AbiParameter[] {
  if (!Array.isArray(fn.outputs)) {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route ABI is missing outputs: ${route}`)
  }

  return fn.outputs
}
