import type {
  CamViewerSession,
  CreateCamViewerSessionOptions,
} from "../../packages/cam-viewer/dist/index.js"
import type { InertValue } from "../../packages/cam-protocol/dist/index.js"

export type DebugEvent =
  | {
    readonly step: number
    readonly kind: "contract-read"
    readonly functionName: string
    readonly args: readonly InertValue[]
    readonly result: unknown
  }
  | {
    readonly step: number
    readonly kind: "resource-load"
    readonly uri: string
    readonly bytes: number
  }

export type TerminalBackend = {
  readonly name: string
  readonly description: string
  readonly hostLabel: string
  readonly createSession: (events: DebugEvent[]) => CamViewerSession
}

export type TerminalPublicClient = CreateCamViewerSessionOptions["publicClient"]
