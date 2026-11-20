import { createCamResourceLoader } from "@cam/protocol"
import { UserFacingError } from "./errors.ts"
import { RESOURCE_FETCH_OPTIONS, withResourceDeadline } from "./resource-read.ts"

export const IPFS_GATEWAY_TEST_URI = "ipfs://QmT78zSuBmuS4z925WZfrqQ1qHaJ56DQaTfyMUF7F8ff5o"
const expectedBytes = new TextEncoder().encode("hello world\n")

export function checkIpfsGateway(template: string, signal: AbortSignal): Promise<void> {
  return withResourceDeadline(signal, new UserFacingError("IPFS gateway check exceeded 15 seconds."), () => signal.reason, async activeSignal => {
    const load = createCamResourceLoader({
      originLabel: "Gateway check",
      loadFailurePrefix: "Cannot retrieve gateway test file",
      ipfsGatewayTemplate: template,
      cache: RESOURCE_FETCH_OPTIONS.cache,
      fetchResource: (url, init) => fetch(url, { ...RESOURCE_FETCH_OPTIONS, ...init, signal: activeSignal }),
    })
    let bytes: Uint8Array
    try { bytes = await load(IPFS_GATEWAY_TEST_URI) }
    catch (cause) {
      activeSignal.throwIfAborted()
      throw new UserFacingError("Cannot retrieve the test file through this IPFS gateway.", { cause })
    }
    activeSignal.throwIfAborted()
    if (bytes.length !== expectedBytes.length || !bytes.every((byte, index) => byte === expectedBytes[index])) {
      throw new UserFacingError("The gateway returned unexpected test-file contents.")
    }
  })
}
