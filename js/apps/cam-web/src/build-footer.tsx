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
      <span className="build-revision"><span>Viewer</span><HexValue value={revision} label="viewer revision" href={`https://github.com/numpde/dapp32/commit/${revision}`} />{modified ? <span>(modified)</span> : null}</span>
      <span aria-hidden="true">·</span>
      <span>Built <time dateTime={builtAt} title={builtAt}>{new Date(builtAt).toISOString().slice(0, 10)} UTC</time></span>
    </> : <span>Viewer · {development ? "Development build" : "Build metadata unavailable"}</span>}
  </footer>
}
