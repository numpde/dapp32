import type { ReactElement, ReactNode } from "react"
import { displayText } from "./display.ts"
import { HexValue } from "./hex-value.tsx"

export function PropertyRow({ label, value, className }: {
  readonly label: ReactNode
  readonly value: ReactNode
  readonly className?: string
}): ReactElement {
  return <dl className={className === undefined ? "key-value" : `key-value ${className}`}>
    <dt className="key-label">{typeof label === "string" ? displayText(label) : label}</dt>
    <dd>{typeof value === "string" ? <HexValue value={value} label={typeof label === "string" ? label : "value"} /> : value}</dd>
  </dl>
}

export function ControlRow({ label, controlId, children, className }: {
  readonly label: string
  readonly controlId: string
  readonly children: ReactNode
  readonly className: string
}): ReactElement {
  return <PropertyRow className={className} label={<label htmlFor={controlId}>{label}</label>} value={children} />
}
