import { isAbiBytesValue } from "@cam/protocol"
import type { InertRecord } from "@cam/protocol"

// The resolved declaration owns these limits; editing never rewrites the value.
export function textFieldIssue(value: string, props: InertRecord): string | undefined {
  const min = typeof props.minBytes === "string" ? BigInt(props.minBytes) : undefined
  const max = typeof props.maxBytes === "string" ? BigInt(props.maxBytes) : undefined
  const bytes = props.format === "hex" && typeof props.byteLength === "number" ? props.byteLength : undefined
  if (bytes !== undefined) return isAbiBytesValue(value, bytes) ? undefined : `Enter 0x followed by ${bytes * 2} hexadecimal characters.`
  if (min === undefined && max === undefined) return undefined
  if (max !== undefined && BigInt(value.length) > max) return `Enter no more than ${max} UTF-8 bytes.`
  let length = 0n
  for (const character of value) {
    const point = character.codePointAt(0)!
    length += point <= 0x7f ? 1n : point <= 0x7ff ? 2n : point <= 0xffff ? 3n : 4n
    if (max !== undefined && length > max) return `Enter no more than ${max} UTF-8 bytes.`
    if (min === 1n && max === undefined) break
  }
  if (min !== undefined && length < min) return `Enter at least ${min} UTF-8 ${min === 1n ? "byte" : "bytes"}.`
  return undefined
}
