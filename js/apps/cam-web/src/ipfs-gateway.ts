import { createContext } from "react"
import { defaultIpfsGateway } from "../../../tools/ipfs-gateways.ts"

export const IpfsGatewayContext = createContext(defaultIpfsGateway.template)
