import { readBoundedResponseBytes, requireHttpURL } from "@cam/protocol"
import type { HttpURL } from "@cam/protocol"
import { UserFacingError } from "./errors.ts"

export const DOCUMENT_HASH_MAX_BYTES = 8 * 1024 * 1024
const DEADLINE_MS = 15_000
const ALTERNATIVES = "Choose a local file or enter the digest manually."

export async function calculateDocumentHashFromURL(uri: string, signal: AbortSignal): Promise<string> {
  // User document URLs have no CAM publication origin constraint. Redirects
  // are rejected so the explicit action never silently changes its source.
  let url: HttpURL
  try { url = requireHttpURL(uri, "Document URL") }
  catch (cause) { throw new UserFacingError(`Cannot read this document URL. Enter a complete http:// or https:// address without a username or password. ${ALTERNATIVES}`, { cause }) }
  return calculate(signal, async (activeSignal) => {
    let response: Response
    try {
      response = await fetch(url.href, {
        signal: activeSignal, mode: "cors", credentials: "omit",
        referrerPolicy: "no-referrer", redirect: "error", cache: "no-store",
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
  if (signal.aborted) {
    void body.cancel().catch(() => {})
    signal.throwIfAborted()
  }
  const reader = body.getReader()
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener("abort", cancel, { once: true })
  try {
    signal.throwIfAborted()
    return await readBoundedResponseBytes({ body: { getReader: () => reader } }, "document", DOCUMENT_HASH_MAX_BYTES)
  } catch (cause) {
    signal.throwIfAborted()
    if (cause instanceof Error && cause.message === "CAM resource is too large: document") {
      throw new UserFacingError("Document exceeds the 8 MiB limit. Enter its digest manually.", { cause })
    }
    throw new UserFacingError(`Cannot read document bytes. ${ALTERNATIVES}`, { cause })
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}

async function calculate(signal: AbortSignal, acquire: (signal: AbortSignal) => Promise<Uint8Array>): Promise<string> {
  const controller = new AbortController()
  const cancel = () => controller.abort(new UserFacingError("Document calculation cancelled."))
  signal.addEventListener("abort", cancel, { once: true })
  if (signal.aborted) cancel()
  const timer = setTimeout(() => controller.abort(new UserFacingError(`Document calculation exceeded 15 seconds. ${ALTERNATIVES}`)), DEADLINE_MS)
  let rejectAbort: () => void = () => {}
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = () => reject(controller.signal.reason)
    controller.signal.addEventListener("abort", rejectAbort, { once: true })
    if (controller.signal.aborted) rejectAbort()
  })
  try {
    return await Promise.race([aborted, (async () => {
      controller.signal.throwIfAborted()
      const bytes = await acquire(controller.signal)
      controller.signal.throwIfAborted()
      // Web Crypto hashes the exact buffer; no text decoding or normalization.
      const digest = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>)
      controller.signal.throwIfAborted()
      return `0x${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`
    })()])
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", cancel)
    controller.signal.removeEventListener("abort", rejectAbort)
  }
}
