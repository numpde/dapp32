import { isRecordObject, parseJsonText, requireHttpURL, resolveCamResourceURI, resolveIpfsGatewayURL, toInertValue } from "@cam/protocol"
import type { HttpURL, InertRecord } from "@cam/protocol"

import { UserFacingError } from "./errors.ts"
import { readDataURI } from "./data-uri.ts"
import { RESOURCE_FETCH_OPTIONS, readAbortableBoundedBytes, withResourceDeadline } from "./resource-read.ts"

export const NFT_METADATA_MAX_BYTES = 256 * 1024
export const NFT_IMAGE_MAX_BYTES = 4 * 1024 * 1024
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])

export function parseNftMetadata(text: string): InertRecord {
  assertMetadataTextBounds(text)
  let value: unknown
  try {
    value = parseJsonText(text)
  } catch (cause) {
    throw new UserFacingError("Cannot read NFT metadata: use valid JSON without duplicate object keys.", { cause })
  }
  if (!isRecordObject(value)) throw new UserFacingError("Cannot read NFT metadata: the JSON root must be an object.")
  try {
    return toInertValue(value) as InertRecord
  } catch (cause) {
    throw new UserFacingError("Cannot read NFT metadata: all values must be finite JSON values.", { cause })
  }
}

export function nftMetadataDataURI(text: string): string {
  assertMetadataTextBounds(text)
  for (const character of text) {
    const code = character.charCodeAt(0)
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) {
      throw new UserFacingError("Cannot embed this JSON: it contains an invalid Unicode character. Correct it in the JSON editor.")
    }
  }
  const bytes = new TextEncoder().encode(text)
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return `data:application/json;base64,${btoa(binary)}`
}

export function editNftMetadataField(text: string, key: "name" | "description" | "image", value: string): string {
  const metadata = parseNftMetadata(text)
  // Prove that this editor's parse-and-serialize operation preserves every
  // original JSON token before allowing it to change one field.
  if (withoutJsonWhitespace(text) !== JSON.stringify(metadata)) {
    throw new UserFacingError("Cannot confirm this edit preserves the rest of the metadata. Edit the JSON directly instead; the original metadata is unchanged.")
  }
  const edited = JSON.stringify({ ...metadata, [key]: value })
  assertMetadataTextBounds(edited)
  return edited
}

function withoutJsonWhitespace(text: string): string {
  let result = ""
  let quoted = false
  let escaped = false
  for (const character of text) {
    if (quoted) {
      result += character
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') {
      quoted = true
      result += character
    } else if (character !== " " && character !== "\t" && character !== "\r" && character !== "\n") result += character
  }
  return result
}

export function readJsonDataURI(uri: string): string {
  const { bytes, type } = readDataURI(uri, NFT_METADATA_MAX_BYTES)
  if (type !== "application/json") throw new UserFacingError("Cannot read JSON data URI: the media type must be application/json.")
  return decodeMetadata(bytes)
}

export async function loadNftMetadata(uri: string, signal: AbortSignal, assertAllowed: (uri: string) => void, ipfsGatewayTemplate?: string): Promise<InertRecord> {
  signal.throwIfAborted()
  if (uri.startsWith("data:")) {
    return parseNftMetadata(readJsonDataURI(uri))
  }
  const url = nftHttpURL(uri, "NFT details", assertAllowed, undefined, ipfsGatewayTemplate)
  return withDeadline(signal, "NFT metadata", async activeSignal => {
    const response = await fetchReadable(url.href, activeSignal, "NFT metadata")
    const bytes = await readBytes(response, activeSignal, NFT_METADATA_MAX_BYTES, "NFT metadata")
    return parseNftMetadata(decodeMetadata(bytes))
  })
}

export function isRelativeNftImageURI(uri: string): boolean {
  return uri !== "" && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(uri)
}

export async function loadNftImage(uri: string, baseURI: string | undefined, signal: AbortSignal, assertAllowed: (uri: string) => void, ipfsGatewayTemplate?: string): Promise<Blob> {
  signal.throwIfAborted()
  if (uri.startsWith("data:")) {
    const { bytes, type } = readDataURI(uri, NFT_IMAGE_MAX_BYTES)
    assertImageType(type)
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type })
  }
  if (uri.length === 0 || /[\u0000-\u001f\u007f\\]/u.test(uri)) {
    throw new UserFacingError("Cannot load NFT image: use a nonempty image URL without control characters or backslashes.")
  }
  const relative = isRelativeNftImageURI(uri)
  if (relative) {
    if (baseURI === undefined || baseURI.startsWith("data:")) {
      throw new UserFacingError("Cannot load NFT image: a relative image URI needs an HTTP(S) or IPFS metadata URL. Use an absolute image URL.")
    }
  }
  const url = nftHttpURL(uri, "NFT image", assertAllowed, relative ? baseURI : undefined, ipfsGatewayTemplate)
  return withDeadline(signal, "NFT image", async activeSignal => {
    const response = await fetchReadable(url.href, activeSignal, "NFT image")
    const contentType = response.headers.get("content-type")
    if (contentType === null) {
      void response.body?.cancel().catch(() => {})
      throw new UserFacingError("Cannot load NFT image: the server did not supply a Content-Type header. Use a PNG, JPEG, WebP or GIF response with its image type declared.")
    }
    const type = contentType.split(";")[0]!.trim().toLowerCase()
    if (!IMAGE_TYPES.has(type)) {
      void response.body?.cancel().catch(() => {})
      assertImageType(type)
    }
    const bytes = await readBytes(response, activeSignal, NFT_IMAGE_MAX_BYTES, "NFT image")
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type })
  })
}

function nftHttpURL(uri: string, label: "NFT details" | "NFT image", assertAllowed: (uri: string) => void, baseURI?: string, ipfsGatewayTemplate?: string): HttpURL {
  try {
    const absolute = baseURI === undefined ? uri : baseURI.startsWith("ipfs://")
      ? resolveCamResourceURI(baseURI, uri) : new URL(uri, requireHttpURL(baseURI, "Metadata document URL").href).href
    assertAllowed(absolute)
    if (absolute.startsWith("ipfs://")) {
      if (ipfsGatewayTemplate === undefined) throw new Error("Choose an IPFS gateway to download this resource")
      return requireHttpURL(resolveIpfsGatewayURL(absolute, ipfsGatewayTemplate), `${label} gateway URL`)
    }
    return requireHttpURL(absolute, `${label} URL`)
  } catch (cause) {
    if (cause instanceof UserFacingError) throw cause
    throw new UserFacingError(`Cannot load ${label}. Enter a complete http://, https:// or ipfs:// address without a username or password; IPFS downloads need a selected gateway.`, { cause })
  }
}

function assertImageType(type: string): void {
  if (!IMAGE_TYPES.has(type)) throw new UserFacingError("Cannot load NFT image: choose a PNG, JPEG, WebP or GIF image. SVG and HTML are not displayed.")
}

function decodeMetadata(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch (cause) {
    throw new UserFacingError("Cannot read JSON: use valid UTF-8 text.", { cause })
  }
}

function assertMetadataTextBounds(text: string): void {
  if (text.length > NFT_METADATA_MAX_BYTES || new TextEncoder().encode(text).byteLength > NFT_METADATA_MAX_BYTES) {
    throw new UserFacingError("Cannot read NFT metadata: JSON exceeds the 256 KiB limit. Reduce the metadata size.")
  }
  // Bound nesting before the protocol duplicate-key parser and inert clone recurse.
  let depth = 0
  let quoted = false
  let escaped = false
  for (const character of text) {
    if (quoted) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') quoted = true
    else if (character === "{" || character === "[") {
      if (++depth > 32) throw new UserFacingError("Cannot read NFT metadata: JSON exceeds the nesting limit of 32. Reduce nested objects or arrays.")
    } else if (character === "}" || character === "]") depth--
  }
}

async function fetchReadable(uri: string, signal: AbortSignal, label: string): Promise<Response> {
  let response: Response
  try {
    response = await fetch(uri, { ...RESOURCE_FETCH_OPTIONS, signal })
  } catch (cause) {
    signal.throwIfAborted()
    throw new UserFacingError(`Cannot load ${label}: check connectivity, browser CORS access and redirects. Choose a directly readable URL.`, { cause })
  }
  if (!response.ok || response.type === "opaque" || response.body === null) {
    void response.body?.cancel().catch(() => {})
    throw new UserFacingError(`Cannot load ${label}: the server returned HTTP ${response.status} or no readable body. Choose a directly readable URL.`)
  }
  if (signal.aborted) {
    void response.body.cancel().catch(() => {})
    signal.throwIfAborted()
  }
  return response
}

async function readBytes(response: Response, signal: AbortSignal, maxBytes: number, label: string): Promise<Uint8Array> {
  try {
    return await readAbortableBoundedBytes(response.body!, signal, label, maxBytes)
  } catch (cause) {
    signal.throwIfAborted()
    if (cause instanceof Error && cause.message === `CAM resource is too large: ${label}`) {
      throw new UserFacingError(`Cannot load ${label}: content exceeds the ${maxBytes / 1024} KiB limit. Choose a smaller resource.`, { cause })
    }
    throw new UserFacingError(`Cannot read ${label} bytes. Retry or choose another resource.`, { cause })
  }
}

async function withDeadline<T>(signal: AbortSignal, label: string, acquire: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return withResourceDeadline(signal, new UserFacingError(`Cannot load ${label}: the request exceeded 15 seconds. Retry or choose another resource.`), () => signal.reason, acquire)
}
