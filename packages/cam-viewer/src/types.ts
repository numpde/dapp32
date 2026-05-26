import type { InertValue } from "@cam/core"
import type {
  CamHost,
  LoadCamFromHostOptions,
  ResourceLoader,
} from "@cam/evm-viem"
import type {
  ContractCallAction,
  ResolvedScreen,
  ResolvedScreenAction,
  ScreenDocument,
} from "@cam/screen"

export type CamViewerAccount = {
  readonly address: CamHost["address"]
}

export type CreateCamViewerSessionOptions = {
  readonly publicClient: LoadCamFromHostOptions["publicClient"]
  readonly host: CamHost
  readonly loadResource: ResourceLoader
  readonly account?: CamViewerAccount
  readonly params?: Record<string, InertValue>
  readonly state?: Record<string, InertValue>
}

export type CamViewerSnapshot = {
  readonly loaded: boolean
  readonly route?: string
  readonly params: Record<string, InertValue>
  readonly state: Record<string, InertValue>
  readonly account?: CamViewerAccount
  readonly screenURI?: string
  readonly screen?: ScreenDocument
  readonly resolvedScreen?: ResolvedScreen
  readonly values?: readonly InertValue[]
}

export type CamViewerSession = {
  readonly snapshot: () => CamViewerSnapshot
  readonly load: () => Promise<CamViewerSnapshot>
  readonly navigate: (
    route: string,
    params?: Record<string, InertValue>,
  ) => Promise<CamViewerSnapshot>
  readonly setAccount: (account?: CamViewerAccount) => Promise<CamViewerSnapshot>
  readonly setState: (patch: Record<string, InertValue>) => CamViewerSnapshot
  readonly dispatchAction: (action: ResolvedScreenAction) => Promise<CamViewerActionResult>
}

export type CamViewerActionResult =
  | { readonly type: "navigated"; readonly snapshot: CamViewerSnapshot }
  | { readonly type: "contractCall"; readonly action: ContractCallAction }
