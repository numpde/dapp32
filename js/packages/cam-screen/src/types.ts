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
  readonly enabledWhen?: UiMembership
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
  readonly enabledWhen?: UiMembership
  readonly props: InertRecord
  readonly call: UiCall
}

export type UiMembership = {
  readonly member: string
  readonly in: string | readonly string[]
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

export type ResolvedElementNode =
  | ResolvedContainerNode
  | ResolvedLeafElementNode
  | ResolvedTextFieldNode
  | ResolvedStatusNode

export type ResolvedContainerNode = {
  readonly element: Extract<UiNode["element"], "Screen" | "Fragment">
  readonly props: InertRecord
  readonly children: readonly ResolvedUiNode[]
}

export type ResolvedLeafElementNode = {
  readonly element: Exclude<UiNode["element"], "Include" | "Button" | "Screen" | "Fragment" | "TextField" | "Status">
  readonly props: InertRecord
  readonly children: readonly []
}

export type ResolvedStatusNode = {
  readonly element: "Status"
  readonly props: InertRecord
  readonly formattedValue?: string
  readonly children: readonly []
}

export type ResolvedTextFieldNode = {
  readonly element: "TextField"
  readonly disabled?: boolean
  readonly props: InertRecord
  readonly state: ResolvedUiStateBinding
  readonly children: readonly []
}

export type ResolvedUiStateBinding = {
  readonly key: string
  readonly defaultValue?: string
}

export type ResolvedButtonNode = {
  readonly element: "Button"
  readonly disabled?: boolean
  readonly props: InertRecord
  readonly call: ResolvedUiCall
}

export type ResolvedUiCall = {
  readonly namespace: string
  readonly function: string
  readonly args: InertRecord
}
