import { createContext } from "react"
import { defaultIpfsGateway } from "@cam/viewer"
import { assertDownloadAllowed } from "@cam/protocol"

export const DownloadContext = createContext({
  gateway: defaultIpfsGateway.template,
  assertAllowed: (uri: string) => assertDownloadAllowed(uri, { kind: "https-or-ipfs" }),
})
