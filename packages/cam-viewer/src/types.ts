import type { CamDocument } from "@cam/core"
import type {
  CamHost,
  ResolvedCamContract,
  ResourceLoader,
} from "@cam/evm-viem"
import type {
  ContractCallAction,
  ResolvedScreen,
  ResolvedScreenAction,
  ScreenDocument,
} from "@cam/screen"
import type { Address, PublicClient } from "viem"

export type CamViewerAccount = {
  readonly address: Address
}

export type CreateCamViewerSessionOptions = {
  readonly publicClient: PublicClient
  readonly host: CamHost
  readonly loadResource: ResourceLoader
  readonly account?: CamViewerAccount
  // TODO(inert-values): initial params/state are untrusted host inputs. Use
  // Record<string, InertValue> once the package graph exposes that type.
  readonly params?: Record<string, unknown>
  readonly state?: Record<string, unknown>
}

export type CamViewerSnapshot = {
  readonly loaded: boolean
  readonly route?: string
  // TODO(inert-values): snapshots should expose inert copies so renderers
  // cannot mutate session-owned data or receive live host objects.
  readonly params: Record<string, unknown>
  readonly state: Record<string, unknown>
  readonly account?: CamViewerAccount
  readonly screenURI?: string
  readonly screen?: ScreenDocument
  readonly resolvedScreen?: ResolvedScreen
  // TODO(inert-values): route values should be frozen at the protocol boundary
  // as readonly InertValue[] before snapshot exposure.
  readonly values?: readonly unknown[]
}

export type CamViewerSession = {
  readonly snapshot: () => CamViewerSnapshot
  readonly load: () => Promise<CamViewerSnapshot>
  readonly navigate: (
    route: string,
    // TODO(inert-values): navigation params are caller-provided route input.
    params?: Record<string, unknown>,
  ) => Promise<CamViewerSnapshot>
  readonly setAccount: (account?: CamViewerAccount) => Promise<CamViewerSnapshot>
  // TODO(inert-values): screen state patches are renderer input and should be
  // validated through toInertValue before storage.
  readonly setState: (patch: Record<string, unknown>) => CamViewerSnapshot
  readonly dispatchAction: (action: ResolvedScreenAction) => Promise<CamViewerActionResult>
}

export type CamViewerActionResult =
  | { readonly type: "navigated"; readonly snapshot: CamViewerSnapshot }
  | { readonly type: "contractCall"; readonly action: ContractCallAction }

export type CamViewerLoadedState = {
  readonly cam: CamDocument
  readonly camURI: string
  readonly contracts: Record<string, ResolvedCamContract>
}
