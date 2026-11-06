import type { ReactElement } from "react"

const documentOutline = <path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7M13 3l5 5h-5z" />
const glyphs = {
  copy: <><rect x="8" y="8" width="11" height="12" rx="1.5" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v11A1.5 1.5 0 0 0 5.5 18H8" /></>,
  check: <path d="m5 12 4 4 10-10" />,
  "document-add": <>{documentOutline}<path d="M18 13v8m-4-4h8" /></>,
  "document-edit": <>{documentOutline}<path d="m15 18 5-5 2 2-5 5-3 1z" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 11h18" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
}

// Controls own accessible names and interaction; their icons are decorative.
export function Icon({ name, size = 16 }: {
  readonly name: keyof typeof glyphs
  readonly size?: 16 | 18
}): ReactElement {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{glyphs[name]}</svg>
}
