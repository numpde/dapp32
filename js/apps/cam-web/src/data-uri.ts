import { UserFacingError } from "./errors.ts"

export function readDataURI(uri: string, maxBytes: number): { bytes: Uint8Array; type: string } {
  if (!/^data:/i.test(uri)) throw new UserFacingError("Cannot read data URI: the value must start with data:.")
  const comma = uri.indexOf(",")
  if (comma < 0 || comma > 100) throw new UserFacingError("Cannot read data URI: include a media type and comma before the encoded content.")
  const header = uri.slice(5, comma).toLowerCase()
  const parts = header.split(";")
  const type = parts.shift()!
  const base64 = parts.at(-1) === "base64"
  if (base64) parts.pop()
  if (parts.some(part => part !== "charset=utf-8")) throw new UserFacingError("Cannot read data URI: use UTF-8 text or base64 encoding.")
  const encoded = uri.slice(comma + 1)
  if (encoded.length > (base64 ? Math.ceil(maxBytes / 3) * 4 : maxBytes * 3)) {
    throw new UserFacingError(`Cannot read data URI: decoded content exceeds the ${maxBytes / 1024} KiB limit.`)
  }
  let bytes: Uint8Array
  try {
    if (base64) {
      if (encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) throw new Error("Malformed base64")
      bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
    } else {
      const decoded: number[] = []
      for (let index = 0; index < encoded.length;) {
        if (encoded[index] === "%") {
          const pair = encoded.slice(index + 1, index + 3)
          if (!/^[0-9a-fA-F]{2}$/.test(pair)) throw new Error("Malformed percent encoding")
          decoded.push(Number.parseInt(pair, 16))
          index += 3
        } else {
          const character = String.fromCodePoint(encoded.codePointAt(index)!)
          decoded.push(...new TextEncoder().encode(character))
          index += character.length
        }
        if (decoded.length > maxBytes) throw new Error("Decoded content is too large")
      }
      bytes = Uint8Array.from(decoded)
    }
  } catch (cause) {
    throw new UserFacingError("Cannot read data URI: content is malformed or exceeds the size limit. Use valid base64 or percent encoding.", { cause })
  }
  if (bytes.byteLength > maxBytes) throw new UserFacingError(`Cannot read data URI: decoded content exceeds the ${maxBytes / 1024} KiB limit.`)
  return { bytes, type }
}

export function textDataURI(text: string, type: "text/plain" | "application/json", maxBytes: number): string {
  if (text.length > maxBytes) throw new UserFacingError("Document is too large to embed.")
  let escaped: string
  try { escaped = encodeURIComponent(text) }
  catch (cause) { throw new UserFacingError("Cannot embed this document: correct the invalid Unicode text.", { cause }) }
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength > maxBytes) throw new UserFacingError("Document is too large to embed.")
  if (type === "application/json") {
    try { JSON.parse(text) }
    catch { throw new UserFacingError("Cannot embed JSON: correct the JSON syntax.") }
  }
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const mediaType = type === "text/plain" ? "text/plain;charset=utf-8" : type
  const percent = `data:${mediaType},${escaped}`
  const base64 = `data:${mediaType};base64,${btoa(binary)}`
  return percent.length <= base64.length ? percent : base64
}

export function readTextDataURI(uri: string, maxBytes: number): { text: string; type: "text/plain" | "application/json" } {
  const { bytes, type } = readDataURI(uri, maxBytes)
  if (type !== "text/plain" && type !== "application/json") throw new UserFacingError("Cannot edit this embedded document: only plain text and JSON are supported.")
  try { return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), type } }
  catch (cause) { throw new UserFacingError("Cannot edit this embedded document: it is not valid UTF-8 text.", { cause }) }
}
