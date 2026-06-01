import type { CamRuntimeContext, InertRecord, InertValue } from "@cam/protocol"

export type UiDocument = {
  readonly ui: string
  readonly nodes: Record<string, UiNode>
}

export type UiNode =
  | ScreenNode
  | FragmentNode
  | TextNode
  | InputNode
  | AddressNode
  | StatusNode
  | NftNode
  | IncludeNode
  | ActionNode

export type UiNodeBase = {
  readonly requires?: readonly string[]
}

export type ScreenNode = UiNodeBase & {
  readonly tag: "Screen"
  readonly props: InertRecord
  readonly children: readonly UiNode[]
}

export type FragmentNode = UiNodeBase & {
  readonly tag: "Fragment"
  readonly children: readonly UiNode[]
}

export type TextNode = UiNodeBase & {
  readonly tag: "Text"
  readonly props: InertRecord
}

export type InputNode = UiNodeBase & {
  readonly tag: "Input"
  readonly props: InertRecord
}

export type AddressNode = UiNodeBase & {
  readonly tag: "Address"
  readonly props: InertRecord
}

export type StatusNode = UiNodeBase & {
  readonly tag: "Status"
  readonly props: InertRecord
}

export type NftNode = UiNodeBase & {
  readonly tag: "Nft"
  readonly props: InertRecord
}

export type IncludeNode = UiNodeBase & {
  readonly tag: "Include"
  readonly call: UiCall
}

export type ActionNode = UiNodeBase & {
  readonly tag: "Action"
  readonly props: InertRecord
  readonly call: UiCall
}

export type UiCall = {
  readonly namespace: string
  readonly function: InertValue
  readonly args: InertRecord
}

export type UiRuntimeContext = CamRuntimeContext & {
  readonly [key: string]: InertValue | undefined
}

export type ResolvedUiNode =
  | ResolvedElementNode
  | ResolvedActionNode

export type ResolvedElementNode = {
  readonly tag: Exclude<UiNode["tag"], "Include" | "Action">
  readonly props: InertRecord
  readonly children: readonly ResolvedUiNode[]
}

export type ResolvedActionNode = {
  readonly tag: "Action"
  readonly props: InertRecord
  readonly call: ResolvedUiCall
}

export type ResolvedUiCall = {
  readonly namespace: string
  readonly function: string
  readonly args: InertRecord
}
