export const CAM_RESOURCE_MAX_BYTES = 2 * 1024 * 1024

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
  readonly headers: {
    readonly get: (name: string) => string | null
  }
  readonly arrayBuffer: () => Promise<ArrayBuffer>
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

export async function readBoundedResponseBytes(
  response: HttpResponse,
  uri: string,
  maxBytes = CAM_RESOURCE_MAX_BYTES,
): Promise<Uint8Array> {
  const contentLength = responseContentLength(response, uri)
  if (contentLength !== undefined && contentLength > maxBytes) {
    throw new Error(`CAM resource is too large: ${uri}`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) {
    throw new Error(`CAM resource is too large: ${uri}`)
  }

  return bytes
}
