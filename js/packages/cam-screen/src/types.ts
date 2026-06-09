import type { CamRuntimeContext, InertRecord, InertValue } from "@cam/protocol"

export type UiDocument = {
  readonly ui: string
  readonly nodes: Record<string, UiNode>
}

export type UiNode =
  | ScreenNode
  | FragmentNode
  | TextNode
  | TextFieldNode
  | AddressNode
  | StatusNode
  | NftNode
  | IncludeNode
  | ButtonNode

export type UiNodeBase = {
  readonly requires?: readonly string[]
}

export type ScreenNode = UiNodeBase & {
  readonly element: "Screen"
  readonly props: InertRecord
  readonly children: readonly UiNode[]
}

export type FragmentNode = UiNodeBase & {
  readonly element: "Fragment"
  readonly children: readonly UiNode[]
}

export type TextNode = UiNodeBase & {
  readonly element: "Text"
  readonly props: InertRecord
}

export type TextFieldNode = UiNodeBase & {
  readonly element: "TextField"
  readonly props: InertRecord
  readonly state: UiStateBinding
}

export type AddressNode = UiNodeBase & {
  readonly element: "Address"
  readonly props: InertRecord
}

export type StatusNode = UiNodeBase & {
  readonly element: "Status"
  readonly props: InertRecord
}

export type NftNode = UiNodeBase & {
  readonly element: "Nft"
  readonly props: InertRecord
}

export type IncludeNode = UiNodeBase & {
  readonly element: "Include"
  readonly call: UiCall
}

export type ButtonNode = UiNodeBase & {
  readonly element: "Button"
  readonly props: InertRecord
  readonly call: UiCall
}

export type UiCall = {
  readonly namespace: string
  readonly function: InertValue
  readonly args: InertRecord
}

export type UiStateBinding = {
  readonly key: InertValue
  readonly defaultValue: InertValue
}

export type UiRuntimeContext = CamRuntimeContext & {
  readonly state: InertRecord
  readonly [key: string]: InertValue | undefined
}

export type ResolvedUiNode =
  | ResolvedElementNode
  | ResolvedButtonNode

export type ResolvedElementNode = {
  readonly element: Exclude<UiNode["element"], "Include" | "Button">
  readonly props: InertRecord
  readonly state?: ResolvedUiStateBinding
  readonly children: readonly ResolvedUiNode[]
}

export type ResolvedUiStateBinding = {
  readonly key: string
  readonly defaultValue?: string
}

export type ResolvedButtonNode = {
  readonly element: "Button"
  readonly props: InertRecord
  readonly call: ResolvedUiCall
}

export type ResolvedUiCall = {
  readonly namespace: string
  readonly function: string
  readonly args: InertRecord
}
