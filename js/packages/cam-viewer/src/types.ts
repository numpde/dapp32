import type { InertRecord, InertValue } from "@cam/protocol"
import type {
  CamContractCall,
  CamHost,
  CamPublicClient,
  ResourceLoader,
} from "@cam/evm-viem"
import type {
  ResolvedScreen,
  ResolvedScreenAction,
} from "@cam/screen"
import type { NavigateAction } from "@cam/screen"

type ResolvedContractCallAction = Extract<ResolvedScreenAction, { readonly type: "contract-call" }>

export type CamViewerAccount = {
  readonly address: CamHost["address"]
}

export type CreateCamViewerSessionOptions = {
  readonly publicClient: CamPublicClient
  readonly host: CamHost
  readonly loadResource: ResourceLoader
  readonly allowUnsignedCamHash: boolean
  readonly account?: CamViewerAccount
  readonly params: InertRecord
}

export type CamViewerSnapshot = {
  readonly route?: string
  readonly params: InertRecord
  readonly form?: InertRecord
  readonly account?: CamViewerAccount
  readonly screenURI?: string
  readonly resolvedScreen?: ResolvedScreen
  readonly values?: readonly InertValue[]
}

export type CamViewerLoadedSnapshot = Omit<CamViewerSnapshot, "form" | "resolvedScreen" | "route" | "screenURI" | "values"> & {
  readonly route: string
  readonly form: InertRecord
  readonly screenURI: string
  readonly resolvedScreen: ResolvedScreen
  readonly values: readonly InertValue[]
}

export type CamViewerSession = {
  readonly snapshot: () => CamViewerSnapshot
  readonly load: () => Promise<CamViewerLoadedSnapshot>
  readonly navigate: (
    route: string,
    params: InertRecord,
  ) => Promise<CamViewerLoadedSnapshot>
  readonly setAccount: (account?: CamViewerAccount) => Promise<CamViewerLoadedSnapshot>
  readonly updateForm: (patch: InertRecord) => CamViewerLoadedSnapshot
  readonly dispatchAction: (action: ResolvedScreenAction) => Promise<CamViewerActionResult>
}

export type CamViewerActionResult =
  | { readonly type: "navigated"; readonly snapshot: CamViewerLoadedSnapshot }
  | { readonly type: "contractCall"; readonly call: CamViewerPreparedContractCall }

export type CamViewerPreparedContractCall = CamContractCall & {
  readonly contract: ResolvedContractCallAction["contract"]
  readonly onSuccess?: NavigateAction
}
