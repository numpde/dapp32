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

export type CamViewerSession = {
  readonly snapshot: () => CamViewerSnapshot
  readonly load: () => Promise<CamViewerSnapshot>
  readonly navigate: (
    route: string,
    params: InertRecord,
  ) => Promise<CamViewerSnapshot>
  readonly setAccount: (account?: CamViewerAccount) => Promise<CamViewerSnapshot>
  readonly updateForm: (patch: InertRecord) => CamViewerSnapshot
  readonly dispatchAction: (action: ResolvedScreenAction) => Promise<CamViewerActionResult>
}

export type CamViewerActionResult =
  | { readonly type: "navigated"; readonly snapshot: CamViewerSnapshot }
  | { readonly type: "contractCall"; readonly call: CamViewerPreparedContractCall }

export type CamViewerPreparedContractCall = CamContractCall & {
  readonly contract: ResolvedContractCallAction["contract"]
  readonly onSuccess?: NavigateAction
}
