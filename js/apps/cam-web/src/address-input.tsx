import { createContext, useContext, useId, useRef, useState } from "react"
import type { ReactElement, ReactNode } from "react"
import { Autocomplete } from "@base-ui/react/autocomplete"
import { addressSuggestions, enteredAddresses } from "./known-addresses.ts"
import type { KnownAddress } from "./known-addresses.ts"
import { isAbiAddressValue } from "@cam/protocol"
import { HexText } from "./hex-value.tsx"
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
    <Autocomplete.Root items={suggestions} mode="none" disabled={disabled} value={value}
      itemToStringValue={entry => entry.address}
      onValueChange={next => { if (next !== value) onInput(name, next) }}>
      <label htmlFor={inputId}>{displayText(label)}</label>
      <Autocomplete.InputGroup className="address-control">
        <div className="address-entry" data-compact={compact}>
          <Autocomplete.Input id={inputId} name={name} autoCapitalize="none" spellCheck={false}
            onFocus={() => setEditing(true)}
            onChange={event => { edited.current = event.currentTarget.value }}
            onBlur={() => {
              setEditing(false)
              if (edited.current === value && !disabled) remember({ address: value, label: `Entered in: ${label}` })
              edited.current = undefined
            }} />
          {compact ? <span className="address-display" aria-hidden="true"><HexText value={value} /></span> : null}
        </div>
        <Autocomplete.Trigger className="address-trigger" aria-label={`Use a known address for ${label}`} disabled={disabled || suggestions.length === 0}><span aria-hidden="true">⌄</span></Autocomplete.Trigger>
      </Autocomplete.InputGroup>
      <Autocomplete.Portal>
        <Autocomplete.Positioner className="address-positioner" side="bottom" align="start" sideOffset={4} collisionPadding={12}>
          <Autocomplete.Popup className="address-popover">
            <Autocomplete.List className="address-options">
              {(entry: KnownAddress) => <Autocomplete.Item key={entry.address} value={entry} className="address-option" aria-label={`${entry.label} · ${entry.address}`}>
                <span className="address-option-label">{displayText(entry.label)}</span>
                <HexText value={entry.address} />
              </Autocomplete.Item>}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  </div>
}
