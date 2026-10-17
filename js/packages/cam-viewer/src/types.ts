import type { InertRecord, InertValue } from "@cam/protocol"
import type { CamResolvedInvocation } from "@cam/core"
import type {
  CamContractCall,
  CamHost,
  CamPublicClient,
  ResourceLoader,
} from "@cam/evm-viem"
import type {
  ResolvedButtonNode,
  ResolvedUiNode,
} from "@cam/screen"

export type CamViewerAccount = {
  readonly address: CamHost["address"]
}

export type CreateCamViewerSessionOptions = {
  readonly publicClient: CamPublicClient
  readonly host: CamHost
  readonly loadResource: ResourceLoader
  readonly account?: CamViewerAccount
  readonly inputs: InertRecord
  /** Omit to load the contract-anchored manifest entry. */
  readonly route?: string
}

export type CamViewerSnapshot = {
  readonly canGoBack: boolean
  readonly route?: string
  readonly inputs: InertRecord
  readonly documentHashes?: Readonly<Record<string, CamViewerDocumentHashStatus>>
  readonly state?: InertRecord
  readonly account?: CamViewerAccount
  readonly uiURI?: string
  readonly resolvedUi?: ResolvedUiNode
  readonly values?: readonly InertValue[]
}

export type CamViewerLoadedSnapshot =
  Omit<CamViewerSnapshot, "state" | "inputs" | "resolvedUi" | "route" | "uiURI" | "values" | "documentHashes"> & {
    readonly documentHashes: Readonly<Record<string, CamViewerDocumentHashStatus>>
    readonly route: string
    readonly inputs: InertRecord
    readonly state: InertRecord
    readonly uiURI: string
    readonly resolvedUi: ResolvedUiNode
    readonly values: readonly InertValue[]
  }

export type CamViewerDocumentHashStatus = {
  readonly status: "pending" | "succeeded" | "failed"
  readonly source: "url" | "file"
  readonly sourceURI?: string
  readonly message?: string
}

export type CamViewerDocumentHashOperation = {
  readonly snapshot: CamViewerLoadedSnapshot
  readonly signal: AbortSignal
  readonly sourceURI?: string
  readonly complete: (digest: string) => CamViewerLoadedSnapshot | undefined
  readonly fail: (message: string) => CamViewerLoadedSnapshot | undefined
}

export type CamViewerSession = {
  readonly beginDocumentHash: (name: string, source: "url" | "file") => CamViewerDocumentHashOperation
  readonly cancelDocumentHash: (name: string) => CamViewerLoadedSnapshot
  readonly snapshot: () => CamViewerSnapshot
  readonly load: () => Promise<CamViewerLoadedSnapshot>
  readonly back: () => Promise<CamViewerLoadedSnapshot>
  readonly refresh: () => Promise<CamViewerLoadedSnapshot>
  readonly navigate: (
    /** Undefined selects the loaded manifest entry. */
    route: string | undefined,
    inputs: InertRecord,
  ) => Promise<CamViewerLoadedSnapshot>
  readonly setAccount: (account?: CamViewerAccount) => Promise<CamViewerLoadedSnapshot>
  readonly updateState: (patch: InertRecord) => CamViewerLoadedSnapshot
  readonly editAmount: (name: string, representation: "base" | "display", text: string, options?: { readonly composing?: boolean }) => CamViewerLoadedSnapshot
  readonly editDuration: (name: string, part: import("@cam/screen").DurationPart, text: string, options?: { readonly composing?: boolean }) => CamViewerLoadedSnapshot
  readonly editInteger: (name: string, text: string, options?: { readonly composing?: boolean }) => CamViewerLoadedSnapshot
  readonly actionKind: (action: ResolvedButtonNode) => import("./interactions.ts").RenderedActionClassification["type"]
  readonly dispatchAction: (action: ResolvedButtonNode) => Promise<CamViewerActionResult>
}

export type CamViewerActionResult =
  | { readonly type: "navigated"; readonly snapshot: CamViewerLoadedSnapshot }
  | { readonly type: "contractCall"; readonly call: CamViewerPreparedContractCall }

export type CamViewerPreparedContractCall = CamContractCall & {
  readonly route: string
  readonly then: CamResolvedInvocation
}
