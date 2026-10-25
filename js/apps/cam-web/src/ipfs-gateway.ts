import { createContext } from "react"
import { defaultIpfsGateway } from "@cam/viewer"

export const IpfsGatewayContext = createContext(defaultIpfsGateway.template)
