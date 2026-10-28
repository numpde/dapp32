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
  | NftMetadataFieldNode
  | DocumentHashFieldNode
  | AmountFieldNode
  | NonNegativeIntegerFieldNode
  | DurationFieldNode
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

export type NftMetadataFieldNode = UiNodeBase & {
  readonly element: "NftMetadataField"
  readonly enabledWhen?: UiMembership
  readonly props: InertRecord
  readonly state: UiStateBinding
}

export type DocumentHashFieldNode = UiNodeBase & {
  readonly element: "DocumentHashField"
  readonly enabledWhen?: UiMembership
  readonly props: InertRecord
  readonly state: UiStateBinding
}

export type AddressNode = UiNodeBase & {
  readonly element: "Address"
  readonly props: InertRecord
}

export type AmountUnit = {
  readonly assetId: string
  readonly baseLabel: string
  readonly displayLabel: string
  readonly decimals: number
}

// One active lexical draft owns editing; both displayed strings and the
// canonical state value are projections. Rejected edits retain no oversized text.
export type NumericTextDraft = {
  readonly text: string
  readonly rejection: "tooLong" | "lineBreak" | null
  readonly composing: boolean
  readonly requiredError?: true
}

export type IntegerDraft = NumericTextDraft & { readonly kind: "integer" }
export type DurationPart = "days" | "hours" | "minutes" | "seconds"
export type DurationDraft = { readonly kind: "duration"; readonly requiredError?: true; readonly parts: Readonly<Record<DurationPart, NumericTextDraft>> }
export type DurationPresentation = {
  readonly parts: Readonly<Record<DurationPart, IntegerPresentation>>
  readonly status: IntegerPresentation["status"]
  readonly issue?: IntegerPresentation["issue"]
}
export type NumericDraft = AmountDraft | IntegerDraft | DurationDraft

export type AmountDraft = NumericTextDraft & {
  readonly kind: "amount"
  readonly unit: AmountUnit
  readonly representation: "base" | "display"
}

export type IntegerPresentation = {
  readonly text: string
  readonly status: "valid" | "empty" | "incomplete" | "invalid"
  readonly composing?: true
  readonly issue?: "syntax" | "belowMin" | "aboveMax" | "tooLong" | "lineBreak" | "required"
}

export type NonNegativeIntegerFieldNode = UiNodeBase & {
  readonly element: "NonNegativeIntegerField"
  readonly enabledWhen?: UiMembership
  readonly props: InertRecord
  readonly state: UiStateBinding
}

export type ResolvedNonNegativeIntegerFieldNode = {
  readonly element: "NonNegativeIntegerField"
  readonly disabled?: boolean
  readonly props: { readonly label: string; readonly min?: string; readonly max?: string }
  readonly state: ResolvedUiStateBinding
  readonly draft: IntegerPresentation
  readonly children: readonly []
}

export type DurationFieldNode = UiNodeBase & {
  readonly element: "DurationField"
  readonly enabledWhen?: UiMembership
  readonly props: InertRecord
  readonly state: UiStateBinding
}

export type ResolvedDurationFieldNode = {
  readonly element: "DurationField"
  readonly disabled?: boolean
  readonly props: { readonly label: string; readonly min?: string; readonly max?: string }
  readonly state: ResolvedUiStateBinding
  readonly draft: DurationPresentation
  readonly formattedValue?: string
  readonly children: readonly []
}

export type AmountPresentation = {
  readonly representation: "base" | "display"
  readonly baseText: string
  readonly displayText: string
  readonly status: "valid" | "empty" | "incomplete" | "invalid"
  readonly composing?: true
  readonly issue?: "syntax" | "precision" | "tooLong" | "lineBreak" | "required"
}

export type AmountFieldNode = UiNodeBase & {
  readonly element: "AmountField"
  readonly enabledWhen?: UiMembership
  readonly props: InertRecord
  readonly unit: AmountUnit
  readonly state: UiStateBinding
}

export type ResolvedAmountFieldNode = {
  readonly element: "AmountField"
  readonly disabled?: boolean
  readonly props: InertRecord
  readonly state: ResolvedUiStateBinding
  readonly unit: AmountUnit
  readonly draft: AmountPresentation
  readonly children: readonly []
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
  readonly numericDrafts?: Readonly<Record<string, NumericDraft>>
  readonly [key: string]: InertValue | undefined
}

export type ResolvedUiNode =
  | ResolvedElementNode
  | ResolvedButtonNode

export type ResolvedElementNode =
  | ResolvedContainerNode
  | ResolvedLeafElementNode
  | ResolvedTextFieldNode
  | ResolvedNftMetadataFieldNode
  | ResolvedDocumentHashFieldNode
  | ResolvedStatusNode
  | ResolvedAmountFieldNode
  | ResolvedNonNegativeIntegerFieldNode
  | ResolvedDurationFieldNode

export type ResolvedContainerNode = {
  readonly element: Extract<UiNode["element"], "Screen" | "Fragment">
  readonly props: InertRecord
  readonly children: readonly ResolvedUiNode[]
}

export type ResolvedLeafElementNode = {
  readonly element: Exclude<UiNode["element"], "Include" | "Button" | "Screen" | "Fragment" | "TextField" | "NftMetadataField" | "DocumentHashField" | "AmountField" | "NonNegativeIntegerField" | "DurationField" | "Status">
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

export type ResolvedNftMetadataFieldNode = {
  readonly element: "NftMetadataField"
  readonly disabled?: boolean
  readonly props: InertRecord
  readonly state: ResolvedUiStateBinding
  readonly children: readonly []
}

export type ResolvedDocumentHashFieldNode = {
  readonly element: "DocumentHashField"
  readonly disabled?: boolean
  readonly props: { readonly label: string; readonly algorithm: "sha256"; readonly sourceURI?: string }
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
  /** Non-authoritative provenance for generation tools; only direct state references, not Include parameter flow. */
  readonly directStateBindings?: Readonly<Record<string, string>>
}

export type ResolvedUiCall = {
  readonly namespace: string
  readonly function: string
  readonly args: InertRecord
}
