import type { CamRuntimeContext } from "@cam/core"
import type { InertRecord, InertValue } from "@cam/protocol"

export type ScreenDocument = {
  readonly screen: string
  readonly title?: string
  readonly elements: readonly ScreenElement[]
}

export type ScreenElement =
  | TextElement
  | InputElement
  | AddressElement
  | ButtonElement
  | StatusElement
  | NftElement
  | GroupElement

export type LeafScreenElement = Exclude<ScreenElement, GroupElement>

type ResolvedLeaf<T> = T extends ElementVisibility ? Omit<T, "visibleWhen"> : never

type ElementVisibility = {
  readonly visibleWhen?: InertValue
}

export type TextElement = ElementVisibility & {
  readonly type: "text"
  readonly text: string
}

export type InputElement = ElementVisibility & {
  readonly type: "input"
  readonly name: string
  readonly label: string
  readonly value?: InertValue
}

export type AddressElement = ElementVisibility & {
  readonly type: "address"
  readonly label?: string
  readonly address: string
}

export type ButtonElement = ElementVisibility & {
  readonly type: "button"
  readonly label: string
  readonly action: ScreenAction
}

export type StatusElement = ElementVisibility & {
  readonly type: "status"
  readonly label?: string
  readonly value: InertValue
}

export type NftElement = ElementVisibility & {
  readonly type: "nft"
  readonly contractAddress: string
  readonly tokenId: InertValue
}

export type GroupElement = ElementVisibility & {
  readonly type: "group"
  readonly elements: readonly ScreenElement[]
}

export type ScreenAction = NavigateAction | ContractCallAction

export type NavigateAction = {
  readonly route: string
  readonly params: InertRecord
}

export type ContractCallAction = {
  readonly contract: string
  readonly function: string
  readonly args: readonly InertValue[]
  readonly onSuccess?: NavigateAction
}

export type ScreenRuntimeContext = CamRuntimeContext & {
  readonly state: InertRecord
  readonly values: readonly InertValue[]
}

export type ResolvedScreen = {
  readonly title?: string
  readonly elements: readonly ResolvedScreenElement[]
}

export type ResolvedScreenElement = ResolvedLeaf<LeafScreenElement>

export type ResolvedScreenAction = ScreenAction
