import type { CamRuntimeContext, InertValue } from "@cam/core"

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

export type ScreenAction = NavigateAction | ContractCallAction

export type NavigateAction = {
  readonly route: string
  readonly params: Record<string, InertValue>
}

export type ContractCallAction = {
  readonly contract: string
  readonly function: string
  readonly args: readonly InertValue[]
  readonly onSuccess?: NavigateAction
}

export type ScreenRuntimeContext = CamRuntimeContext & {
  readonly state: Record<string, InertValue>
  readonly values: readonly InertValue[]
}

export type ResolvedScreen = {
  readonly title?: string
  readonly elements: readonly ResolvedScreenElement[]
}

export type ResolvedScreenElement =
  | Omit<TextElement, "visibleWhen">
  | Omit<InputElement, "visibleWhen">
  | Omit<AddressElement, "visibleWhen">
  | Omit<ButtonElement, "visibleWhen">
  | Omit<StatusElement, "visibleWhen">
  | Omit<NftElement, "visibleWhen">

export type ResolvedScreenAction = ScreenAction
