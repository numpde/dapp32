import type { CamRouteKind, CamRuntimeContext, InertValue } from "@cam/protocol"

export type CamDocument = {
  readonly cam: string
  readonly entry: string
  readonly namespaces: Record<string, CamNamespace>
  readonly routes: Record<string, CamRoute>
}

export type CamNamespace =
  | CamContractNamespace
  | CamRoutesNamespace
  | CamUiNamespace

export type CamContractNamespace = {
  readonly type: "contract"
  readonly abiURI: string
  readonly integrity: string
}

export type CamRoutesNamespace = {
  readonly type: "routes"
}

export type CamUiNamespace = {
  readonly type: "ui"
  readonly uri: string
  readonly integrity: string
}

export type CamRoute = {
  readonly kind: CamRouteKind
  readonly inputs: readonly string[]
  readonly call: CamInvocation
  readonly then: CamInvocation
}

export type CamInvocation = {
  readonly namespace: string
  readonly function: string
  readonly args: Record<string, InertValue>
}

export type CamResolvedInvocation = {
  readonly namespace: string
  readonly function: string
  readonly args: Record<string, InertValue>
}
