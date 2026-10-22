import {
  createContext,
  resolveRouteCall,
  resolveRouteThen,
} from "@cam/core"
import {
  validateCamContractCall,
  callCamRouteResolver,
  requireEvmAddress,
} from "@cam/evm-viem"
import { isCamNamespaceNameForType } from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import type { CamHost, CamPublicClient, ResolvedCamContract } from "@cam/evm-viem"
import type { InertRecord } from "@cam/protocol"

import { CamViewerError } from "./errors.ts"
import { cloneViewerData } from "./inert-data.ts"
import { assertViewerRouteAccountAvailable } from "./route-preflight.ts"
import type {
  CamViewerAccount,
  CamViewerPreparedContractCall,
} from "./types.ts"

export async function prepareViewerContractCall({
  publicClient,
  cam,
  contracts,
  host,
  account,
  route,
  inputs,
}: {
  readonly publicClient: CamPublicClient
  readonly cam: CamDocument
  readonly contracts: Record<string, ResolvedCamContract>
  readonly host: CamHost
  readonly account?: CamViewerAccount
  readonly route: string
  readonly inputs: InertRecord
}): Promise<CamViewerPreparedContractCall> {
  const routeDeclaration = cam.routes[route]
  if (routeDeclaration === undefined) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM write route does not exist: ${route}`)
  }
  if (routeDeclaration.kind !== "write") {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM contract action route must be declared as write: ${route}`)
  }
  assertViewerRouteAccountAvailable({
    cam,
    route,
    ...(account === undefined ? {} : { account }),
  })

  const context = createContext({
    host,
    ...(account === undefined ? {} : { account }),
    inputs,
    outputs: [],
  })
  const outputs = routeDeclaration.resolve === undefined ? [] : (await callCamRouteResolver({
    publicClient, cam, contracts, route, context,
  })).values
  const call = resolveRouteCall(cam, route, { ...context, outputs })
  if (!isCamNamespaceNameForType(call.namespace, "contract")) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM write route must call a contract namespace: ${route}`)
  }
  const contract = contracts[call.namespace]
  if (contract === undefined) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM contract action references unresolved namespace: ${call.namespace}`)
  }
  if (call.target !== undefined && typeof call.target !== "string") {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "Cannot prepare write: the resolved target is not an address string")
  }

  const prepared: CamViewerPreparedContractCall = {
    route,
    address: call.target === undefined ? contract.address : requireEvmAddress(call.target, "resolved write target"),
    abi: cloneViewerData(contract.abi, "contract.abi"),
    function: call.function,
    args: cloneViewerData(call.args, "call.args"),
    ...(call.value === undefined
      ? {}
      : { value: cloneViewerData(call.value, "call.value") }),
    then: cloneViewerData(resolveRouteThen(cam, route, context), "call.then"),
  }
  validateCamContractCall(prepared)
  return prepared
}
