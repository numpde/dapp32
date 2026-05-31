export function errorMessage(error: unknown): string {
  const chain = errorChain(error)
  const summary = errorSummary(chain[0] ?? error)
  const detail = errorDetail(chain)

  return detail === undefined || summary.includes(detail) ? summary : `${summary}: ${detail}`
}

function errorSummary(error: unknown): string {
  return readableErrorString(error, "shortMessage")
    ?? (error instanceof Error ? error.message : String(error))
}

function errorDetail(chain: readonly unknown[]): string | undefined {
  for (const item of chain) {
    const customError = errorCustomRevert(item)
    if (customError !== undefined) return customError
  }

  for (const item of chain.slice(1)) {
    const detail = readableErrorString(item, "reason")
      ?? readableErrorString(item, "details")
      ?? readableErrorString(item, "shortMessage")
    if (detail !== undefined) return detail
  }

  return undefined
}

function errorChain(error: unknown): readonly unknown[] {
  const chain: unknown[] = []
  for (let current: unknown = error; current !== undefined; current = errorCause(current)) {
    chain.push(current)
  }
  return chain
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
  return Array.isArray(args)
    ? `${errorName}(${args.map(formatErrorArgument).join(", ")})`
    : `${errorName}()`
}

function readableErrorString(error: unknown, key: string): string | undefined {
  const value = errorProperty(error, key)
  return typeof value === "string" && isReadableErrorText(value) ? value : undefined
}

function isReadableErrorText(value: string): boolean {
  const text = value.trim()
  return text.length > 0
    && text !== "[object Object]"
    && !/[\u0000-\u001F\u007F]/u.test(text)
}

function errorProperty(error: unknown, key: string): unknown {
  if (typeof error !== "object" || error === null || !(key in error)) {
    return undefined
  }

  return (error as Record<string, unknown>)[key]
}

function formatErrorArgument(value: unknown): string {
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "string") return JSON.stringify(value)
  if (typeof value === "number" || typeof value === "boolean" || value === null) return String(value)
  return JSON.stringify(value, (_, item: unknown) => typeof item === "bigint" ? item.toString() : item) ?? String(value)
}
