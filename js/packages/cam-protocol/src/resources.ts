export const CAM_RESOURCE_MAX_BYTES = 2 * 1024 * 1024
const SHA256_INTEGRITY_PREFIX = "sha256:"
const SHA256_HEX_PATTERN = /^0x[0-9a-f]{64}$/

export type CamResourceIntegrityErrorCode =
  | "CAM_RESOURCE_INTEGRITY_INVALID"
  | "CAM_RESOURCE_INTEGRITY_MISMATCH"

export class CamResourceIntegrityError extends Error {
  readonly code: CamResourceIntegrityErrorCode

  constructor(code: CamResourceIntegrityErrorCode, message: string) {
    super(message)
    this.name = "CamResourceIntegrityError"
    this.code = code
  }
}

// Keep public resource types structural so non-browser protocol consumers do
// not need DOM lib declarations just to import @cam/protocol.
export type HttpURL = {
  readonly href: string
  readonly origin: string
  readonly protocol: string
  readonly username: string
  readonly password: string
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

export type HttpResponse = {
  readonly body?: unknown
  readonly headers: {
    readonly get: (name: string) => string | null
  }
}

export type HttpByteStreamReader = {
  readonly read: () => Promise<{
    readonly done: boolean
    readonly value?: Uint8Array
  }>
  readonly cancel?: () => Promise<void>
  readonly releaseLock?: () => void
}

export function requireHttpURL(value: string, label: string): HttpURL {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label}: expected http or https URL`)
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(`${label}: credentials are not allowed`)
  }

  return url
}

export function requireHttpOrigin(value: string, label: string): string {
  const url = requireHttpURL(value, label)
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "") {
    throw new Error(`${label}: expected an HTTP(S) origin without path, query, or fragment`)
  }

  return url.origin
}

export function requireSameHttpOrigin(uri: string, origin: string, label: string): HttpURL {
  const url = requireHttpURL(uri, label)
  if (url.origin !== origin) {
    throw new Error(`${label}: resource is outside allowed origin: ${url.href}`)
  }

  return url
}

export function responseContentLength(response: HttpResponse, uri: string): number | undefined {
  const value = response.headers.get("content-length")
  if (value === null) return undefined

  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`CAM resource has invalid Content-Length: ${uri}`)
  }

  return Number(value)
}

export function verifySha256ResourceIntegrity({
  actualHash,
  integrity,
  uri,
}: {
  readonly actualHash: string
  readonly integrity: string
  readonly uri: string
}): void {
  if (!integrity.startsWith(SHA256_INTEGRITY_PREFIX)) {
    throw new CamResourceIntegrityError(
      "CAM_RESOURCE_INTEGRITY_INVALID",
      `CAM resource integrity must use sha256: ${uri}`,
    )
  }

  const expectedHash = integrity.slice(SHA256_INTEGRITY_PREFIX.length)
  if (!SHA256_HEX_PATTERN.test(expectedHash)) {
    throw new CamResourceIntegrityError(
      "CAM_RESOURCE_INTEGRITY_INVALID",
      `CAM resource integrity is not a sha256 hex digest: ${uri}`,
    )
  }

  if (!SHA256_HEX_PATTERN.test(actualHash)) {
    throw new CamResourceIntegrityError(
      "CAM_RESOURCE_INTEGRITY_INVALID",
      `CAM resource actual hash is not a sha256 hex digest: ${uri}`,
    )
  }

  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new CamResourceIntegrityError(
      "CAM_RESOURCE_INTEGRITY_MISMATCH",
      `CAM resource integrity mismatch: expected ${integrity}, got ${SHA256_INTEGRITY_PREFIX}${actualHash}`,
    )
  }
}

export async function readBoundedResponseBytes(
  response: HttpResponse,
  uri: string,
  maxBytes = CAM_RESOURCE_MAX_BYTES,
): Promise<Uint8Array> {
  const contentLength = responseContentLength(response, uri)
  if (contentLength !== undefined && contentLength > maxBytes) {
    throw new Error(`CAM resource is too large: ${uri}`)
  }

  if (!isStreamBody(response.body)) {
    throw new Error(`CAM resource response body is not streamable: ${uri}`)
  }

  // Do not buffer the full body before enforcing the CAM resource size cap.
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let byteLength = 0

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break

      const value = chunk.value
      if (value === undefined) {
        throw new Error(`CAM resource stream returned an empty chunk: ${uri}`)
      }

      byteLength += value.byteLength
      if (byteLength > maxBytes) {
        await reader.cancel?.()
        throw new Error(`CAM resource is too large: ${uri}`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock?.()
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

function isStreamBody(value: unknown): value is { readonly getReader: () => HttpByteStreamReader } {
  return value !== null
    && typeof value === "object"
    && "getReader" in value
    && typeof value.getReader === "function"
}
