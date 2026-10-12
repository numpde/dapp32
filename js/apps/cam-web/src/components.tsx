import { useId, useLayoutEffect, useRef } from "react"
import type { ReactElement, Ref } from "react"

import type { InertValue } from "@cam/protocol"
import { MAX_AMOUNT_TEXT_LENGTH, MAX_AMOUNT_DIGITS } from "@cam/screen"
import type {
  ResolvedButtonNode,
  ResolvedAmountFieldNode,
  ResolvedUiNode,
} from "@cam/screen"
import type {
  CamViewerLoadedSnapshot,
  CamViewerPreparedContractCall,
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
        <dt>Host</dt>
        <dd>{shortenAddress(host)}</dd>
      </div>
      <div>
        <dt>Viewer account</dt>
        <dd>{shortenAddress(account)}</dd>
      </div>
      <div>
        <dt>Wallet</dt>
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
  onAction,
  onInput,
  onAmount,
}: {
  readonly snapshot: CamViewerLoadedSnapshot
  readonly viewRef: Ref<HTMLElement>
  readonly changingView: boolean
  readonly sending: boolean
  readonly onBack: () => Promise<void>
  readonly onAction: (action: ResolvedButtonNode) => Promise<void>
  readonly onInput: (name: string, value: string) => void
  readonly onAmount: AmountEdit
}): ReactElement {
  return (
    <section className="ui" ref={viewRef} tabIndex={-1} aria-label="Current view">
      <div className="ui-meta">
        <button type="button" disabled={changingView || sending || !snapshot.canGoBack} onClick={() => { void onBack() }}>
          Back
        </button>
        <span>{snapshot.route}</span>
        <span>{snapshot.uiURI}</span>
      </div>
      <fieldset className="elements" disabled={changingView || sending} aria-label="Current view">
        <UiNodeView node={snapshot.resolvedUi} state={snapshot.state} onAction={onAction} onInput={onInput} onAmount={onAmount} />
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
      <h2 id="prepared-call-title">Prepared contract call</h2>
      {preparedCallFields(call).map((field) => (
        <KeyValue key={field.label} label={field.label} value={field.value} mono={field.mono} />
      ))}
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
        Discard prepared call
      </button>
    </section>
  )
}

function UiNodeView({
  node,
  state,
  onAction,
  onInput,
  onAmount,
}: {
  readonly node: ResolvedUiNode
  readonly state: Record<string, InertValue>
  readonly onAction: (action: ResolvedButtonNode) => Promise<void>
  readonly onInput: (name: string, value: string) => void
  readonly onAmount: AmountEdit
}): ReactElement {
  switch (node.element) {
    case "Screen":
    case "Fragment":
      return (
        <>
          {node.children.map((child, index) => (
            <UiNodeView key={index} node={child} state={state} onAction={onAction} onInput={onInput} onAmount={onAmount} />
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
    case "Status":
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

type AmountEdit = (name: string, representation: "base" | "display", text: string, options?: { readonly composing?: boolean }) => void

function AmountFieldView({ node, onAmount }: { readonly node: ResolvedAmountFieldNode; readonly onAmount: AmountEdit }): ReactElement {
  const hintId = useId()
  const composing = useRef<HTMLInputElement | null>(null)
  const fieldset = useRef<HTMLFieldSetElement>(null)
  const rejectedInput = useRef<HTMLInputElement | null>(null)
  const rejectedComposition = useRef<HTMLInputElement | null>(null)
  useLayoutEffect(() => {
    // Model phase can end during account refresh. Restoring a pending draft
    // does not start native IME: only compositionstart raises this transport ref.
    if (node.draft.composing !== true) composing.current = null
    if (node.draft.issue !== "lineBreak" && node.draft.issue !== "tooLong") {
      rejectedInput.current = null
      rejectedComposition.current = null
    }
  }, [node.draft.composing, node.draft.issue])

  function rejectInsertion(input: HTMLInputElement, representation: "base" | "display", text: string, event: Event | { preventDefault(): void; readonly cancelable: boolean }): boolean {
    const start = input.selectionStart
    const end = input.selectionEnd
    const value = input.value
    // Selection exists on our text inputs. Without it, only the raw rejected
    // forms are intercepted; ordinary native edits still use the session codec.
    const candidate = start === null || end === null ? text : value.slice(0, start) + text + value.slice(end)
    if (!/[\r\n]/u.test(candidate) && candidate.length <= MAX_AMOUNT_TEXT_LENGTH) {
      rejectedInput.current = null
      rejectedComposition.current = null
      return false
    }
    event.preventDefault()
    if (!event.cancelable) rejectedInput.current = input
    if (composing.current === input) rejectedComposition.current = input
    onAmount(node.state.key, representation, candidate, { composing: composing.current === input })
    return true
  }

  useLayoutEffect(() => {
    const owner = fieldset.current
    if (owner === null) return
    const beforeInput = (event: Event) => {
      const input = event.target
      if (!(input instanceof HTMLInputElement)) return
      const representation = input.dataset.amountRepresentation
      if (representation !== "base" && representation !== "display") return
      const insertion = event as InputEvent
      if (insertion.isComposing && composing.current !== input) {
        event.preventDefault()
        input.value = representation === "base" ? node.draft.baseText : node.draft.displayText
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
      if (typeof text === "string") rejectInsertion(input, representation, text, event)
    }
    // React's synthetic onBeforeInput does not subscribe to native beforeinput.
    owner.addEventListener("beforeinput", beforeInput)
    return () => owner.removeEventListener("beforeinput", beforeInput)
  }, [onAmount, node.state.key, node.unit.assetId, node.unit.baseLabel, node.unit.displayLabel, node.unit.decimals, node.draft.baseText, node.draft.displayText])

  useLayoutEffect(() => () => {
    composing.current = null
    rejectedInput.current = null
    rejectedComposition.current = null
  }, [node.state.key, node.unit.assetId, node.unit.baseLabel, node.unit.displayLabel, node.unit.decimals])
  const issue = node.draft.issue
  const activeText = node.draft.representation === "base" ? node.draft.baseText : node.draft.displayText
  const explanation = issue === "syntax" ? "Enter an unsigned amount using digits and a decimal point for the display unit. Spaces, separators, signs and exponents are not accepted."
    : issue === "lineBreak" ? "Amounts must be on one line. The value was cleared; enter it again."
    : issue === "precision" ? `This amount cannot be represented exactly with ${node.unit.decimals} decimal places. Remove nonzero extra fractional digits.`
    : issue === "tooLong" ? activeText === "" ? `Input is too long (limit ${MAX_AMOUNT_TEXT_LENGTH}). The value was cleared; enter it again.` : `The amount exceeds the limit of ${MAX_AMOUNT_DIGITS} base-unit digits.`
    : node.draft.status === "incomplete" ? "Finish entering the amount before preparing an action."
    : undefined
  return <fieldset ref={fieldset} className="amount-field" disabled={node.disabled === true}>
    <legend>{displayText(stringProp(node.props, "label"))}</legend>
    <div className="amount-pair">
      {(["base", "display"] as const).map((representation) => <label className="field" key={representation}>
        <span>{displayText(representation === "base" ? node.unit.baseLabel : node.unit.displayLabel)}</span>
        <input name={representation === "base" ? node.state.key : `${node.state.key}.display`} data-amount-representation={representation}
          type="text" inputMode={representation === "base" ? "numeric" : "decimal"} autoComplete="off" spellCheck={false}
          value={representation === "base" ? node.draft.baseText : node.draft.displayText} aria-describedby={explanation === undefined ? undefined : hintId} aria-invalid={node.draft.status === "invalid"}
          onCompositionStart={(event) => { composing.current = event.currentTarget; onAmount(node.state.key, representation, event.currentTarget.value, { composing: true }) }}
          onCompositionEnd={(event) => {
            if (composing.current !== event.currentTarget) {
              event.currentTarget.value = representation === "base" ? node.draft.baseText : node.draft.displayText
              return
            }
            composing.current = null
            if (rejectedComposition.current === event.currentTarget) {
              rejectedComposition.current = null
              rejectedInput.current = null
              event.currentTarget.value = ""
              return
            }
            if (/[\r\n]/u.test(event.data)) {
              rejectInsertion(event.currentTarget, representation, event.data, event)
              return
            }
            onAmount(node.state.key, representation, event.currentTarget.value)
          }}
          onBlur={(event) => { if (composing.current === event.currentTarget) composing.current = null }}
          onPaste={(event) => { rejectInsertion(event.currentTarget, representation, event.clipboardData.getData("text/plain"), event) }}
          onDrop={(event) => { rejectInsertion(event.currentTarget, representation, event.dataTransfer.getData("text/plain"), event) }}
          onChange={(event) => {
            if ((event.nativeEvent as InputEvent).isComposing === true && composing.current !== event.currentTarget) {
              event.currentTarget.value = representation === "base" ? node.draft.baseText : node.draft.displayText
              return
            }
            if (rejectedInput.current === event.currentTarget || rejectedComposition.current === event.currentTarget) {
              rejectedInput.current = null
              if (composing.current !== event.currentTarget) rejectedComposition.current = null
              event.currentTarget.value = ""
              return
            }
            onAmount(node.state.key, representation, event.currentTarget.value, { composing: composing.current === event.currentTarget })
          }} />
      </label>)}
    </div>
    {explanation === undefined ? null : <p id={hintId} className="field-hint" role="status">{explanation}</p>}
  </fieldset>
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
