import type { InertRecord, InertValue } from "@cam/protocol"
import type {
  CamContractCall,
  CamHost,
  CamPublicClient,
  ResourceLoader,
} from "@cam/evm-viem"
import type {
  ResolvedActionNode,
  ResolvedUiCall,
  ResolvedUiNode,
} from "@cam/screen"

export type CamViewerAccount = {
  readonly address: CamHost["address"]
}

export type CreateCamViewerSessionOptions = {
  readonly publicClient: CamPublicClient
  readonly host: CamHost
  readonly loadResource: ResourceLoader
  readonly allowUnsignedCamHash: boolean
  readonly account?: CamViewerAccount
  readonly inputs: InertRecord
}

export type CamViewerSnapshot = {
  readonly route?: string
  readonly inputs: InertRecord
  readonly form?: InertRecord
  readonly account?: CamViewerAccount
  readonly uiURI?: string
  readonly resolvedUi?: ResolvedUiNode
  readonly values?: readonly InertValue[]
}

export type CamViewerLoadedSnapshot =
  Omit<CamViewerSnapshot, "form" | "inputs" | "resolvedUi" | "route" | "uiURI" | "values"> & {
    readonly route: string
    readonly inputs: InertRecord
    readonly form: InertRecord
    readonly uiURI: string
    readonly resolvedUi: ResolvedUiNode
    readonly values: readonly InertValue[]
  }

export type CamViewerSession = {
  readonly snapshot: () => CamViewerSnapshot
  readonly load: () => Promise<CamViewerLoadedSnapshot>
  readonly navigate: (
    route: string,
    inputs: InertRecord,
  ) => Promise<CamViewerLoadedSnapshot>
  readonly setAccount: (account?: CamViewerAccount) => Promise<CamViewerLoadedSnapshot>
  readonly updateForm: (patch: InertRecord) => CamViewerLoadedSnapshot
  readonly dispatchAction: (action: ResolvedActionNode) => Promise<CamViewerActionResult>
}

export type CamViewerActionResult =
  | { readonly type: "navigated"; readonly snapshot: CamViewerLoadedSnapshot }
  | { readonly type: "contractCall"; readonly call: CamViewerPreparedContractCall }

export type CamViewerPreparedContractCall = CamContractCall & {
  readonly route: string
  readonly then: ResolvedUiCall
}
