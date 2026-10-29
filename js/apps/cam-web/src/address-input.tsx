import { createContext, useContext, useRef, useState } from "react"
import type { ReactElement, ReactNode } from "react"
import { addressSuggestions, enteredAddresses } from "./known-addresses.ts"
import type { KnownAddress } from "./known-addresses.ts"
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
  return <div className="address-input">
    <label className="field">
      <span>{displayText(label)}</span>
      <input name={name} value={value} disabled={disabled} autoCapitalize="none" spellCheck={false}
        onChange={event => { edited.current = event.currentTarget.value; onInput(name, event.currentTarget.value) }}
        onBlur={() => {
          if (edited.current === value && !disabled) remember({ address: value, label: `Entered in: ${label}` })
          edited.current = undefined
        }} />
    </label>
    <select aria-label={`Use a known address for ${label}`} value="" disabled={disabled || suggestions.length === 0}
      onChange={event => { if (event.currentTarget.value !== "") onInput(name, event.currentTarget.value) }}>
      <option value="">Use a known address…</option>
      {suggestions.map(entry => <option key={entry.address.toLowerCase()} value={entry.address}>{displayText(entry.label)} · {entry.address}</option>)}
    </select>
  </div>
}
