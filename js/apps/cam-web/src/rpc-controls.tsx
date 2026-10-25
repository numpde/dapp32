import { useEffect, useRef, useState } from "react"
import type { ReactElement } from "react"
import { publicRpcEndpoints } from "@cam/viewer"
import { requireHttpURL } from "@cam/protocol"
import { failureReport, UserFacingError } from "./errors.ts"
import type { FailureReport } from "./errors.ts"
import { Feedback } from "./feedback.tsx"
import { ControlRow } from "./property-row.tsx"

type RpcDraft = { readonly choice: string; readonly customURL: string }
type Candidate = { readonly draft: RpcDraft; readonly url: string }
type Attempt =
  | { readonly draft: RpcDraft; readonly status: "checking" | "settled" }
  | { readonly draft: RpcDraft; readonly status: "failed"; readonly failure: FailureReport }

export function RpcControls({ chainId, suppliedURLs, activeURL, busy, mode, onApply }: {
  readonly chainId: string
  readonly suppliedURLs: readonly string[]
  readonly activeURL: string | undefined
  readonly busy: boolean
  readonly mode: "setup" | "connection"
  readonly onApply: (url: string) => Promise<void>
}): ReactElement {
  const [endpoints] = useState(() => publicRpcEndpoints(chainId))
  const [draft, setDraft] = useState<RpcDraft>(() => {
    const customURL = suppliedURLs.length === 0 ? "" : suppliedURLs[0]!
    let choice = endpoints.length === 0 ? "custom" : endpoints[0]!.url
    if (suppliedURLs.length > 0) {
      try {
        const supplied = requireHttpURL(customURL, "RPC URL").href
        choice = endpoints.some(endpoint => endpoint.url === supplied) ? supplied : "custom"
      }
      // Invalid explicit links remain editable instead of selecting another service.
      catch { choice = "custom" }
    }
    return { choice, customURL }
  })
  const initialDraft = useRef(draft)
  const currentDraft = useRef(draft)
  const ports = useRef({ busy, onApply })
  ports.current = { busy, onApply }
  const mounted = useRef(true)
  const running = useRef<Candidate | undefined>(undefined)
  const pending = useRef<Candidate | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [attempt, setAttempt] = useState<Attempt | undefined>(undefined)

  function edit(next: RpcDraft): void {
    currentDraft.current = next
    pending.current = undefined
    setDraft(next)
    setAttempt(undefined)
  }

  function enqueue(selected: RpcDraft): void {
    if (selected !== currentDraft.current) return
    if (running.current?.draft === selected || pending.current?.draft === selected) return
    try {
      const url = requireHttpURL(selected.choice === "custom" ? selected.customURL : selected.choice, "RPC URL").href
      pending.current = { draft: selected, url }
      drain()
    } catch (cause) {
      setAttempt({ draft: selected, status: "failed", failure: failureReport(cause, "Enter a complete http:// or https:// RPC URL.") })
    }
  }

  function drain(): void {
    if (!mounted.current || running.current !== undefined || ports.current.busy) return
    const candidate = pending.current
    if (candidate === undefined) return
    pending.current = undefined
    if (candidate.draft !== currentDraft.current) return
    running.current = candidate
    setAttempt({ draft: candidate.draft, status: "checking" })
    void run(candidate)
  }

  async function run(candidate: Candidate): Promise<void> {
    try {
      await ports.current.onApply(candidate.url)
      if (mounted.current && candidate.draft === currentDraft.current) setAttempt({ draft: candidate.draft, status: "settled" })
    } catch (cause) {
      if (mounted.current && candidate.draft === currentDraft.current) setAttempt({ draft: candidate.draft, status: "failed", failure: failureReport(cause, "Cannot connect to this RPC.") })
    } finally {
      running.current = undefined
      drain()
    }
  }

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; pending.current = undefined }
  }, [])
  useEffect(() => {
    if (mode === "setup") return
    if (draft === initialDraft.current && suppliedURLs.length > 1) {
      setAttempt({ draft, status: "failed", failure: failureReport(new UserFacingError("This link has more than one RPC URL. Choose the service to use.")) })
      return
    }
    if (draft.choice !== "custom") { enqueue(draft); return }
    if (draft.customURL === "" && suppliedURLs.length === 0) return
    timer.current = setTimeout(() => { timer.current = undefined; enqueue(draft) }, 400)
    return () => { clearTimeout(timer.current); timer.current = undefined }
  }, [draft, mode])
  useEffect(() => { if (!busy) drain() }, [busy])

  let displayedURL: string | undefined
  try { displayedURL = requireHttpURL(draft.choice === "custom" ? draft.customURL : draft.choice, "RPC URL").href }
  // An incomplete draft has no endpoint whose connection can be acknowledged.
  catch { displayedURL = undefined }
  const currentAttempt = attempt?.draft === draft ? attempt : undefined
  const checked = mode === "connection" && displayedURL !== undefined && displayedURL === activeURL && currentAttempt?.status !== "checking" && currentAttempt?.status !== "failed"
  const check = checked ? <span role="img" aria-label="RPC connection checked" title="RPC connection checked">✓</span> : null

  return <ControlRow className="rpc-connection" label="RPC service" controlId="rpc-endpoint-choice">
    <form id="rpc-connection-form" className="connection-form" noValidate aria-busy={currentAttempt?.status === "checking"} onSubmit={event => { event.preventDefault(); clearTimeout(timer.current); timer.current = undefined; enqueue(draft) }}>
      <div className="rpc-input-row"><select id="rpc-endpoint-choice" value={draft.choice} onChange={event => edit({ ...draft, choice: event.currentTarget.value })}>
        {endpoints.map(endpoint => <option key={endpoint.url} value={endpoint.url}>{endpoint.name}</option>)}
        <option value="custom">Custom RPC URL</option>
      </select><span className="rpc-check" role="status">{draft.choice === "custom" ? null : check}</span></div>
      {draft.choice === "custom" ? <div className="rpc-input-row"><input id="rpc-endpoint-url" type="url" aria-label="Custom RPC URL" aria-describedby={currentAttempt?.status === "failed" ? "rpc-connection-feedback" : undefined} value={draft.customURL} onChange={event => edit({ ...draft, customURL: event.currentTarget.value })} /><span className="rpc-check" role="status">{check}</span></div> : null}
      {mode === "setup" ? <button id="app-open" className="button-quiet" type="submit" disabled={busy || currentAttempt?.status === "checking"}>Open app</button> : null}
      {currentAttempt?.status === "failed" ? <div id="rpc-connection-feedback"><Feedback report={currentAttempt.failure} kind="error" /></div> : null}
    </form>
  </ControlRow>
}
