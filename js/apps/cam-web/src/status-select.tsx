import type { ComponentProps, ReactElement } from "react"
import { Icon } from "./icon.tsx"

export type ConnectionCheckStatus = { readonly kind: "checking" | "success" | "failure"; readonly label: string }

const statusIcons = { checking: "spinner", success: "check", failure: "error" } as const

export function ConnectionCheckStatus({ status, className }: { readonly status: ConnectionCheckStatus | undefined; readonly className: string }): ReactElement {
  return <span className={className} role="status">{status === undefined ? null : <span role="img" data-check-state={status.kind} aria-label={status.label} title={status.label}><Icon name={statusIcons[status.kind]} /></span>}</span>
}

// Keep native selection behavior; the status overlays reserved space before its arrow.
export function StatusSelect({ status, ...props }: ComponentProps<"select"> & {
  readonly status: ConnectionCheckStatus | undefined
}): ReactElement {
  return <div className="status-select">
    <select {...props} />
    <ConnectionCheckStatus className="status-select-status" status={status} />
  </div>
}
