const MAX_ERROR_TEXT_LENGTH = 500
const MAX_ERROR_MESSAGE_LENGTH = 2_000
const MAX_ERROR_CAUSES = 32

export function viewerErrorMessage(error: unknown, options?: { readonly includeStack?: boolean }): string {
  const parts: string[] = []
  const stacks: string[] = []
  const seen = new Set<object>()
  let current = error
  for (let depth = 0; current !== undefined && depth < MAX_ERROR_CAUSES; depth += 1) {
    if (typeof current === "object" && current !== null) {
      if (seen.has(current)) break
      seen.add(current)
    }
    if (typeof current !== "object" && typeof current !== "function") {
      appendDiagnostic(parts, diagnosticText(safeString(current, "unprintable error")))
    }
    const shortMessage = readableErrorString(current, "shortMessage")
    appendDiagnostic(parts, shortMessage === undefined ? readableErrorString(current, "message") : shortMessage)
    appendDiagnostic(parts, errorCustomRevert(current))
    appendDiagnostic(parts, readableErrorString(current, "reason"))
    appendDiagnostic(parts, readableErrorString(current, "details"))
    if (options?.includeStack === true) appendDiagnostic(stacks, errorStackTail(current))
    current = errorCause(current)
    if (depth === MAX_ERROR_CAUSES - 1 && current !== undefined) appendDiagnostic(parts, "Cause chain truncated.")
  }
  let diagnostic = parts.join(": ")
  if (parts.length === 0) {
    const fallback = diagnosticText(safeString(error, "unprintable error"))
    diagnostic = fallback.trim().length === 0 ? "The error did not include a readable message." : fallback
  }
  const message = stacks.length === 0 ? diagnostic : `${diagnostic}\nStack:\n${stacks.join("\n")}`
  return message.length <= MAX_ERROR_MESSAGE_LENGTH ? message : `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...`
}

function appendDiagnostic(parts: string[], text: string | undefined): void {
  if (text !== undefined && text.trim().length > 0 && !parts.some(part => part.includes(text))) parts.push(text)
}

function diagnosticText(value: string): string {
  return escapeDiagnosticText(redactDiagnosticText(value))
}

function redactDiagnosticText(value: string): string {
  return value
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/?#]*@/giu, "$1[redacted]@")
    .replace(/([?&])([^=&#\s]+)=([^&#\s]*)/gu, (field, separator: string, key: string) => {
      const decodedKey = new URLSearchParams(`${key}=`).keys().next().value
      return typeof decodedKey === "string" && /^(?:token|access_token|api[_-]?key|password|secret)$/iu.test(decodedKey)
        ? `${separator}${key}=[redacted]`
        : field
    })
    .replace(/(authorization\s*:\s*(?:bearer|basic)\s+)[^\s]+/giu, "$1[redacted]")
}

function escapeDiagnosticText(value: string): string {
  const escaped = value.replace(/[\u0000-\u001f\u007f]/gu, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`)
  if (escaped.trim().length === 0) return ""
  return escaped.length <= MAX_ERROR_TEXT_LENGTH ? escaped : `${escaped.slice(0, MAX_ERROR_TEXT_LENGTH)}...`
}

function errorStackTail(error: unknown): string | undefined {
  const name = errorProperty(error, "name")
  const message = errorProperty(error, "message")
  const stack = errorProperty(error, "stack")
  if (typeof name !== "string" || typeof message !== "string" || typeof stack !== "string") return undefined
  const prefix = `${name}: ${message}\n`
  if (!stack.startsWith(prefix)) return undefined
  const frames = redactDiagnosticText(stack.slice(prefix.length)).split("\n").filter(line => /^ +at /.test(line))
  if (frames.length === 0) return undefined
  const tail = frames.map(escapeDiagnosticText).join("\n")
  return tail.length <= MAX_ERROR_TEXT_LENGTH ? tail : `${tail.slice(0, MAX_ERROR_TEXT_LENGTH)}...`
}

function errorCause(error: unknown): unknown {
  const cause = errorProperty(error, "cause")
  return cause === null ? undefined : cause
}

function errorCustomRevert(error: unknown): string | undefined {
  const data = errorProperty(error, "data")
  const errorName = readableErrorString(data, "errorName")
  if (errorName === undefined) return undefined

  const args = errorProperty(data, "args")
  let argumentsText = ""
  try {
    if (Array.isArray(args)) argumentsText = Array.prototype.map.call(args, formatErrorArgument).join(", ")
  } catch {
    argumentsText = "unprintable arguments"
  }
  return diagnosticText(`${errorName}(${argumentsText})`)
}

function readableErrorString(error: unknown, key: string): string | undefined {
  const value = errorProperty(error, key)
  return typeof value === "string" && value.trim().length > 0 ? diagnosticText(value) : undefined
}

function errorProperty(error: unknown, key: string): unknown {
  if (typeof error !== "object" || error === null) {
    return undefined
  }

  let value: unknown
  try {
    if (key in error) {
      value = (error as Record<string, unknown>)[key]
    }
  } catch {
    // Wallet/RPC providers can surface arbitrary objects. Error rendering must
    // never replace the original failure with a getter/proxy diagnostic.
  }
  return value
}

function formatErrorArgument(value: unknown): string {
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "string") return diagnosticText(JSON.stringify(value))
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value)
  try {
    const json = JSON.stringify(value, (_, item: unknown) => typeof item === "bigint" ? item.toString() : item)
    if (json !== undefined) {
      return diagnosticText(json)
    }
  } catch {
    // Keep custom error names useful even when provider-supplied args are
    // cyclic or otherwise not JSON-serializable.
  }

  return diagnosticText(safeString(value, "unprintable value"))
}

function safeString(value: unknown, fallback: string): string {
  try {
    return String(value)
  } catch {
    return fallback
  }
}
