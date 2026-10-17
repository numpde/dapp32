import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import type { ReactElement, Ref } from "react"

import type { InertValue } from "@cam/protocol"
import { isDocumentHashDigest } from "@cam/protocol"
import { formatRelativeTimestamp, DURATION_PARTS, MAX_NUMERIC_TEXT_LENGTH, MAX_NUMERIC_DIGITS } from "@cam/screen"
import type {
  ResolvedButtonNode,
  ResolvedStatusNode,
  ResolvedAmountFieldNode,
  ResolvedNonNegativeIntegerFieldNode,
  ResolvedDurationFieldNode,
  DurationPart,
  ResolvedDocumentHashFieldNode,
  ResolvedUiNode,
} from "@cam/screen"
import type {
  CamViewerLoadedSnapshot,
  CamViewerPreparedContractCall,
  CamViewerDocumentHashStatus,
} from "@cam/viewer"

import {
  shortenAddress,
} from "./evm.ts"
import {
  displayText,
  formatInertValue,
} from "./display.ts"
import {
  preparedCallFields,
} from "./prepared-call.ts"

export function ConnectionSummary({
  chainId,
  host,
  account,
  wallet,
}: {
  readonly chainId: string
  readonly host: string
  readonly account: string
  readonly wallet: string
}): ReactElement {
  return (
    <dl className="connection">
      <div>
        <dt>Chain</dt>
        <dd>{chainId}</dd>
      </div>
      <div>
        <dt>App host</dt>
        <dd>{shortenAddress(host)}</dd>
      </div>
      <div>
        <dt>Selected account</dt>
        <dd>{shortenAddress(account)}</dd>
      </div>
      <div>
        <dt>Connected wallet</dt>
        <dd>{wallet}</dd>
      </div>
    </dl>
  )
}

export function UiView({
  snapshot,
  viewRef,
  changingView,
  sending,
  onBack,
  onRefresh,
  onAction,
  onInput,
  onAmount,
  onInteger,
  onDuration,
  onDocumentHash,
  onCancelDocumentHash,
}: {
  readonly snapshot: CamViewerLoadedSnapshot
  readonly viewRef: Ref<HTMLElement>
  readonly changingView: boolean
  readonly sending: boolean
  readonly onBack: () => Promise<void>
  readonly onRefresh: () => Promise<void>
  readonly onAction: (action: ResolvedButtonNode) => Promise<void>
  readonly onInput: (name: string, value: string) => void
  readonly onAmount: AmountEdit
  readonly onInteger: IntegerEdit
  readonly onDuration: DurationEdit
  readonly onDocumentHash: DocumentHashCalculate
  readonly onCancelDocumentHash: (name: string) => void
}): ReactElement {
  return (
    <section className="ui" ref={viewRef} tabIndex={-1} aria-label="Current view">
      <div className="ui-meta">
        <button type="button" disabled={changingView || sending || !snapshot.canGoBack} onClick={() => { void onBack() }}>
          Back
        </button>
        <button type="button" disabled={changingView || sending} onClick={() => { void onRefresh() }}>
          Refresh
        </button>
        <details>
          <summary>App details</summary>
          <KeyValue label="Read route" value={snapshot.route} mono={false} />
          <KeyValue label="UI resource" value={snapshot.uiURI} mono={false} />
        </details>
      </div>
      <fieldset className="elements" disabled={changingView || sending} aria-label="Current view">
        <UiNodeView node={snapshot.resolvedUi} state={snapshot.state} documentHashes={snapshot.documentHashes} onAction={onAction} onInput={onInput} onAmount={onAmount} onInteger={onInteger} onDuration={onDuration} onDocumentHash={onDocumentHash} onCancelDocumentHash={onCancelDocumentHash} />
      </fieldset>
    </section>
  )
}

export function PreparedCallView({
  call,
  reviewRef,
  canSend,
  canDiscard,
  sending,
  onSend,
  onDiscard,
}: {
  readonly call: CamViewerPreparedContractCall
  readonly reviewRef: Ref<HTMLElement>
  readonly canSend: boolean
  readonly canDiscard: boolean
  readonly sending: boolean
  readonly onSend: (call: CamViewerPreparedContractCall) => Promise<void>
  readonly onDiscard: () => void
}): ReactElement {
  return (
    <section className="panel prepared-call" ref={reviewRef} tabIndex={-1} aria-labelledby="prepared-call-title">
      <h2 id="prepared-call-title">Review transaction</h2>
      {preparedCallFields(call).map((field) => (
        <KeyValue key={field.label} label={field.label} value={field.value} mono={field.mono} />
      ))}
      <details>
        <summary>Technical details</summary>
        <KeyValue label="App action" value={call.route} mono={false} />
        <KeyValue label="After confirmation" value={`${call.then.namespace}.${call.then.function} ${formatInertValue(call.then.args)}`} mono={false} />
      </details>
      <button
        className="send-button"
        type="button"
        disabled={!canSend || sending}
        onClick={() => {
          void onSend(call)
        }}
      >
        {sending ? "Sending..." : "Send with wallet"}
      </button>
      <button type="button" disabled={!canDiscard} onClick={onDiscard}>
        Discard transaction
      </button>
    </section>
  )
}

function UiNodeView({
  node,
  state,
  documentHashes,
  onAction,
  onInput,
  onAmount,
  onInteger,
  onDuration,
  onDocumentHash,
  onCancelDocumentHash,
}: {
  readonly node: ResolvedUiNode
  readonly state: Record<string, InertValue>
  readonly documentHashes: Readonly<Record<string, CamViewerDocumentHashStatus>>
  readonly onAction: (action: ResolvedButtonNode) => Promise<void>
  readonly onInput: (name: string, value: string) => void
  readonly onAmount: AmountEdit
  readonly onInteger: IntegerEdit
  readonly onDuration: DurationEdit
  readonly onDocumentHash: DocumentHashCalculate
  readonly onCancelDocumentHash: (name: string) => void
}): ReactElement {
  switch (node.element) {
    case "Screen":
    case "Fragment":
      return (
        <>
          {node.children.map((child, index) => (
            <UiNodeView key={index} node={child} state={state} documentHashes={documentHashes} onAction={onAction} onInput={onInput} onAmount={onAmount} onInteger={onInteger} onDuration={onDuration} onDocumentHash={onDocumentHash} onCancelDocumentHash={onCancelDocumentHash} />
          ))}
        </>
      )
    case "Text":
      return <p className="text-row">{displayText(stringProp(node.props, "text"))}</p>
    case "TextField": {
      const name = stateKey(node)
      return (
        <label className="field">
          <span>{displayText(stringProp(node.props, "label"))}</span>
          <input
            // The CAM state key is the field identity. Expose the same name to
            // the DOM so tests, autofill, and agents do not need a parallel
            // mapping from rendered inputs back to protocol state.
            name={name}
            disabled={node.disabled === true}
            value={stateString(state, name)}
            onChange={(event) => onInput(name, event.currentTarget.value)}
          />
        </label>
      )
    }
    case "Address":
      return <KeyValue label={stringProp(node.props, "label")} value={stringProp(node.props, "address")} mono={true} />
    case "AmountField":
      return <AmountFieldView node={node} onAmount={onAmount} />
    case "DurationField":
      return <DurationFieldView node={node} onDuration={onDuration} />
    case "NonNegativeIntegerField":
      return <IntegerFieldView node={node} onInteger={onInteger} />
    case "DocumentHashField":
      return <DocumentHashFieldView node={node} value={stateString(state, node.state.key)} status={documentHashes[node.state.key]} onInput={onInput} onCalculate={onDocumentHash} onCancel={onCancelDocumentHash} />
    case "Status":
      if (node.props.format === "timestampSeconds") return <TimestampStatusView key={JSON.stringify([node.props.label, node.props.zeroText])} node={node} />
      return <KeyValue label={stringProp(node.props, "label")} value={node.formattedValue === undefined ? formatInertValue(node.props.value) : node.formattedValue} mono={false} />
    case "Nft":
      return (
        <div className="nft-row">
          <KeyValue label="NFT contract" value={stringProp(node.props, "contractAddress")} mono={true} />
          <KeyValue label="Token ID" value={formatInertValue(node.props.tokenId)} mono={false} />
        </div>
      )
    case "Button":
      return (
        <button
          className="action-button"
          type="button"
          disabled={node.disabled === true}
          onClick={() => {
            void onAction(node)
          }}
        >
          {displayText(stringProp(node.props, "label"))}
        </button>
      )
  }

  return unreachableUiNode(node)
}

function TimestampStatusView({ node }: { readonly node: ResolvedStatusNode }): ReactElement {
  const [relative, setRelative] = useState(false)
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))
  const clockHint = useId()
  const relativeText = formatRelativeTimestamp(node.props.value, nowSeconds, "Status.props", node.props.zeroText)
  const hasTimestamp = relativeText !== undefined
  useEffect(() => {
    if (!relative || !hasTimestamp) return
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(timer)
  }, [relative, hasTimestamp])
  const label = stringProp(node.props, "label")
  const dateText = node.formattedValue === undefined ? formatInertValue(node.props.value) : node.formattedValue
  if (!hasTimestamp) return <KeyValue label={label} value={dateText} mono={false} />
  return <div className="timestamp-status">
    <KeyValue label={label} value={relative ? relativeText : dateText} mono={false} />
    <div className="timestamp-options" role="group" aria-label={`${label} display`} aria-describedby={relative ? clockHint : undefined}>
      <button type="button" aria-pressed={!relative} onClick={() => setRelative(false)}>Date</button>
      <button type="button" aria-pressed={relative} onClick={() => { setNowSeconds(Math.floor(Date.now() / 1000)); setRelative(true) }}>Relative</button>
    </div>
    {relative ? <p id={clockHint} className="field-hint">Relative to your device clock.</p> : null}
  </div>
}

type AmountEdit = (name: string, representation: "base" | "display", text: string, options?: { readonly composing?: boolean }) => void
type DurationEdit = (name: string, part: DurationPart, text: string, options?: { readonly composing?: boolean }) => void
type IntegerEdit = (name: string, text: string, options?: { readonly composing?: boolean }) => void
type DocumentHashCalculate = (name: string, source: "url" | "file", file?: File) => Promise<void>

function DocumentHashFieldView({ node, value, status, onInput, onCalculate, onCancel }: {
  readonly node: ResolvedDocumentHashFieldNode
  readonly value: string
  readonly status: CamViewerDocumentHashStatus | undefined
  readonly onInput: (name: string, value: string) => void
  readonly onCalculate: DocumentHashCalculate
  readonly onCancel: (name: string) => void
}): ReactElement {
  const hintId = useId()
  const issueId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const pending = status?.status === "pending"
  const invalid = value !== "" && !isDocumentHashDigest(value)
  return <fieldset className="document-hash-field" disabled={node.disabled === true}>
    <legend>{displayText(node.props.label)}</legend>
    <label className="field">
      <span>SHA-256 digest</span>
      <input name={node.state.key} value={value} autoComplete="off" spellCheck={false} aria-invalid={invalid} aria-describedby={invalid ? `${hintId} ${issueId}` : hintId}
        onChange={event => onInput(node.state.key, event.currentTarget.value)} />
    </label>
    <p id={hintId} className="field-hint">Enter 0x followed by 64 hexadecimal characters, or calculate from exact document bytes. Files stay on this device; selecting one does not upload it or check the URI. Limit: 8 MiB and 15 seconds.</p>
    {invalid ? <p id={issueId} className="field-hint" role="status">The digest must be 0x followed by exactly 64 hexadecimal characters. Your entry is kept unchanged.</p> : null}
    <button type="button" onClick={() => fileInput.current?.click()}>Calculate from file</button>
    <input ref={fileInput} type="file" aria-label={`Choose file for ${displayText(node.props.label)}`} hidden onChange={event => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ""
      if (file !== undefined) void onCalculate(node.state.key, "file", file)
    }} />
    {node.props.sourceURI === undefined ? null : <button type="button" disabled={node.props.sourceURI === ""} onClick={() => { void onCalculate(node.state.key, "url") }}>Calculate from URL</button>}
    {pending ? <button type="button" onClick={() => onCancel(node.state.key)}>Cancel calculation</button> : null}
    {status === undefined ? null : <p className="field-hint" role={status.status === "failed" ? "alert" : "status"}>
      {pending ? "Calculating SHA-256… Your current digest is kept until calculation succeeds."
        : status.status === "failed" ? status.message
        : status.source === "file" ? "SHA-256 calculated from local file bytes. The URI has not been checked."
        : "SHA-256 calculated from the bytes returned by this URL after HTTP decoding."}
    </p>}
  </fieldset>
}

function NumericInput({ value, composing: modelComposing, issue, onEdit, ...inputProps }: {
  readonly value: string
  readonly composing?: true | undefined
  readonly issue?: string | undefined
  readonly onEdit: (text: string, options?: { readonly composing?: boolean }) => void
  readonly name: string
  readonly inputMode: "numeric" | "decimal"
  readonly disabled?: boolean
  readonly "aria-describedby"?: string | undefined
  readonly "aria-invalid": boolean
  readonly "data-amount-representation"?: "base" | "display"
}): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null)
  const composing = useRef<HTMLInputElement | null>(null)
  const rejectedInput = useRef<HTMLInputElement | null>(null)
  const rejectedComposition = useRef<HTMLInputElement | null>(null)
  useLayoutEffect(() => {
    // Restoring model phase never starts native IME; only compositionstart does.
    if (modelComposing !== true) composing.current = null
    if (issue !== "lineBreak" && issue !== "tooLong") {
      rejectedInput.current = null
      rejectedComposition.current = null
    }
  }, [modelComposing, issue])
  function rejectInsertion(input: HTMLInputElement, text: string, event: Event | { preventDefault(): void; readonly cancelable: boolean }): boolean {
    const start = input.selectionStart
    const end = input.selectionEnd
    const candidate = start === null || end === null ? text : input.value.slice(0, start) + text + input.value.slice(end)
    if (!/[\r\n]/u.test(candidate) && candidate.length <= MAX_NUMERIC_TEXT_LENGTH) {
      rejectedInput.current = null
      rejectedComposition.current = null
      return false
    }
    event.preventDefault()
    if (!event.cancelable) rejectedInput.current = input
    if (composing.current === input) rejectedComposition.current = input
    onEdit(candidate, { composing: composing.current === input })
    return true
  }
  useLayoutEffect(() => {
    const input = inputRef.current
    if (input === null) return
    const beforeInput = (event: Event) => {
      const insertion = event as InputEvent
      if (insertion.isComposing && composing.current !== input) {
        event.preventDefault()
        input.value = value
        return
      }
      if ((rejectedInput.current === input || rejectedComposition.current === input)
        && (insertion.inputType === "insertFromPaste" || insertion.inputType === "insertFromDrop")) {
        event.preventDefault()
        if (!event.cancelable) rejectedInput.current = input
        return
      }
      const text = insertion.dataTransfer === null || insertion.dataTransfer === undefined
        ? insertion.data : insertion.dataTransfer.getData("text/plain")
      if (typeof text === "string") rejectInsertion(input, text, event)
    }
    // React's synthetic onBeforeInput does not subscribe to native beforeinput.
    input.addEventListener("beforeinput", beforeInput)
    return () => input.removeEventListener("beforeinput", beforeInput)
  }, [onEdit, value])
  useLayoutEffect(() => () => {
    composing.current = null
    rejectedInput.current = null
    rejectedComposition.current = null
  }, [])
  return <input {...inputProps} ref={inputRef} type="text" autoComplete="off" spellCheck={false} value={value}
    onCompositionStart={(event) => { composing.current = event.currentTarget; onEdit(event.currentTarget.value, { composing: true }) }}
    onCompositionEnd={(event) => {
      if (composing.current !== event.currentTarget) { event.currentTarget.value = value; return }
      composing.current = null
      if (rejectedComposition.current === event.currentTarget) {
        rejectedComposition.current = null
        rejectedInput.current = null
        event.currentTarget.value = ""
        return
      }
      if (/[\r\n]/u.test(event.data)) { rejectInsertion(event.currentTarget, event.data, event); return }
      onEdit(event.currentTarget.value)
    }}
    onBlur={(event) => { if (composing.current === event.currentTarget) composing.current = null }}
    onPaste={(event) => { rejectInsertion(event.currentTarget, event.clipboardData.getData("text/plain"), event) }}
    onDrop={(event) => { rejectInsertion(event.currentTarget, event.dataTransfer.getData("text/plain"), event) }}
    onChange={(event) => {
      if ((event.nativeEvent as InputEvent).isComposing === true && composing.current !== event.currentTarget) { event.currentTarget.value = value; return }
      if (rejectedInput.current === event.currentTarget || rejectedComposition.current === event.currentTarget) {
        rejectedInput.current = null
        if (composing.current !== event.currentTarget) rejectedComposition.current = null
        event.currentTarget.value = ""
        return
      }
      onEdit(event.currentTarget.value, { composing: composing.current === event.currentTarget })
    }} />
}

function AmountFieldView({ node, onAmount }: { readonly node: ResolvedAmountFieldNode; readonly onAmount: AmountEdit }): ReactElement {
  const hintId = useId()
  const issue = node.draft.issue
  const activeText = node.draft.representation === "base" ? node.draft.baseText : node.draft.displayText
  const explanation = issue === "syntax" ? "Enter an unsigned amount using digits and a decimal point for the display unit. Spaces, separators, signs and exponents are not accepted."
    : issue === "lineBreak" ? "Amounts must be on one line. The value was cleared; enter it again."
    : issue === "precision" ? `This amount cannot be represented exactly with ${node.unit.decimals} decimal places. Remove nonzero extra fractional digits.`
    : issue === "tooLong" ? activeText === "" ? `Input is too long (limit ${MAX_NUMERIC_TEXT_LENGTH}). The value was cleared; enter it again.` : `The amount exceeds the limit of ${MAX_NUMERIC_DIGITS} base-unit digits.`
    : node.draft.status === "incomplete" ? "Finish entering the amount." : undefined
  return <fieldset className="amount-field" disabled={node.disabled === true}>
    <legend>{displayText(stringProp(node.props, "label"))}</legend>
    <div className="amount-pair">
      {(["base", "display"] as const).map((representation) => <label className="field" key={representation}>
        <span>{displayText(representation === "base" ? node.unit.baseLabel : node.unit.displayLabel)}</span>
        <NumericInput key={JSON.stringify([node.state.key, node.unit.assetId, node.unit.baseLabel, node.unit.displayLabel, node.unit.decimals])}
          name={representation === "base" ? node.state.key : `${node.state.key}.display`} data-amount-representation={representation}
          inputMode={representation === "base" ? "numeric" : "decimal"} value={representation === "base" ? node.draft.baseText : node.draft.displayText}
          composing={node.draft.composing} issue={issue} aria-describedby={explanation === undefined ? undefined : hintId} aria-invalid={node.draft.status === "invalid"}
          onEdit={(text, options) => onAmount(node.state.key, representation, text, options)} />
      </label>)}
    </div>
    {explanation === undefined ? null : <p id={hintId} className="field-hint" role="status">{explanation}</p>}
  </fieldset>
}

function DurationFieldView({ node, onDuration }: { readonly node: ResolvedDurationFieldNode; readonly onDuration: DurationEdit }): ReactElement {
  const hintId = useId()
  const issue = node.draft.issue
  const explanation = issue === "belowMin" ? `Enter a total of at least ${node.props.min} seconds.`
    : issue === "aboveMax" ? `Enter a total of at most ${node.props.max} seconds.`
    : issue === "tooLong" ? `The total duration must fit in ${MAX_NUMERIC_DIGITS} digits when expressed in seconds.`
    : node.draft.status === "invalid" ? "Use whole numbers with digits only. A part that is too long or contains a line break is cleared; enter it again."
    : node.draft.status === "incomplete" ? "Finish entering the duration."
    : "Whole numbers only. Blank parts count as 0 once you enter a value."
  return <fieldset className="duration-field" disabled={node.disabled === true} aria-describedby={hintId}>
    <legend>{displayText(node.props.label)}</legend>
    <div className="duration-parts">
      {DURATION_PARTS.map(part => <label className="field" key={part}>
        <span>{part[0].toUpperCase() + part.slice(1)}</span>
        <NumericInput key={`${node.state.key}.${part}`} name={`${node.state.key}.${part}`} inputMode="numeric"
          value={node.draft.parts[part].text} composing={node.draft.parts[part].composing} issue={node.draft.parts[part].issue}
          aria-describedby={hintId} aria-invalid={node.draft.status === "invalid"}
          onEdit={(text, options) => onDuration(node.state.key, part, text, options)} />
      </label>)}
    </div>
    <p id={hintId} className="field-hint" role="status">{explanation}</p>
    {node.formattedValue === undefined ? null : <p className="field-hint">Total: {displayText(node.formattedValue)}</p>}
  </fieldset>
}

function IntegerFieldView({ node, onInteger }: { readonly node: ResolvedNonNegativeIntegerFieldNode; readonly onInteger: IntegerEdit }): ReactElement {
  const hintId = useId()
  const issue = node.draft.issue
  const explanation = issue === "syntax" ? "Enter a nonnegative whole number using digits only."
    : issue === "lineBreak" ? "The value must be on one line. It was cleared; enter it again."
    : issue === "belowMin" ? `Enter ${node.props.min} or greater.`
    : issue === "aboveMax" ? `Enter ${node.props.max} or less.`
    : issue === "tooLong" ? node.draft.text === "" ? `Input is too long (limit ${MAX_NUMERIC_TEXT_LENGTH}). The value was cleared; enter it again.` : `The value exceeds the limit of ${MAX_NUMERIC_DIGITS} digits.`
    : node.draft.status === "incomplete" ? "Finish entering the number." : undefined
  return <div>
    <label className="field">
      <span>{displayText(stringProp(node.props, "label"))}</span>
      <NumericInput key={node.state.key} name={node.state.key} inputMode="numeric" disabled={node.disabled === true} value={node.draft.text}
        composing={node.draft.composing} issue={issue} aria-describedby={explanation === undefined ? undefined : hintId} aria-invalid={node.draft.status === "invalid"}
        onEdit={(text, options) => onInteger(node.state.key, text, options)} />
    </label>
    {explanation === undefined ? null : <p id={hintId} className="field-hint" role="status">{explanation}</p>}
  </div>
}

function unreachableUiNode(_node: never): never {
  throw new Error("unsupported resolved UI node element")
}

function stateKey(node: ResolvedUiNode): string {
  if (node.element !== "TextField" || node.state === undefined) {
    throw new Error("resolved TextField node has no state key")
  }

  return node.state.key
}

function stateString(state: Record<string, InertValue>, name: string): string {
  const value = state[name]
  if (typeof value !== "string") {
    throw new Error(`viewer state field must be a string: ${name}`)
  }

  return value
}

function stringProp(props: Record<string, InertValue>, name: string): string {
  const value = props[name]
  if (typeof value !== "string") {
    throw new Error(`resolved UI prop must be a string: ${name}`)
  }

  return value
}

function KeyValue({
  label,
  value,
  mono,
}: {
  readonly label: string
  readonly value: string
  readonly mono: boolean
}): ReactElement {
  return (
    <div className="key-value">
      <span className="key-label">{displayText(label)}</span>
      <span className={mono ? "mono" : undefined}>{displayText(value)}</span>
    </div>
  )
}
