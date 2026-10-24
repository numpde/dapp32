import { createContext, useContext, useEffect } from "react"
import { defaultIpfsGateway } from "../../../tools/ipfs-gateways.ts"

export const IpfsGatewayContext = createContext(defaultIpfsGateway.template)

export const IpfsResourceContext = createContext<(() => () => void) | undefined>(undefined)

export function useIpfsResource(...uris: readonly (string | undefined)[]): void {
  const register = useContext(IpfsResourceContext)
  const present = uris.some(uri => uri?.startsWith("ipfs://"))
  useEffect(() => present ? register?.() : undefined, [present, register])
}
