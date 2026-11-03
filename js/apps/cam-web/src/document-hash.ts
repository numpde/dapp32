import { requireHttpURL, resolveIpfsGatewayURL } from "@cam/protocol"
import type { HttpURL } from "@cam/protocol"
import { UserFacingError } from "./errors.ts"
import { readDataURI } from "./data-uri.ts"
import { RESOURCE_FETCH_OPTIONS, readAbortableBoundedBytes, withResourceDeadline } from "./resource-read.ts"

export const DOCUMENT_HASH_MAX_BYTES = 8 * 1024 * 1024
const ALTERNATIVES = "Choose a local file or enter the digest manually."

export async function calculateDocumentHashFromURL(uri: string, signal: AbortSignal, assertAllowed: (uri: string) => void, ipfsGatewayTemplate?: string): Promise<string> {
  if (/^data:/i.test(uri)) return calculate(signal, async () => readDataURI(uri, DOCUMENT_HASH_MAX_BYTES).bytes)
  let url: HttpURL
  try {
    assertAllowed(uri)
    if (uri.startsWith("ipfs://") && ipfsGatewayTemplate === undefined) throw new Error("Choose an IPFS gateway to download this document")
    url = requireHttpURL(uri.startsWith("ipfs://") ? resolveIpfsGatewayURL(uri, ipfsGatewayTemplate!) : uri, "Document URL")
  }
  catch (cause) { if (cause instanceof UserFacingError) throw cause; throw new UserFacingError(`Cannot read this document URL. Enter a complete http://, https:// or ipfs:// address without a username or password; IPFS downloads need a selected gateway. ${ALTERNATIVES}`, { cause }) }
  return calculate(signal, async (activeSignal) => {
    let response: Response
    try {
      response = await fetch(url.href, {
        ...RESOURCE_FETCH_OPTIONS, signal: activeSignal,
      })
    } catch (cause) {
      activeSignal.throwIfAborted()
      throw new UserFacingError(`Cannot read this URL. Check connectivity, browser CORS access and redirects. ${ALTERNATIVES}`, { cause })
    }
    if (!response.ok || response.type === "opaque" || response.body === null) {
      void response.body?.cancel().catch(() => {})
      throw new UserFacingError(`Cannot read document bytes (HTTP ${response.status}). ${ALTERNATIVES}`)
    }
    // Fetch streams contain HTTP-decoded bytes, not compressed wire bytes.
    return readDocumentBytes(response.body, activeSignal)
  })
}

export async function calculateDocumentHashFromFile(file: File, signal: AbortSignal): Promise<string> {
  if (file.size > DOCUMENT_HASH_MAX_BYTES) throw new UserFacingError("Document exceeds the 8 MiB limit. Enter its digest manually.")
  return calculate(signal, activeSignal => readDocumentBytes(file.stream(), activeSignal))
}

async function readDocumentBytes(body: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Uint8Array> {
  try {
    return await readAbortableBoundedBytes(body, signal, "document", DOCUMENT_HASH_MAX_BYTES)
  } catch (cause) {
    signal.throwIfAborted()
    if (cause instanceof Error && cause.message === "CAM resource is too large: document") {
      throw new UserFacingError("Document exceeds the 8 MiB limit. Enter its digest manually.", { cause })
    }
    throw new UserFacingError(`Cannot read document bytes. ${ALTERNATIVES}`, { cause })
  }
}

async function calculate(signal: AbortSignal, acquire: (signal: AbortSignal) => Promise<Uint8Array>): Promise<string> {
  return withResourceDeadline(signal, new UserFacingError(`Document calculation exceeded 15 seconds. ${ALTERNATIVES}`), () => new UserFacingError("Document calculation cancelled."), async activeSignal => {
    const bytes = await acquire(activeSignal)
    activeSignal.throwIfAborted()
    // Web Crypto hashes the exact buffer; no text decoding or normalization.
    const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)
    activeSignal.throwIfAborted()
    return `0x${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`
  })
}
