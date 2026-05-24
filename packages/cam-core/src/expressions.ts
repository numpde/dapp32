import { CamError } from "./errors.ts"
import { hasOwn, isRecordObject } from "./guards.ts"
import type { CamRuntimeContext } from "./types.ts"

const EXPRESSION_RE = /^\$[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)*$/
const ALLOWED_ROOTS = new Set(["host", "account", "params", "state", "outputs"])

export function resolveValue(value: unknown, context: CamRuntimeContext): unknown {
  if (typeof value === "string") {
    return resolveString(value, context)
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, context))
  }

  if (isRecordObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveValue(item, context)]),
    )
  }

  return value
}

export function resolveArgs(args: readonly unknown[], context: CamRuntimeContext): unknown[] {
  return args.map((arg, index) => resolveValueAtPath(arg, context, `args.${index}`))
}

export function validateExpressionValue(value: unknown, path: string): void {
  if (typeof value === "string") {
    validateExpressionString(value, path)
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateExpressionValue(item, `${path}.${index}`))
    return
  }

  if (isRecordObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      validateExpressionValue(item, `${path}.${key}`)
    }
    return
  }

  validateJsonLiteral(value, path)
}

function validateJsonLiteral(value: unknown, path: string): void {
  // CAM manifests may be supplied as already-parsed objects, so reject values
  // that JSON itself could not carry. That keeps route args portable across
  // file loading, IPFS, HTTP, tests, and programmatic construction.
  if (value === null || typeof value === "boolean") {
    return
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return
  }

  throw new CamError("CAM_INVALID_FIELD", "expected a JSON value", path)
}

function resolveValueAtPath(value: unknown, context: CamRuntimeContext, path: string): unknown {
  try {
    return resolveValue(value, context)
  } catch (error) {
    // Add the argument path only when a deeper resolver has not already
    // supplied one. This keeps error locations useful without overwriting them.
    if (error instanceof CamError && error.path === undefined) {
      throw new CamError(error.code, error.message, path)
    }

    throw error
  }
}

function resolveString(value: string, context: CamRuntimeContext): unknown {
  // Only the exact $root.path grammar is an expression. Other strings remain
  // literals so CAM V1 does not grow implicit templating or interpolation.
  if (!value.startsWith("$")) {
    return value
  }

  validateExpressionString(value)

  const segments = value.slice(1).split(".")
  const root = segments[0]

  let current: unknown = context[root as keyof CamRuntimeContext]
  for (const segment of segments.slice(1)) {
    if (!isRecordObject(current) || !hasOwn(current, segment)) {
      throw new CamError("CAM_UNRESOLVED_VALUE", `unresolved expression: ${value}`)
    }

    current = current[segment]
  }

  if (current === undefined) {
    throw new CamError("CAM_UNRESOLVED_VALUE", `unresolved expression: ${value}`)
  }

  return current
}

function validateExpressionString(value: string, path?: string): void {
  // A leading "$" opts into expression parsing. Malformed expressions fail
  // instead of falling back to string literals.
  if (!value.startsWith("$")) {
    return
  }

  if (!EXPRESSION_RE.test(value)) {
    throw new CamError("CAM_INVALID_EXPRESSION", `invalid expression syntax: ${value}`, path)
  }

  const root = value.slice(1).split(".", 1)[0]
  if (!ALLOWED_ROOTS.has(root)) {
    throw new CamError("CAM_INVALID_EXPRESSION", `unknown expression root: ${root}`, path)
  }
}
