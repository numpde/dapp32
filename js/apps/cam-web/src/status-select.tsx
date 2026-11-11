import type { ComponentProps, ReactElement, ReactNode } from "react"

// Keep native selection behavior; the status overlays reserved space before its arrow.
export function StatusSelect({ status, ...props }: ComponentProps<"select"> & {
  readonly status: ReactNode
}): ReactElement {
  return <div className="status-select">
    <select {...props} />
    <span className="status-select-status" role="status">{status}</span>
  </div>
}
