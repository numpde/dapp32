import type { InertValue } from "@cam/protocol"

import { UiError } from "./errors.ts"

export function formatStatusValue(value: InertValue, format: InertValue, path: string): string {
  if (format === "stringList") {
    if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
      throw new UiError("UI_INVALID_FIELD", "Cannot display Status as a list: its value must be an array of strings.", `${path}.value`)
    }
    return value.length === 0 ? "None" : value.join(", ")
  }
  if (format !== "bytes" && format !== "durationSeconds") {
    throw new UiError("UI_INVALID_FIELD", "Cannot display Status: format must be bytes, durationSeconds, or stringList.", `${path}.format`)
  }
  if (!(typeof value === "string" && /^\d+$/.test(value))
    && !(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
    throw new UiError("UI_INVALID_FIELD", "Cannot display Status with units: its value must be a non-negative decimal integer string or safe integer.", `${path}.value`)
  }
  const amount = BigInt(value as string | number)
  if (format === "bytes") return `${groupedInteger(amount)} ${amount === 1n ? "byte" : "bytes"}`
  if (amount < 60n) return `${amount} ${amount === 1n ? "second" : "seconds"}`

  let remainder = amount
  const parts: string[] = []
  for (const [seconds, unit] of [[86400n, "day"], [3600n, "hour"], [60n, "minute"], [1n, "second"]] as const) {
    const count = remainder / seconds
    remainder %= seconds
    if (count > 0n) parts.push(`${groupedInteger(count)} ${unit}${count === 1n ? "" : "s"}`)
  }
  return `${parts.join(", ")} (${groupedInteger(amount)} seconds)`
}

function groupedInteger(value: bigint): string {
  const digits = value.toString()
  const firstGroupLength = ((digits.length - 1) % 3) + 1
  const groups = [digits.slice(0, firstGroupLength)]
  for (let offset = firstGroupLength; offset < digits.length; offset += 3) {
    groups.push(digits.slice(offset, offset + 3))
  }
  return groups.join(",")
}
