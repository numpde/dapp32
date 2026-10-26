import { useState } from "react"
import type { ReactElement } from "react"
import { requireEvmChainId } from "@cam/evm-viem"
import { evmNetworkChoices } from "@cam/viewer"
import { RpcControls } from "./rpc-controls.tsx"
import { failureReport } from "./errors.ts"
import type { FailureReport } from "./errors.ts"
import { Feedback } from "./feedback.tsx"
import { parseStartupCoordinates } from "./startup.ts"
import type { ConnectionOptions, StartupCoordinates } from "./startup.ts"

export function AppSetup({ onOpen, rpcURLs }: {
  readonly rpcURLs: readonly string[]
  readonly onOpen: (connection: ConnectionOptions) => void
}): ReactElement {
  const [sourceURL] = useState(() => new URL(location.href))
  const [networks] = useState(evmNetworkChoices)
  const [chain, setChain] = useState(() => initialFieldValue("chainId"))
  const [network, setNetwork] = useState(() => networks.some(choice => choice.chainId === chain) ? chain : "custom")
  const [host, setHost] = useState(() => initialFieldValue("host"))
  const [account, setAccount] = useState(() => initialFieldValue("account"))
  const [error, setError] = useState<FailureReport | undefined>(undefined)
  function initialFieldValue(name: string): string {
    const supplied = sourceURL.searchParams.get(name)
    return supplied === null ? "" : supplied
  }
  let validChain: string | undefined
  try { validChain = requireEvmChainId(chain) }
  // Incomplete network input is editable; it must not start an RPC request.
  catch { validChain = undefined }

  async function open(rpcUrl: string): Promise<void> {
    setError(undefined)
    const url = new URL(sourceURL)
    url.search = new URLSearchParams({ chainId: chain, host }).toString()
    if (account !== "") url.searchParams.set("account", account)
    let coordinates: StartupCoordinates
    try { coordinates = parseStartupCoordinates(url) }
    catch (cause) {
      setError(failureReport(cause, "Cannot open the app. Check the network, CAM contract address and optional viewing address."))
      return
    }
    history.replaceState(null, "", url)
    onOpen({ ...coordinates, rpcUrl })
  }

  return <section className="panel app-setup" aria-labelledby="app-setup-title">
    <h2 id="app-setup-title">Open a contract app</h2>
    <p>Choose its network and enter the CAM contract address.</p>
    <label className="field"><span>Network</span><select id="app-network" value={network} onChange={event => {
      const selected = event.currentTarget.value
      setNetwork(selected)
      if (selected !== "custom") setChain(selected)
    }}><option value="custom">Custom chain</option>{networks.map(choice => <option key={choice.chainId} value={choice.chainId}>{choice.name}</option>)}</select></label>
    {network === "custom" ? <label className="field"><span>Chain ID, such as eip155:43113</span><input id="app-chain" form="rpc-connection-form" value={chain} onChange={event => setChain(event.currentTarget.value)} /></label> : null}
    <label className="field"><span>CAM contract address</span><input id="app-host" form="rpc-connection-form" value={host} onChange={event => setHost(event.currentTarget.value)} /></label>
    <p className="field-hint">The contract publishes the app’s manifest and contract bindings.</p>
    <label className="field"><span>Viewing address (optional)</span><input id="app-account" form="rpc-connection-form" value={account} onChange={event => setAccount(event.currentTarget.value)} /></label>
    <p className="field-hint">Leave blank for a public view. You can connect a signing wallet after opening the app.</p>
    {error === undefined ? null : <Feedback report={error} kind="error" />}
    {validChain === undefined ? null : <div className="connection-facts"><RpcControls key={validChain} chainId={validChain} suppliedURLs={rpcURLs} activeURL={undefined} busy={false} mode="setup" onApply={open} /></div>}
  </section>
}
