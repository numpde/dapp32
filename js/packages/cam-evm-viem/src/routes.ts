import { resolveRouteCall } from "@cam/core"
import {
  createStringMap,
  isAbiAddressValue,
  isAbiBytesValue,
  isAbiIntegerValue,
  isFixedAbiArrayType,
  isRecordObject,
  parseAbiFixedBytesLength,
  parseAbiIntegerType,
} from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import type { AbiIntegerType, CamRuntimeContext, InertValue } from "@cam/protocol"
import { isAddress } from "viem"
import type { Abi, AbiFunction, AbiParameter, Address } from "viem"

import { abiFunctionInputs, normalizeAbiArgs } from "./arguments.ts"
import {
  dynamicArrayElement,
  isTupleParameter,
} from "./abi-values.ts"
import type { AbiTupleParameter } from "./abi-values.ts"
import { findUniqueAbiFunction, singleFunctionAbi } from "./abi-functions.ts"
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

  const routeDeclaration = cam.routes[route]
  if (routeDeclaration === undefined || routeDeclaration.kind !== "read") {
    throw new CamEvmError("CAM_ROUTE_INVALID_KIND", `CAM route must be declared as read before it can be called: ${route}`)
  }

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
      abi: singleFunctionAbi(routeFunction),
      functionName: routeFunction.name,
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

  const element = dynamicArrayElement(parameter)
  if (element !== undefined) {
    if (!Array.isArray(value)) {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected array for ${type} at ${path}`)
    }

    return value.map((item, index) => normalizeAbiValue(item, element, `${path}.${index}`))
  }

  if (isFixedAbiArrayType(type)) {
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
    if (!isAbiAddressValue(value)) {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected address at ${path}`)
    }
    return value.toLowerCase()
  }

  if (type === "bool") {
    if (typeof value !== "boolean") {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected bool at ${path}`)
    }
    return value
  }

  try {
    const integerType = parseAbiIntegerType(type)
    if (integerType !== undefined) {
      return normalizeIntegerOutput(value, integerType, path)
    }
  } catch (cause) {
    throw new CamEvmError(
      "CAM_ROUTE_INVALID_RESULT",
      `CAM route output ${cause instanceof Error ? cause.message : String(cause)} at ${path}`,
    )
  }

  let fixedBytesLength: number | undefined
  try {
    fixedBytesLength = parseAbiFixedBytesLength(type)
  } catch (cause) {
    throw new CamEvmError(
      "CAM_ROUTE_INVALID_RESULT",
      `CAM route output ${cause instanceof Error ? cause.message : String(cause)} at ${path}`,
    )
  }
  if (type === "bytes" || fixedBytesLength !== undefined) {
    return normalizeBytesOutput(value, type, fixedBytesLength, path)
  }

  throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `unsupported CAM route output ABI type at ${path}: ${type}`)
}

function normalizeTupleValue(value: unknown, parameter: AbiTupleParameter, path: string): InertValue {
  const record = createStringMap<InertValue>()
  const components = parameter.components.map((component, index) => {
    const name = component.name
    if (name === undefined || name.length === 0) {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route ABI tuple component is unnamed at ${path}.${index}`)
    }
    return { component, name }
  })
  const componentNames = new Set(components.map(({ name }) => name))

  if (isRecordObject(value)) {
    for (const name of Object.keys(value)) {
      if (!componentNames.has(name)) {
        throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route tuple has unexpected component ${name} at ${path}`)
      }
    }
  } else if (Array.isArray(value)) {
    if (value.length !== components.length) {
      throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route tuple has unexpected array length at ${path}`)
    }
  }

  components.forEach(({ component, name }, index) => {
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

function normalizeIntegerOutput(value: unknown, type: AbiIntegerType, path: string): string {
  const integer = integerOutputValue(value, path)

  if (!isAbiIntegerValue(integer.toString(), type)) {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output integer is out of range at ${path}`)
  }

  return integer.toString()
}

function integerOutputValue(value: unknown, path: string): bigint {
  if (typeof value === "bigint") {
    return value
  }

  // viem usually decodes ABI integers as bigint, but small enum/uint values
  // can cross real local RPC paths as safe JS numbers. Normalize both decoded
  // shapes before the bit-width range check so CAM exposes one inert string.
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value)
  }

  throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected bigint integer at ${path}`)
}

function normalizeBytesOutput(value: unknown, type: string, fixedBytesLength: number | undefined, path: string): string {
  if (!isAbiBytesValue(value, fixedBytesLength)) {
    throw new CamEvmError("CAM_ROUTE_INVALID_RESULT", `CAM route output expected hex bytes for ${type} at ${path}`)
  }

  return value
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
