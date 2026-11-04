import { useEffect, useRef } from "react"
import type { PointerEvent, ReactElement, ReactNode } from "react"

export function DismissibleDialog({ open, label, onDismiss, children }: {
  readonly open: boolean
  readonly label: string
  readonly onDismiss: () => void
  readonly children: ReactNode
}): ReactElement {
  const dialog = useRef<HTMLDialogElement>(null)
  const outsidePointer = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!open) outsidePointer.current = undefined
    if (!open && dialog.current?.open) dialog.current.close()
    if (open && !dialog.current?.open) dialog.current?.showModal()
  }, [open])

  function outside(event: PointerEvent<HTMLDialogElement>): boolean {
    const bounds = event.currentTarget.getBoundingClientRect()
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom
  }

  // Older browsers need both pointer positions so a drag out of the dialog does not discard a draft.
  return <dialog className="dismissible-dialog" ref={dialog} aria-label={label} closedby="any"
    onCancel={event => { event.preventDefault(); onDismiss() }}
    onPointerDown={event => {
      if (!("closedBy" in HTMLDialogElement.prototype)) outsidePointer.current = event.button === 0 && outside(event) ? event.pointerId : undefined
    }}
    onPointerUp={event => {
      if (!("closedBy" in HTMLDialogElement.prototype) && outsidePointer.current === event.pointerId && outside(event)) onDismiss()
      outsidePointer.current = undefined
    }}
    onPointerCancel={() => { outsidePointer.current = undefined }}>
    {children}
  </dialog>
}
