import { resolveResourceURI, resolveRouteCall } from "@cam/core"
import type { Abi, AbiFunction, Address } from "viem"

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

  return {
    screenURI: resolveResourceURI(camURI, screenURI),
    values,
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
