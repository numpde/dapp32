import {
  createContext,
  resolveRouteCall,
  resolveRouteThen,
  routeRequiresAccount,
} from "@cam/core"
import {
  isCamNamespaceNameForType,
  toInertValue,
} from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import type { CamHost, ResolvedCamContract } from "@cam/evm-viem"
import type { InertRecord } from "@cam/protocol"

import { CamViewerError } from "./errors.ts"
import type {
  CamViewerAccount,
  CamViewerPreparedContractCall,
} from "./types.ts"

export function prepareViewerContractCall({
  cam,
  contracts,
  host,
  account,
  route,
  inputs,
}: {
  readonly cam: CamDocument
  readonly contracts: Record<string, ResolvedCamContract>
  readonly host: CamHost
  readonly account?: CamViewerAccount
  readonly route: string
  readonly inputs: InertRecord
}): CamViewerPreparedContractCall {
  const routeDeclaration = cam.routes[route]
  if (routeDeclaration === undefined) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM write route does not exist: ${route}`)
  }
  if (routeDeclaration.kind !== "write") {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM contract action route must be declared as write: ${route}`)
  }
  if (account === undefined && routeRequiresAccount(cam, route)) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM route requires an account: ${route}`)
  }

  const context = createContext({
    host,
    ...(account === undefined ? {} : { account }),
    inputs,
    outputs: [],
  })
  const call = resolveRouteCall(cam, route, context)
  if (!isCamNamespaceNameForType(call.namespace, "contract")) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM write route must call a contract namespace: ${route}`)
  }
  const contract = contracts[call.namespace]
  if (contract === undefined) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM contract action references unresolved namespace: ${call.namespace}`)
  }

  return {
    route,
    address: contract.address,
    abi: cloneContractAbi(contract.abi),
    function: call.function,
    args: call.args,
    then: resolveRouteThen(cam, route, context),
  }
}

function cloneContractAbi(abi: ResolvedCamContract["abi"]): ResolvedCamContract["abi"] {
  try {
    return toInertValue(abi) as ResolvedCamContract["abi"]
  } catch (cause) {
    throw new CamViewerError(
      "CAM_VIEWER_INVALID_INERT_VALUE",
      "CAM viewer data is not safely cloneable: contract.abi",
      cause,
    )
  }
}
