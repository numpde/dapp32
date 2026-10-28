import type { CamVersion, InertValue } from "@cam/protocol"

export type CamDocument = {
  readonly protocol: { readonly uri: string; readonly integrity: string }
  readonly cam: CamVersion
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

type CamRouteBase = {
  readonly inputs: readonly string[]
  readonly call: CamInvocation
  readonly then: CamInvocation
}

export type CamReadRoute = CamRouteBase & {
  readonly kind: "read"
}

export type CamWriteRoute = CamRouteBase & {
  readonly kind: "write"
  readonly review?: { readonly call: CamInvocation; readonly then: CamInvocation }
  readonly receipt?: { readonly event: string; readonly then: CamInvocation; readonly empty?: CamInvocation }
  readonly resolve?: CamInvocation
  readonly call: CamInvocation & { readonly target?: string }
  readonly value?: InertValue
}

export type CamRoute = CamReadRoute | CamWriteRoute

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

export type CamResolvedRouteCall = CamResolvedInvocation & {
  readonly target?: InertValue
  readonly value?: InertValue
}
