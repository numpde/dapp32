import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import type { ReactElement, ReactNode, Ref } from "react"

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
  CamViewerActionKind,
  CamViewerLoadedSnapshot,
  CamViewerPreparedContractCall,
  CamViewerDocumentHashStatus,
} from "@cam/viewer"

import {
  displayText,
  formatInertValue,
} from "./display.ts"
import {
  preparedCallFields,
} from "./prepared-call.ts"
import { NftView, NftMetadataFieldView } from "./nft-components.tsx"
import { Feedback, FeedbackBox } from "./feedback.tsx"
import type { TransactionStage } from "./transactions.ts"
import { HexValue } from "./hex-value.tsx"
import { PropertyRow } from "./property-row.tsx"

export function ConnectionSummary({
  chainId,
  host,
  account,
  wallet,
  walletAction,
  children,
}: {
  readonly chainId: string
  readonly host: string
  readonly account: string | undefined
  readonly wallet: string | undefined
  readonly walletAction: ReactElement
  readonly children?: ReactNode
}): ReactElement {
  return (
    <section className="connection" aria-label="Account and wallet">
      <div className="connection-facts">
        <PropertyRow label="Viewing as" value={account === undefined ? "Public view" : account} />
        <PropertyRow label="Signing wallet" value={<span className="wallet-value">{wallet === undefined ? null : <span role="status"><HexValue value={wallet} label="wallet address" /></span>}{walletAction}</span>} />
        <PropertyRow label="Chain" value={chainId} />
        <PropertyRow label="CAM contract" value={host} />
        {children}
      </div>
    </section>
  )
}

export function UiView({
  snapshot,
  actionKind,
  canReviewTransaction,
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
  readonly actionKind: (action: ResolvedButtonNode) => CamViewerActionKind
  readonly canReviewTransaction: boolean
  readonly viewRef: Ref<HTMLElement>
  readonly changingView: boolean
  readonly sending: boolean
  readonly onBack: () => Promise<void>
  readonly onRefresh: () => Promise<void>
  readonly onAction: (action: ResolvedButtonNode) => Promise<void>
  readonly onInput: (name: string, value: string | null) => void
  readonly onAmount: AmountEdit
  readonly onInteger: IntegerEdit
  readonly onDuration: DurationEdit
  readonly onDocumentHash: DocumentHashCalculate
  readonly onCancelDocumentHash: (name: string) => void
}): ReactElement {
  return (
    <section className="ui" ref={viewRef} tabIndex={-1} aria-label="Current view">
      <div className="ui-meta">
        <button className="button-quiet" type="button" disabled={changingView || sending || !snapshot.canGoBack} onClick={() => { void onBack() }}>
          Back
        </button>
        <button className="button-quiet" type="button" disabled={changingView || sending} onClick={() => { void onRefresh() }}>
          Refresh
        </button>
        <details>
          <summary>App details</summary>
          <KeyValue label="Read route" value={snapshot.route} mono={false} />
          <KeyValue label="UI resource" value={snapshot.uiURI} mono={false} />
        </details>
      </div>
      <div className="elements" role="group" aria-label="Current view">
        <UiNodeView busy={changingView || sending} root={true} headingLevel={2} scopeKey={JSON.stringify([snapshot.route, snapshot.inputs, snapshot.account?.address, snapshot.uiURI])} node={snapshot.resolvedUi} actionKind={actionKind} canReviewTransaction={canReviewTransaction} state={snapshot.state} documentHashes={snapshot.documentHashes} onAction={onAction} onInput={onInput} onAmount={onAmount} onInteger={onInteger} onDuration={onDuration} onDocumentHash={onDocumentHash} onCancelDocumentHash={onCancelDocumentHash} />
      </div>
    </section>
  )
}

export function PreparedCallView({
  call,
  reviewRef,
  canSend,
  canDiscard,
  stage,
  onSend,
  onDiscard,
}: {
  readonly call: CamViewerPreparedContractCall
  readonly reviewRef: Ref<HTMLElement>
  readonly canSend: boolean
  readonly canDiscard: boolean
  readonly stage: TransactionStage | undefined
  readonly onSend: (call: CamViewerPreparedContractCall) => Promise<void>
  readonly onDiscard: () => void
}): ReactElement {
  const sending = stage !== undefined
  const status = stage === undefined ? "Send with wallet" : {
    checking: "Checking transaction…", wallet: "Waiting for wallet…",
    confirming: "Waiting for confirmation…", refreshing: "Loading updated view…",
  }[stage]
  return (
    <section className="panel prepared-call" ref={reviewRef} tabIndex={-1} aria-labelledby="prepared-call-title">
      <h2 id="prepared-call-title">Review transaction</h2>
      {preparedCallFields(call).map((field) => (
        field.json === undefined ? <KeyValue key={field.label} label={field.label} value={field.value} mono={field.mono} compact={field.compact} />
          : <PropertyRow key={field.label} label={field.label} value={<>
            {field.json.status === "ready" ? <pre className="review-json"><code>{field.json.text}</code></pre> : <FeedbackBox kind="warning" message={field.json.failure.message}>
              {field.json.failure.diagnostic === undefined ? null : <code className="feedback-diagnostic">{field.json.failure.diagnostic}</code>}
            </FeedbackBox>}
            <details><summary>Exact URI</summary><textarea readOnly aria-label={`Exact URI for ${field.label}`} value={field.value} /></details>
          </>} />
      ))}
      {stage === "wallet" ? <FeedbackBox kind="status" message="Approve or reject the request in your wallet. If no prompt appeared, open your wallet." /> : null}
      <button
        className="send-button"
        type="button"
        disabled={!canSend || sending}
        onClick={() => {
          void onSend(call)
        }}
      >
        {status}
      </button>
      <button className="button-quiet" type="button" disabled={!canDiscard || sending} onClick={onDiscard}>
        Discard transaction
      </button>
    </section>
  )
}

function UiNodeView({
  node,
  busy,
  root,
  headingLevel,
  actionKind,
  canReviewTransaction,
  scopeKey,
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
  readonly busy: boolean
  readonly root: boolean
  readonly headingLevel: number
  readonly actionKind: (action: ResolvedButtonNode) => CamViewerActionKind
  readonly canReviewTransaction: boolean
  readonly scopeKey: string
  readonly state: Record<string, InertValue>
  readonly documentHashes: Readonly<Record<string, CamViewerDocumentHashStatus>>
  readonly onAction: (action: ResolvedButtonNode) => Promise<void>
  readonly onInput: (name: string, value: string | null) => void
  readonly onAmount: AmountEdit
  readonly onInteger: IntegerEdit
  readonly onDuration: DurationEdit
  readonly onDocumentHash: DocumentHashCalculate
  readonly onCancelDocumentHash: (name: string) => void
}): ReactElement {
  switch (node.element) {
    case "Screen":
    case "Fragment": {
      const titled = node.element === "Screen" && !root
      const children = node.children.map((child, index) => (
        <UiNodeView key={index} busy={busy} root={false} headingLevel={titled ? Math.min(headingLevel + 1, 6) : headingLevel} scopeKey={scopeKey} node={child} actionKind={actionKind} canReviewTransaction={canReviewTransaction} state={state} documentHashes={documentHashes} onAction={onAction} onInput={onInput} onAmount={onAmount} onInteger={onInteger} onDuration={onDuration} onDocumentHash={onDocumentHash} onCancelDocumentHash={onCancelDocumentHash} />
      ))
      if (!titled) return <>{children}</>
      const title = displayText(stringProp(node.props, "title"))
      const Heading = `h${headingLevel}` as "h2" | "h3" | "h4" | "h5" | "h6"
      return <section className="ui-section" aria-label={title}><Heading>{title}</Heading>{children}</section>
    }
    case "Text":
      return <p className="text-row"><HexValue value={stringProp(node.props, "text")} label="value" /></p>
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
            disabled={busy || node.disabled === true}
            value={stateString(state, name)}
            onChange={(event) => onInput(name, event.currentTarget.value)}
          />
        </label>
      )
    }
    case "Address":
      return <KeyValue label={stringProp(node.props, "label")} value={stringProp(node.props, "address")} mono={true} />
    case "AmountField":
      return <AmountFieldView node={node} disabled={busy || node.disabled === true} onAmount={onAmount} />
    case "DurationField":
      return <DurationFieldView node={node} disabled={busy || node.disabled === true} onDuration={onDuration} />
    case "NonNegativeIntegerField":
      return <IntegerFieldView node={node} disabled={busy || node.disabled === true} onInteger={onInteger} />
    case "DocumentHashField":
      return <DocumentHashFieldView node={node} disabled={busy || node.disabled === true} value={stateString(state, node.state.key)} status={documentHashes[node.state.key]} onInput={onInput} onCalculate={onDocumentHash} onCancel={onCancelDocumentHash} />
    case "NftMetadataField":
      return <NftMetadataFieldView key={JSON.stringify([scopeKey, node.state.key])} label={stringProp(node.props, "label")} name={node.state.key} value={state[node.state.key] === null ? null : stateString(state, node.state.key)} disabled={busy || node.disabled === true} onInput={onInput} />
    case "Status":
      if (node.props.format === "timestampSeconds") return <TimestampStatusView key={JSON.stringify([node.props.label, node.props.zeroText])} node={node} />
      return <KeyValue label={stringProp(node.props, "label")} value={node.formattedValue === undefined ? formatInertValue(node.props.value) : node.formattedValue} mono={false} />
    case "Nft":
      return <NftView key={JSON.stringify([scopeKey, node.props])} contractAddress={stringProp(node.props, "contractAddress")} tokenId={formatInertValue(node.props.tokenId)} metadataURI={node.props.metadataURI === undefined ? undefined : stringProp(node.props, "metadataURI")} />
    case "Button": {
      const label = displayText(stringProp(node.props, "label"))
      const kind = actionKind(node)
      const effect = kind === "navigate" ? "Read only" : kind === "contractCall" ? "Review transaction" : "Unknown route"
      return (
        <button
          className={`action-button${kind === "navigate" ? " button-quiet" : ""}`}
          data-action-kind={kind}
          aria-label={label}
          aria-description={kind === "contractCall" && !canReviewTransaction ? "Connect a wallet to review this transaction" : effect}
          type="button"
          disabled={busy || node.disabled === true || (kind === "contractCall" && !canReviewTransaction)}
          onClick={() => {
            void onAction(node)
          }}
        >
          {label}
          {kind === "navigate"
            ? <span className="action-arrow" aria-hidden="true"> →</span>
            : <span className="action-effect" aria-hidden="true">{effect}</span>}
        </button>
      )
    }
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
  return <PropertyRow className="timestamp-status" label={<span className="timestamp-label">
      <span>{displayText(label)}</span>
      <button className="timestamp-options" type="button" aria-label={`Relative time for ${label}`} aria-pressed={relative} aria-describedby={clockHint} title="Date / Relative time"
        onClick={() => { setNowSeconds(Math.floor(Date.now() / 1000)); setRelative(value => !value) }}>
        <span className="timestamp-segment" data-mode="date" data-selected={!relative} aria-hidden="true" title="Date">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
            <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" />
          </svg>
        </span>
        <span className="timestamp-segment" data-mode="relative" data-selected={relative} aria-hidden="true" title="Relative">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" focusable="false">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
        </span>
        <span id={clockHint} className="visually-hidden">Relative to your device clock.</span>
      </button>
    </span>} value={<span className="timestamp-value" aria-describedby={relative ? clockHint : undefined}>{displayText(relative ? relativeText : dateText)}</span>} />
}

type AmountEdit = (name: string, representation: "base" | "display", text: string, options?: { readonly composing?: boolean }) => void
type DurationEdit = (name: string, part: DurationPart, text: string, options?: { readonly composing?: boolean }) => void
type IntegerEdit = (name: string, text: string, options?: { readonly composing?: boolean }) => void
type DocumentHashCalculate = (name: string, source: "url" | "file", file?: File) => Promise<void>

function DocumentHashFieldView({ node, disabled, value, status, onInput, onCalculate, onCancel }: {
  readonly node: ResolvedDocumentHashFieldNode
  readonly disabled: boolean
  readonly value: string
  readonly status: CamViewerDocumentHashStatus | undefined
  readonly onInput: (name: string, value: string | null) => void
  readonly onCalculate: DocumentHashCalculate
  readonly onCancel: (name: string) => void
}): ReactElement {
  const hintId = useId()
  const issueId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const fileAction = useRef<HTMLButtonElement>(null)
  const urlAction = useRef<HTMLButtonElement>(null)
  const pending = status?.status === "pending"
  const invalid = value !== "" && !isDocumentHashDigest(value)
  const statusMessages = [
    { kind: "pending", visible: pending, text: "Calculating SHA-256… Your current digest is kept until calculation succeeds." },
    { kind: "file", visible: status?.status === "succeeded" && status.source === "file", text: "SHA-256 calculated from local file bytes. The URI has not been checked." },
    { kind: "url", visible: status?.status === "succeeded" && status.source === "url", text: "SHA-256 calculated from the bytes returned by this URL after HTTP decoding." },
  ]
  return <fieldset className="document-hash-field">
    <legend>{displayText(node.props.label)}</legend>
    <label className="field">
      <span>SHA-256 digest</span>
      <input disabled={disabled} name={node.state.key} value={value} autoComplete="off" spellCheck={false} aria-invalid={invalid} aria-describedby={invalid ? `${hintId} ${issueId}` : hintId}
        onChange={event => onInput(node.state.key, event.currentTarget.value)} />
    </label>
    <p id={hintId} className="field-hint">Enter 0x followed by 64 hexadecimal characters, or calculate from exact document bytes. Files stay on this device; selecting one does not upload it or check the URI. Limit: 8 MiB and 15 seconds.</p>
    {invalid ? <p id={issueId} className="visually-hidden" role="status">The digest must be 0x followed by exactly 64 hexadecimal characters. Your entry is kept unchanged.</p> : null}
    <button ref={fileAction} disabled={disabled} className="resource-load" aria-busy={pending && status.source === "file"} type="button" onClick={() => fileInput.current?.click()}>Calculate from file</button>
    <input ref={fileInput} disabled={disabled} type="file" aria-label={`Choose file for ${displayText(node.props.label)}`} hidden onChange={event => {
      const file = event.currentTarget.files?.[0]
      event.currentTarget.value = ""
      if (file !== undefined) void onCalculate(node.state.key, "file", file)
    }} />
    {node.props.sourceURI === undefined ? null : <button ref={urlAction} className="resource-load" aria-busy={pending && status.source === "url"} type="button" disabled={disabled || node.props.sourceURI === ""} onClick={() => { void onCalculate(node.state.key, "url") }}>Calculate from URL</button>}
    <button className="button-quiet resource-cancel" type="button" aria-hidden={!pending} disabled={disabled || !pending} onClick={event => {
      const restoreFocus = document.activeElement === event.currentTarget
      const action = status?.source === "file" ? fileAction.current : urlAction.current
      onCancel(node.state.key)
      if (restoreFocus) requestAnimationFrame(() => action?.focus())
    }}>Cancel calculation</button>
    <p className="resource-status" role="status">
      {statusMessages.map(message => <span key={message.kind} className={message.visible ? undefined : "status-placeholder"} aria-hidden={!message.visible}>{message.text}</span>)}
    </p>
    {status?.status === "failed" ? <Feedback report={status} kind="error" /> : null}
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

function AmountFieldView({ node, disabled, onAmount }: { readonly node: ResolvedAmountFieldNode; readonly disabled: boolean; readonly onAmount: AmountEdit }): ReactElement {
  const hintId = useId()
  const issue = node.draft.issue
  const activeText = node.draft.representation === "base" ? node.draft.baseText : node.draft.displayText
  const explanation = issue === "syntax" ? "Enter an unsigned amount using digits and a decimal point for the display unit. Spaces, separators, signs and exponents are not accepted."
    : issue === "lineBreak" ? "Amounts must be on one line. The value was cleared; enter it again."
    : issue === "precision" ? `This amount cannot be represented exactly with ${node.unit.decimals} decimal places. Remove nonzero extra fractional digits.`
    : issue === "tooLong" ? activeText === "" ? `Input is too long (limit ${MAX_NUMERIC_TEXT_LENGTH}). The value was cleared; enter it again.` : `The amount exceeds the limit of ${MAX_NUMERIC_DIGITS} base-unit digits.`
    : node.draft.status === "incomplete" ? "Finish entering the amount." : undefined
  return <fieldset className="amount-field">
    <legend>{displayText(stringProp(node.props, "label"))}</legend>
    <div className="amount-pair">
      {(["base", "display"] as const).map((representation) => <label className="field" key={representation}>
        <span>{displayText(representation === "base" ? node.unit.baseLabel : node.unit.displayLabel)}</span>
        <NumericInput key={JSON.stringify([node.state.key, node.unit.assetId, node.unit.baseLabel, node.unit.displayLabel, node.unit.decimals])}
          disabled={disabled} name={representation === "base" ? node.state.key : `${node.state.key}.display`} data-amount-representation={representation}
          inputMode={representation === "base" ? "numeric" : "decimal"} value={representation === "base" ? node.draft.baseText : node.draft.displayText}
          composing={node.draft.composing} issue={issue} aria-describedby={explanation === undefined ? undefined : hintId} aria-invalid={node.draft.status === "invalid"}
          onEdit={(text, options) => onAmount(node.state.key, representation, text, options)} />
      </label>)}
    </div>
    {explanation === undefined ? null : <p id={hintId} className="visually-hidden" role="status">{explanation}</p>}
  </fieldset>
}

function DurationFieldView({ node, disabled, onDuration }: { readonly node: ResolvedDurationFieldNode; readonly disabled: boolean; readonly onDuration: DurationEdit }): ReactElement {
  const hintId = useId()
  const issue = node.draft.issue
  const explanation = issue === "belowMin" ? `Enter a total of at least ${node.props.min} seconds.`
    : issue === "aboveMax" ? `Enter a total of at most ${node.props.max} seconds.`
    : issue === "tooLong" ? `The total duration must fit in ${MAX_NUMERIC_DIGITS} digits when expressed in seconds.`
    : node.draft.status === "invalid" ? "Use whole numbers with digits only. A part that is too long or contains a line break is cleared; enter it again."
    : node.draft.status === "incomplete" ? "Finish entering the duration."
    : "Whole numbers only. Blank parts count as 0 once you enter a value."
  return <fieldset className="duration-field" aria-describedby={hintId}>
    <legend>{displayText(node.props.label)}</legend>
    <div className="duration-parts">
      {DURATION_PARTS.map(part => <label className="field" key={part}>
        <span>{part[0].toUpperCase() + part.slice(1)}</span>
        <NumericInput key={`${node.state.key}.${part}`} disabled={disabled} name={`${node.state.key}.${part}`} inputMode="numeric"
          value={node.draft.parts[part].text} composing={node.draft.parts[part].composing} issue={node.draft.parts[part].issue}
          aria-describedby={hintId} aria-invalid={node.draft.status === "invalid"}
          onEdit={(text, options) => onDuration(node.state.key, part, text, options)} />
      </label>)}
    </div>
    <p id={hintId} className="visually-hidden" role="status">{explanation}</p>
  </fieldset>
}

function IntegerFieldView({ node, disabled, onInteger }: { readonly node: ResolvedNonNegativeIntegerFieldNode; readonly disabled: boolean; readonly onInteger: IntegerEdit }): ReactElement {
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
      <NumericInput key={node.state.key} name={node.state.key} inputMode="numeric" disabled={disabled} value={node.draft.text}
        composing={node.draft.composing} issue={issue} aria-describedby={explanation === undefined ? undefined : hintId} aria-invalid={node.draft.status === "invalid"}
        onEdit={(text, options) => onInteger(node.state.key, text, options)} />
    </label>
    {explanation === undefined ? null : <p id={hintId} className="visually-hidden" role="status">{explanation}</p>}
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
  compact,
}: {
  readonly label: string
  readonly value: string
  readonly mono: boolean
  readonly compact?: boolean | undefined
}): ReactElement {
  return <PropertyRow label={label} className={mono ? "mono-value" : "text-value"} value={compact === false ? <span>{displayText(value)}</span> : value} />
}
