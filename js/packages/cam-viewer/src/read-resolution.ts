import {
  createContext,
} from "@cam/core"
import {
  callCamRoute,
} from "@cam/evm-viem"
import type { CamDocument } from "@cam/core"
import type { CamHost, CamPublicClient, ResolvedCamContract } from "@cam/evm-viem"
import type { InertRecord, InertValue } from "@cam/protocol"
import type { ResolvedUiNode, UiDocument } from "@cam/screen"

import { CamViewerError } from "./errors.ts"
import { assertViewerRouteAccountAvailable } from "./route-preflight.ts"
import { resolveViewerInitialUi } from "./ui-resolution.ts"
import type { CamViewerAccount } from "./types.ts"

export type ViewerResolvedReadView = {
  readonly route: string
  readonly inputs: InertRecord
  readonly state: InertRecord
  readonly resolvedUi: ResolvedUiNode
  readonly values: readonly InertValue[]
}

export async function resolveViewerReadRoute({
  publicClient,
  cam,
  contracts,
  ui,
  host,
  account,
  route,
  inputs,
}: {
  readonly publicClient: CamPublicClient
  readonly cam: CamDocument
  readonly contracts: Record<string, ResolvedCamContract>
  readonly ui: UiDocument
  readonly host: CamHost
  readonly account?: CamViewerAccount
  readonly route: string
  readonly inputs: InertRecord
}): Promise<ViewerResolvedReadView> {
  const routeDeclaration = cam.routes[route]
  if (routeDeclaration === undefined || routeDeclaration.kind !== "read") {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM navigation route must be declared as read: ${route}`)
  }
  assertViewerRouteAccountAvailable({
    cam,
    route,
    ...(account === undefined ? {} : { account }),
  })

  const routeResult = await callCamRoute({
    publicClient,
    cam,
    contracts,
    route,
    context: createContext({
      host,
      ...(account === undefined ? {} : { account }),
      inputs,
      outputs: [],
    }),
  })

  const initial = resolveViewerInitialUi({
    cam,
    ui,
    host,
    ...(account === undefined ? {} : { account }),
    route,
    inputs,
    values: routeResult.values,
  })

  return {
    route,
    inputs,
    state: initial.state,
    resolvedUi: initial.resolvedUi,
    values: routeResult.values,
  }
}
