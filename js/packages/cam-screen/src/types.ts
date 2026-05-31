import type { CamRuntimeContext, InertRecord, InertValue } from "@cam/protocol"

export type ScreenDocument = {
  readonly screen: string
  readonly title: string
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
  readonly value: InertValue
}

export type AddressElement = {
  readonly type: "address"
  readonly label: string
  readonly address: string
}

export type ButtonElement = {
  readonly type: "button"
  readonly label: string
  readonly action: ScreenAction
}

export type StatusElement = {
  readonly type: "status"
  readonly label: string
  readonly value: InertValue
}

export type NftElement = {
  readonly type: "nft"
  readonly contractAddress: string
  readonly tokenId: InertValue
}

export type ScreenAction = NavigateAction | ContractCallAction

export type NavigateAction = {
  readonly type: "navigate"
  readonly route: string
  readonly params: InertRecord
}

export type ContractCallAction = {
  readonly type: "contract-call"
  readonly contract: string
  readonly function: string
  readonly args: readonly InertValue[]
  readonly onSuccess?: NavigateAction
}

export type ScreenRuntimeContext = CamRuntimeContext & {
  readonly form: InertRecord
  readonly values: readonly InertValue[]
}

export type ScreenInitialContext = Omit<ScreenRuntimeContext, "form">

export type ResolvedScreen = {
  readonly title: string
  readonly elements: readonly ResolvedScreenElement[]
}

export type ResolvedScreenElement = ScreenElement

export type ResolvedScreenAction = ScreenAction
