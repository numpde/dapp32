import { resolveResourceURI, resolveRouteCall } from "@cam/core"
import type { Abi, Address } from "viem"

import { CamEvmError } from "./errors.ts"
import type { CallCamRouteOptions, RouteResult } from "./types.ts"

type AbiFunction = {
  readonly type: "function"
  readonly name: string
  readonly outputs?: readonly { readonly name?: string }[]
}

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
  const functionAbi = findUniqueFunctionAbi(contract.abi, routeCall.function)

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

  return {
    route,
    screenURI: resolveResourceURI(camURI, screenURI),
    raw,
    outputs: mapRouteOutputs({
      functionAbi,
      values,
    }),
  }
}

function findUniqueFunctionAbi(abi: Abi, functionName: string): AbiFunction {
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

  return matches[0]
}

function mapRouteOutputs({
  functionAbi,
  values,
}: {
  functionAbi: AbiFunction
  values: readonly unknown[]
}): Record<string, unknown> {
  const outputs = functionAbi.outputs ?? []
  const result: Record<string, unknown> = {}

  for (let valueIndex = 1; valueIndex < values.length; valueIndex++) {
    const outputIndex = valueIndex - 1
    result[String(outputIndex)] = values[valueIndex]

    const name = outputs[valueIndex]?.name
    if (name !== undefined && name.length > 0) {
      result[name] = values[valueIndex]
    }
  }

  return result
}
