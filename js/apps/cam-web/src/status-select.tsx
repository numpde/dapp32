import type { ComponentProps, ReactElement } from "react"
import { Icon } from "./icon.tsx"

export function CheckedStatus({ label, className }: { readonly label: string | undefined; readonly className: string }): ReactElement {
  return <span className={className} role="status">{label === undefined ? null : <span role="img" aria-label={label} title={label}><Icon name="check" /></span>}</span>
}

// Keep native selection behavior; the status overlays reserved space before its arrow.
export function StatusSelect({ checkedLabel, ...props }: ComponentProps<"select"> & {
  readonly checkedLabel: string | undefined
}): ReactElement {
  return <div className="status-select">
    <select {...props} />
    <CheckedStatus className="status-select-status" label={checkedLabel} />
  </div>
}
