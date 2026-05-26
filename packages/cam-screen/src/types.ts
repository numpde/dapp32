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

export type TextElement = {
  readonly type: "text"
  readonly text: string
}

export type InputElement = {
  readonly type: "input"
  readonly name: string
  readonly label: string
  readonly value?: InertValue
}

export type AddressElement = {
  readonly type: "address"
  readonly label?: string
  readonly address: string
}

export type ButtonElement = {
  readonly type: "button"
  readonly label: string
  readonly action: ScreenAction
}

export type StatusElement = {
  readonly type: "status"
  readonly label?: string
  readonly value: InertValue
}

export type NftElement = {
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
  | TextElement
  | InputElement
  | AddressElement
  | ResolvedButtonElement
  | StatusElement
  | NftElement

export type ResolvedButtonElement = {
  readonly type: "button"
  readonly label: string
  readonly action: ResolvedScreenAction
}

export type ResolvedScreenAction = ScreenAction
