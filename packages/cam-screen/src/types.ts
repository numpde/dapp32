import type { CamRuntimeContext } from "@cam/core"

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
  // TODO(inert-values): screen field payloads should be InertValue so parsed
  // screens cannot carry host objects into renderers or action resolution.
  readonly value?: unknown
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
  // TODO(inert-values): status values are display data and should use
  // InertValue instead of accepting arbitrary unknown values.
  readonly value: unknown
}

export type NftElement = {
  readonly type: "nft"
  readonly contractAddress: string
  // TODO(inert-values): token identifiers may be strings or numbers in screen
  // documents, but still need the inert-value boundary.
  readonly tokenId: unknown
}

export type ScreenAction = NavigateAction | ContractCallAction

export type NavigateAction = {
  readonly route: string
  // TODO(inert-values): navigation params are route input data and should be
  // Record<string, InertValue>.
  readonly params: Record<string, unknown>
}

export type ContractCallAction = {
  readonly contract: string
  readonly function: string
  // TODO(inert-values): action args are declarative data until an EVM adapter
  // encodes them, so they should be readonly InertValue[].
  readonly args: readonly unknown[]
  readonly onSuccess?: NavigateAction
}

export type ScreenRuntimeContext = CamRuntimeContext & {
  // TODO(inert-values): screen-local state is untrusted renderer input and
  // should be Record<string, InertValue>.
  readonly state: Record<string, unknown>
  // TODO(inert-values): route return values are adapter-produced data that the
  // screen resolver consumes; normalize them to readonly InertValue[].
  readonly values: readonly unknown[]
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

export type ResolvedScreenAction = NavigateAction | ContractCallAction
