import { resolveResourceURI, resolveRouteCall } from "@cam/core"
import type { Abi, Address } from "viem"

import { CamEvmError } from "./errors.ts"
import type { CallCamRouteOptions, RouteResult } from "./types.ts"

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
      abi: contract.abi,
      functionName: routeCall.function,
      values,
    }),
  }
}

function mapRouteOutputs({
  abi,
  functionName,
  values,
}: {
  abi: Abi
  functionName: string
  values: readonly unknown[]
}): Record<string, unknown> {
  const fn = abi.find((item) => item.type === "function" && item.name === functionName)
  const outputs = fn?.type === "function" ? (fn.outputs ?? []) : []
  const result: Record<string, unknown> = {}

  for (let index = 0; index < values.length; index++) {
    result[String(index)] = values[index]

    const name = outputs[index]?.name
    if (name !== undefined && name.length > 0) {
      result[name] = values[index]
    }
  }

  return result
}
