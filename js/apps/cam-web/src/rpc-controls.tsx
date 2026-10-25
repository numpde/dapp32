import { useEffect, useRef, useState } from "react"
import type { ReactElement } from "react"
import { publicRpcEndpoints } from "@cam/viewer"
import { requireHttpURL } from "@cam/protocol"
import { failureReport, UserFacingError } from "./errors.ts"
import type { FailureReport } from "./errors.ts"
import { Feedback } from "./feedback.tsx"
import { displayRpcEndpoint } from "./startup.ts"

export function RpcControls({ chainId, suppliedURLs, activeURL, busy, autoStart, submitLabel, onApply }: {
  readonly chainId: string
  readonly suppliedURLs: readonly string[]
  readonly activeURL: string | undefined
  readonly busy: boolean
  readonly autoStart: boolean
  readonly submitLabel: string
  readonly onApply: (url: string) => Promise<void>
}): ReactElement {
  const [endpoints] = useState(() => publicRpcEndpoints(chainId))
  const [choice, setChoice] = useState(() => {
    if (suppliedURLs.length > 0) {
      try {
        const supplied = requireHttpURL(suppliedURLs[0]!, "RPC URL").href
        return endpoints.some(endpoint => endpoint.url === supplied) ? supplied : "custom"
      }
      // silent-defaults: allow-default -- Invalid explicit links stay editable as Custom, without choosing another endpoint.
      catch { return "custom" }
    }
    return endpoints.length === 0 ? "custom" : endpoints[0]!.url
  })
  const [customURL, setCustomURL] = useState(suppliedURLs.length === 0 ? "" : suppliedURLs[0]!)
  const [error, setError] = useState<FailureReport | undefined>(undefined)
  const started = useRef(false)
  const applying = useRef(false)
  const [checking, setChecking] = useState(false)

  async function apply(): Promise<void> {
    if (applying.current) return
    applying.current = true
    setChecking(true)
    setError(undefined)
    try {
      const url = choice === "custom" ? customURL : choice
      await onApply(requireHttpURL(url, "RPC URL").href)
    } catch (cause) {
      setError(failureReport(cause, "Cannot use this RPC. Correct the URL or choose another service."))
    } finally { applying.current = false; setChecking(false) }
  }

  useEffect(() => {
    if (started.current || !autoStart) return
    started.current = true
    if (suppliedURLs.length > 1) {
      setError(failureReport(new UserFacingError("This link has more than one RPC URL. Choose the service to use.")))
    } else if (suppliedURLs.length > 0 || choice !== "custom") void apply()
  }, [])

  return <div className="rpc-connection">
    <dt><label htmlFor="rpc-endpoint-choice">RPC service</label></dt>
    <dd><form id="rpc-connection-form" className="connection-form" noValidate onSubmit={event => { event.preventDefault(); void apply() }}>
      <select id="rpc-endpoint-choice" aria-describedby="rpc-help" value={choice} disabled={checking} onChange={event => { setChoice(event.currentTarget.value); setError(undefined) }}>
        {endpoints.map(endpoint => <option key={endpoint.url} value={endpoint.url}>{endpoint.name}</option>)}
        <option value="custom">Custom RPC URL</option>
      </select>
      {choice === "custom" ? <label className="field"><span>Custom RPC URL</span><input id="rpc-endpoint-url" type="url" aria-describedby="rpc-help" value={customURL} disabled={checking} onChange={event => { setCustomURL(event.currentTarget.value); setError(undefined) }} /></label> : null}
      <button id="rpc-apply" className="button-quiet" type="submit" disabled={busy || checking} aria-busy={checking}>{submitLabel}</button>
      <p className="field-hint" id="rpc-help">Changes last until you reload this page.</p>
      {activeURL === undefined ? null : <p className="field-hint" role="status">In use: {displayRpcEndpoint(activeURL)}</p>}
      {error === undefined ? null : <Feedback report={error} kind="error" />}
    </form></dd>
  </div>
}
