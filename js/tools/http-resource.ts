import {
  readBoundedResponseBytes,
  requireHttpOrigin,
  requireSameHttpOrigin,
} from "../packages/cam-protocol/dist/index.js"

export function createSameOriginHttpResourceLoader(options: {
  readonly originInput: string
  readonly originLabel: string
  readonly loadFailurePrefix: string
}): (uri: string) => Promise<Uint8Array> {
  const origin = requireHttpOrigin(options.originInput, options.originLabel)

  return async (uri: string): Promise<Uint8Array> => {
    const resourceURL = requireSameHttpOrigin(uri, origin, "CAM resource URI")
    const response = await fetch(resourceURL.href, { redirect: "error" })
    if (!response.ok) {
      throw new Error(`${options.loadFailurePrefix} ${resourceURL.href}: HTTP ${response.status}`)
    }

    const bytes = await readBoundedResponseBytes(response, resourceURL.href)
    return bytes
  }
}
