export const CAM_RESOURCE_MAX_BYTES = 2 * 1024 * 1024
const SCHEME_RE = /^[A-Za-z][A-Za-z0-9+.-]*:/
const HIERARCHICAL_URI_RE = /^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#]*)([^?#]*)([?#].*)?$/
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

export type HttpResourceCacheMode =
  | "default"
  | "force-cache"
  | "no-cache"
  | "no-store"
  | "only-if-cached"
  | "reload"

export type HttpResourceResponse = HttpResponse & {
  readonly ok: boolean
  readonly status: number
}

export type HttpResourceFetcher = (
  href: string,
  init: {
    readonly cache?: HttpResourceCacheMode
    readonly redirect: "error"
  },
) => Promise<HttpResourceResponse>

export function requireHttpURL(value: string, label: string): HttpURL {
  assertURIString(value, label)
  rejectRawHttpUrlSyntax(value, label)
  let url: URL
  try {
    url = new URL(value)
  } catch (cause) {
    throw new Error(`${label}: expected absolute URL`, { cause })
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${label}: expected http or https URL`)
  }
  if (url.username !== "" || url.password !== "") {
    throw new Error(`${label}: credentials are not allowed`)
  }

  return url
}

function rejectRawHttpUrlSyntax(value: string, label: string): void {
  // WHATWG URL parsing is intentionally forgiving: it can strip controls and
  // treat backslashes as path separators. CAM accepts only reviewable HTTP(S)
  // strings here, so reject raw forms that would be parsed as a different URL.
  if (/[\u0000-\u001f\u007f\\]/u.test(value)) {
    throw new Error(`${label}: URL contains unsafe raw characters`)
  }
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

export function createSameOriginHttpResourceLoader(options: {
  readonly originInput: string
  readonly originLabel: string
  readonly loadFailurePrefix: string
  readonly fetchResource: HttpResourceFetcher
  readonly cache?: HttpResourceCacheMode
}): (uri: string) => Promise<Uint8Array> {
  const origin = requireHttpOrigin(options.originInput, options.originLabel)

  return async (uri: string): Promise<Uint8Array> => {
    const resourceURL = requireSameHttpOrigin(uri, origin, "CAM resource URI")
    // Redirects can cross authorities after the origin check. Keep redirect
    // refusal inside the shared loader so browser and tool callers cannot drift.
    const init = options.cache === undefined
      ? { redirect: "error" as const }
      : { cache: options.cache, redirect: "error" as const }
    const response = await options.fetchResource(resourceURL.href, init)
    if (response.ok !== true) {
      throw new Error(`${options.loadFailurePrefix} ${resourceURL.href}: HTTP ${response.status}`)
    }

    return readBoundedResponseBytes(response, resourceURL.href)
  }
}

export function responseContentLength(response: HttpResponse, uri: string): number | undefined {
  const value = response.headers.get("content-length")
  if (value === null) return undefined

  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`CAM resource has invalid Content-Length: ${uri}`)
  }

  const length = Number(value)
  // Content-Length is untrusted resource metadata. Reject values JavaScript
  // cannot represent exactly before applying byte-limit policy.
  if (!Number.isSafeInteger(length)) {
    throw new Error(`CAM resource has invalid Content-Length: ${uri}`)
  }

  return length
}

export function assertCamSecondaryResourceURI(uri: string, label: string): void {
  if (isLocalCamSecondaryResourceURI(uri) || isIpfsCamSecondaryResourceURI(uri)) return

  throw new Error(`${label}: CAM resource URI must be local ./... or ipfs://<CID>[...]: ${uri}`)
}

export function assertLoadableCamRootURI(uri: string, label: string): void {
  const url = requireAbsoluteURI(uri, label)
  rejectUriCredentials(url, label)

  // Runtime host loading must reject arbitrary schemes before handing the
  // contract-returned URI to a caller-supplied loader. Plain HTTP remains
  // loadable for local fixtures and pinned-origin dev servers; publication
  // tooling owns the stricter HTTPS/IPFS policy.
  if (url.protocol === "http:" || url.protocol === "https:") {
    requireHttpURL(uri, label)
    return
  }
  if (url.protocol === "ipfs:" && isIpfsCamSecondaryResourceURI(uri)) return

  throw new Error(`${label}: expected http://..., https://..., or ipfs://<CID>[...] CAM root URI`)
}

export function assertPublishedCamRootURI(uri: string, label: string): void {
  const url = requireAbsoluteURI(uri, label)
  rejectUriCredentials(url, label)

  // Publication roots are either HTTPS locations anchored by the published
  // CAM hash, or reviewable IPFS CIDs. Local roots stay a test/fixture concern.
  if (url.protocol === "https:") {
    requireHttpURL(uri, label)
    return
  }
  if (url.protocol === "ipfs:" && isIpfsCamSecondaryResourceURI(uri)) return

  throw new Error(`${label}: expected https://... or ipfs://<CID>[...] publication URI`)
}

export function resolveCamResourceURI(baseURI: string, resourceURI: string): string {
  assertURIString(baseURI, "baseURI")
  assertURIString(resourceURI, "resourceURI")

  // Resolution is separate from policy: CAM parsers decide which resource
  // references are valid, while loaders need a deterministic absolute key.
  if (SCHEME_RE.test(resourceURI)) {
    return resourceURI
  }

  if (resourceURI.startsWith("//")) {
    throw new Error("resourceURI: scheme-relative resource URIs are not allowed")
  }

  const baseWithoutFragment = stripFragment(baseURI)
  if (resourceURI.startsWith("#")) {
    return `${baseWithoutFragment}${resourceURI}`
  }

  const baseWithoutQuery = stripQuery(baseWithoutFragment)
  if (resourceURI.startsWith("?")) {
    return `${baseWithoutQuery}${resourceURI}`
  }

  const [resourcePath, resourceSuffix] = splitSuffix(resourceURI)
  const hierarchical = HIERARCHICAL_URI_RE.exec(baseWithoutQuery)
  if (hierarchical !== null) {
    const [, prefix, basePath] = hierarchical
    const baseDirectory = directoryOf(hierarchicalBasePath(basePath))
    const resolvedPath = normalizePath(resourcePath.startsWith("/") ? resourcePath : `${baseDirectory}${resourcePath}`)
    return `${prefix}${resolvedPath}${resourceSuffix}`
  }

  if (SCHEME_RE.test(baseURI)) {
    throw new Error("baseURI: base URI must be hierarchical to resolve relative resources")
  }

  const baseDirectory = directoryOf(baseWithoutQuery)
  const resolvedPath = normalizeRelativePath(
    resourcePath.startsWith("/") ? resourcePath : `${baseDirectory}${resourcePath}`,
    baseWithoutQuery,
  )
  return `${resolvedPath}${resourceSuffix}`
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

function assertURIString(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}: expected a non-empty URI string`)
  }
}

function requireAbsoluteURI(uri: string, label: string): URL {
  assertURIString(uri, label)
  try {
    return new URL(uri)
  } catch (cause) {
    throw new Error(`${label}: expected an absolute URI`, { cause })
  }
}

function rejectUriCredentials(url: URL, label: string): void {
  if (url.username !== "" || url.password !== "") {
    throw new Error(`${label}: credentials are not allowed`)
  }
}

function stripFragment(uri: string): string {
  return uri.split("#", 1)[0]
}

function stripQuery(uri: string): string {
  return uri.split("?", 1)[0]
}

function splitSuffix(uri: string): [string, string] {
  const queryIndex = uri.indexOf("?")
  const fragmentIndex = uri.indexOf("#")
  const suffixIndex = [queryIndex, fragmentIndex].filter((index) => index >= 0).sort((left, right) => left - right)[0]

  if (suffixIndex === undefined) {
    return [uri, ""]
  }

  return [uri.slice(0, suffixIndex), uri.slice(suffixIndex)]
}

function hierarchicalBasePath(basePath: string): string {
  if (basePath === "") {
    return "/"
  }

  return basePath
}

function directoryOf(path: string): string {
  if (path.length === 0 || path.endsWith("/")) {
    return path
  }

  const index = path.lastIndexOf("/")
  if (index < 0) {
    return ""
  }

  return path.slice(0, index + 1)
}

function normalizeRelativePath(path: string, basePath: string): string {
  const normalized = normalizePath(path)
  if (basePath.startsWith("./") && !normalized.startsWith(".") && !normalized.startsWith("/")) {
    return `./${normalized}`
  }

  return normalized
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/")
  const trailingSlash = path.endsWith("/")
  const parts: string[] = []

  for (const part of path.split("/")) {
    if (part === "" || part === ".") {
      continue
    }

    if (part === "..") {
      const previous = parts.at(-1)
      if (previous !== undefined && previous !== "..") {
        // Collapse ordinary parent references for deterministic URI strings.
        // This is not an access-control check; fetch policy belongs outside this resolver.
        parts.pop()
      } else if (!absolute) {
        parts.push(part)
      }
      continue
    }

    parts.push(part)
  }

  let normalized = `${absolute ? "/" : ""}${parts.join("/")}`
  if (normalized.length === 0) {
    normalized = absolute ? "/" : "."
  }

  if (trailingSlash && !normalized.endsWith("/")) {
    normalized = `${normalized}/`
  }

  return normalized
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
  if (codec === undefined || !isSupportedCidCodec(codec.value)) return false

  const hashCode = readVarint(bytes, codec.offset)
  if (hashCode === undefined || hashCode.value !== 0x12) return false

  const hashLength = readVarint(bytes, hashCode.offset)
  if (hashLength === undefined || hashLength.value !== 32) return false

  return bytes.length === hashLength.offset + Number(hashLength.value)
}

function isSupportedCidCodec(value: number): boolean {
  // Keep CAM resource CIDs to ordinary IPFS file/blob forms. Broader codecs can
  // be added deliberately when a real manifest needs them.
  return value === 0x55 || value === 0x70
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
  assertRawContentEncoding(response, uri)
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
      // A bounded stream reader must observe progress on every read. Empty
      // chunks can otherwise spin forever while never crossing the byte cap.
      if (!(value instanceof Uint8Array)) {
        throw new Error(`CAM resource stream returned a non-byte chunk: ${uri}`)
      }
      if (value.byteLength === 0) {
        throw new Error(`CAM resource stream returned an empty chunk: ${uri}`)
      }

      byteLength += value.byteLength
      if (contentLength !== undefined && byteLength > contentLength) {
        try {
          await reader.cancel?.()
        } catch {
          // Preserve the framing-policy failure; cancellation is cleanup.
        }
        throw new Error(`CAM resource exceeded Content-Length bytes: ${uri}`)
      }
      if (byteLength > maxBytes) {
        try {
          await reader.cancel?.()
        } catch {
          // Preserve the size-policy failure. Reader cancellation is cleanup,
          // not a more useful diagnostic for the caller.
        }
        throw new Error(`CAM resource is too large: ${uri}`)
      }
      chunks.push(value)
    }
  } finally {
    try {
      reader.releaseLock?.()
    } catch {
      // Lock release is best-effort cleanup for structural stream readers.
    }
  }
  if (contentLength !== undefined && byteLength !== contentLength) {
    throw new Error(`CAM resource ended before Content-Length bytes were read: ${uri}`)
  }

  const bytes = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

function assertRawContentEncoding(response: HttpResponse, uri: string): void {
  const value = response.headers.get("content-encoding")
  if (value !== null && value.trim().toLowerCase() !== "identity") {
    // CAM resources are byte-addressed: integrity, JSON decoding, and size
    // policy must operate on exactly the bytes the publisher committed.
    throw new Error(`CAM resource must not use HTTP content encoding: ${uri}`)
  }
}

function isStreamBody(value: unknown): value is { readonly getReader: () => HttpByteStreamReader } {
  return value !== null
    && typeof value === "object"
    && "getReader" in value
    && typeof value.getReader === "function"
}
