import type { ReactElement } from "react"
import { HexValue } from "./hex-value.tsx"

export function BuildFooter({ revision, builtAt, modified, development }: {
  readonly revision: string | undefined
  readonly builtAt: string | undefined
  readonly modified: boolean
  readonly development: boolean
}): ReactElement {
  return <footer className="build-footer" aria-label="Viewer build">
    {revision && builtAt ? <>
      <span>Viewer <HexValue value={revision} label="viewer revision" href={`https://github.com/numpde/dapp32/commit/${revision}`} />{modified ? " (modified)" : ""}</span>
      <span aria-hidden="true">·</span>
      <span>Built <time dateTime={builtAt} title={builtAt}>{new Date(builtAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} UTC</time></span>
    </> : <span>Viewer · {development ? "Development build" : "Build metadata unavailable"}</span>}
  </footer>
}
