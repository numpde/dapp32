export const CAM_RESOURCE_MAX_BYTES = 2 * 1024 * 1024
const SHA256_INTEGRITY_PREFIX = "sha256:"
const SHA256_HEX_PATTERN = /^0x[0-9a-f]{64}$/
const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"
const BASE58BTC_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"

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

export function assertCamSecondaryResourceURI(uri: string, label: string): void {
  if (isLocalCamSecondaryResourceURI(uri) || isIpfsCamSecondaryResourceURI(uri)) return

  throw new Error(`${label}: CAM resource URI must be local ./... or ipfs://<CID>[...]: ${uri}`)
}

export function assertCamResourceSize(
  bytes: Uint8Array,
  uri: string,
  maxBytes = CAM_RESOURCE_MAX_BYTES,
): void {
  if (bytes.byteLength > maxBytes) {
    throw new Error(`CAM resource is too large: ${uri} has ${bytes.byteLength} bytes; limit is ${maxBytes}`)
  }
}

function isLocalCamSecondaryResourceURI(uri: string): boolean {
  const prefix = "./"
  if (!uri.startsWith(prefix)) return false

  return isCamResourcePath(uri.slice(prefix.length))
}

function isIpfsCamSecondaryResourceURI(uri: string): boolean {
  const prefix = "ipfs://"
  if (!uri.startsWith(prefix)) return false

  const path = uri.slice(prefix.length)
  if (!isCamResourcePath(path)) return false

  const [root] = path.split("/")
  return root !== undefined && isSupportedIpfsCid(root)
}

function isCamResourcePath(path: string): boolean {
  if (path.length === 0 || path.includes("?") || path.includes("#")) return false
  // CAM manifests should be reviewable as written. Reject percent escapes and
  // raw backslashes so downstream URL/file handlers cannot reinterpret encoded
  // or platform-specific separator forms.
  if (path.includes("%") || path.includes("\\")) return false
  return path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

function isSupportedIpfsCid(value: string): boolean {
  // CAM V1 accepts the two CID spellings operators most commonly review by
  // sight: CIDv0 base58btc and CIDv1 base32. Wider multibase support can be
  // added deliberately when a real manifest needs it.
  if (/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/.test(value)) {
    return isCidV0Sha256(decodeBase58btc(value))
  }
  if (/^b[a-z2-7]{20,}$/.test(value)) {
    return isCidV1(decodeBase32(value.slice(1)))
  }

  return false
}

function isCidV0Sha256(bytes: Uint8Array | undefined): boolean {
  return bytes !== undefined && bytes.length === 34 && bytes[0] === 0x12 && bytes[1] === 0x20
}

function isCidV1(bytes: Uint8Array | undefined): boolean {
  if (bytes === undefined) return false

  const version = readVarint(bytes, 0)
  if (version === undefined || version.value !== 1) return false

  const codec = readVarint(bytes, version.offset)
  if (codec === undefined || codec.value === 0) return false

  const hashCode = readVarint(bytes, codec.offset)
  if (hashCode === undefined || hashCode.value !== 0x12) return false

  const hashLength = readVarint(bytes, hashCode.offset)
  if (hashLength === undefined || hashLength.value !== 32) return false

  return bytes.length === hashLength.offset + Number(hashLength.value)
}

function decodeBase32(value: string): Uint8Array | undefined {
  const bytes: number[] = []
  let buffer = 0
  let bits = 0

  for (const char of value) {
    const digit = BASE32_ALPHABET.indexOf(char)
    if (digit < 0) return undefined

    buffer = (buffer << 5) | digit
    bits += 5
    while (bits >= 8) {
      bits -= 8
      bytes.push((buffer >> bits) & 0xff)
    }
  }

  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) return undefined
  return new Uint8Array(bytes)
}

function decodeBase58btc(value: string): Uint8Array | undefined {
  const bytes = [0]

  for (const char of value) {
    const digit = BASE58BTC_ALPHABET.indexOf(char)
    if (digit < 0) return undefined

    let carry = digit
    for (let index = 0; index < bytes.length; index += 1) {
      carry += bytes[index] * 58
      bytes[index] = carry & 0xff
      carry >>= 8
    }
    while (carry > 0) {
      bytes.push(carry & 0xff)
      carry >>= 8
    }
  }

  for (const char of value) {
    if (char !== "1") break
    bytes.push(0)
  }

  return new Uint8Array(bytes.reverse())
}

function readVarint(bytes: Uint8Array, offset: number): { readonly value: number, readonly offset: number } | undefined {
  let value = 0
  let multiplier = 1

  for (let index = offset; index < bytes.length; index += 1) {
    const byte = bytes[index]
    value += (byte & 0x7f) * multiplier
    if (!Number.isSafeInteger(value)) return undefined
    if ((byte & 0x80) === 0) {
      if (index > offset && byte === 0) return undefined
      return { value, offset: index + 1 }
    }
    multiplier *= 128
    if (!Number.isSafeInteger(multiplier)) return undefined
  }

  return undefined
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
