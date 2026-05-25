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
  readonly params?: Record<string, unknown>
  readonly state?: Record<string, unknown>
}

export type CamViewerSnapshot = {
  readonly loaded: boolean
  readonly route?: string
  readonly params: Record<string, unknown>
  readonly state: Record<string, unknown>
  readonly account?: CamViewerAccount
  readonly screenURI?: string
  readonly screen?: ScreenDocument
  readonly resolvedScreen?: ResolvedScreen
  readonly values?: readonly unknown[]
}

export type CamViewerSession = {
  readonly snapshot: () => CamViewerSnapshot
  readonly load: () => Promise<CamViewerSnapshot>
  readonly navigate: (
    route: string,
    params?: Record<string, unknown>,
  ) => Promise<CamViewerSnapshot>
  readonly setAccount: (account?: CamViewerAccount) => Promise<CamViewerSnapshot>
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
