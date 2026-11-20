import { useEffect, useRef } from "react"
import type { ReactElement } from "react"
import { publicIpfsGateways } from "@cam/viewer"
import { failureReport } from "./errors.ts"
import { Feedback } from "./feedback.tsx"
import { checkIpfsGateway } from "./gateway-check.ts"
import { ControlRow } from "./property-row.tsx"
import { StatusSelect } from "./status-select.tsx"
import { useResource } from "./use-resource.ts"

type IpfsGateway = (typeof publicIpfsGateways)[number]

export function IpfsGatewayControls({ gateway, onSelect }: {
  readonly gateway: IpfsGateway
  readonly onSelect: (gateway: IpfsGateway) => void
}): ReactElement {
  const { resource, run, cancel } = useResource<void>()
  const checkedGateway = useRef<IpfsGateway | undefined>(undefined)
  useEffect(() => {
    checkedGateway.current = gateway
    void run(signal => checkIpfsGateway(gateway.template, signal))
    return cancel
  }, [gateway, run, cancel])
  const current = checkedGateway.current === gateway
  const checking = current && resource.status === "pending"
  const status = !current ? undefined
    : resource.status === "pending" ? { kind: "checking", label: "Checking IPFS gateway" } as const
    : resource.status === "ready" ? { kind: "success", label: "Gateway test file retrieved" } as const
    : resource.status === "failed" ? { kind: "failure", label: "IPFS gateway check failed" } as const
    : undefined

  return <ControlRow className="ipfs-gateway" label="IPFS gateway" controlId="ipfs-gateway-choice">
    <div className="connection-form" aria-busy={checking}>
      <StatusSelect id="ipfs-gateway-choice" value={gateway.id} status={status} aria-describedby="ipfs-gateway-help" onChange={event => {
        checkedGateway.current = undefined
        cancel()
        onSelect(publicIpfsGateways.find(choice => choice.id === event.currentTarget.value)!)
      }}>
        {publicIpfsGateways.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}
      </StatusSelect>
      <span id="ipfs-gateway-help" className="visually-hidden">Used for new IPFS downloads.</span>
      {current && resource.status === "failed" ? <Feedback report={failureReport(resource.error)} kind="error" /> : null}
    </div>
  </ControlRow>
}
