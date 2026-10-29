import { createContext, useContext, useId, useRef, useState } from "react"
import type { ReactElement, ReactNode } from "react"
import { addressSuggestions, enteredAddresses } from "./known-addresses.ts"
import type { KnownAddress } from "./known-addresses.ts"
import { isAbiAddressValue } from "@cam/protocol"
import { HexText, abbreviatedHex } from "./hex-value.tsx"
import { displayText } from "./display.ts"

const KnownAddresses = createContext<{
  readonly suggestions: readonly KnownAddress[]
  readonly remember: (entry: KnownAddress) => void
}>({ suggestions: [], remember: () => {} })

export function AddressSuggestions({ sources, children }: {
  readonly sources: readonly KnownAddress[]
  readonly children: ReactNode
}): ReactElement {
  const [entered, setEntered] = useState<readonly KnownAddress[]>([])
  return <KnownAddresses.Provider value={{
    suggestions: addressSuggestions([...sources, ...entered]),
    remember: entry => setEntered(previous => enteredAddresses(previous, entry)),
  }}>{children}</KnownAddresses.Provider>
}

export function AddressInput({ name, label, value, disabled, onInput }: {
  readonly name: string
  readonly label: string
  readonly value: string
  readonly disabled: boolean
  readonly onInput: (name: string, value: string) => void
}): ReactElement {
  const { suggestions, remember } = useContext(KnownAddresses)
  const edited = useRef<string | undefined>(undefined)
  const [editing, setEditing] = useState(false)
  const inputId = useId()
  const compact = !editing && isAbiAddressValue(value)
  return <div className="address-input">
    <label htmlFor={inputId}>{displayText(label)}</label>
    <div className="address-control">
      <div className="address-entry" data-compact={compact}>
        <input id={inputId} name={name} value={value} disabled={disabled} autoCapitalize="none" spellCheck={false}
          onFocus={() => setEditing(true)}
          onChange={event => { edited.current = event.currentTarget.value; onInput(name, event.currentTarget.value) }}
          onBlur={() => {
            setEditing(false)
            if (edited.current === value && !disabled) remember({ address: value, label: `Entered in: ${label}` })
            edited.current = undefined
          }} />
        {compact ? <span className="address-display" aria-hidden="true"><HexText value={value} /></span> : null}
      </div>
      <select aria-label={`Use a known address for ${label}`} title="Use a known address" value="" disabled={disabled || suggestions.length === 0}
        onChange={event => { if (event.currentTarget.value !== "") onInput(name, event.currentTarget.value) }}>
        <option value="" aria-label="Choose an address"></option>
        {suggestions.map(entry => <option key={entry.address.toLowerCase()} value={entry.address} title={entry.address} aria-label={`${entry.label} · ${entry.address}`}>{displayText(entry.label)} · {abbreviatedHex(entry.address)}</option>)}
      </select>
    </div>
  </div>
}
