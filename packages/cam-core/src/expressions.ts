import { CamError } from "./errors.ts"
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

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveValue(item, context)]),
    )
  }

  return value
}

export function resolveArgs(args: readonly unknown[] | undefined, context: CamRuntimeContext): unknown[] {
  if (args === undefined) {
    return []
  }

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

  if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      validateExpressionValue(item, `${path}.${key}`)
    }
  }
}

function resolveValueAtPath(value: unknown, context: CamRuntimeContext, path: string): unknown {
  try {
    return resolveValue(value, context)
  } catch (error) {
    if (error instanceof CamError && error.path === undefined) {
      throw new CamError(error.code, error.message, path)
    }

    throw error
  }
}

function resolveString(value: string, context: CamRuntimeContext): unknown {
  if (!value.startsWith("$")) {
    return value
  }

  validateExpressionString(value)

  const segments = value.slice(1).split(".")
  const root = segments[0]
  if (!ALLOWED_ROOTS.has(root)) {
    throw new CamError("CAM_INVALID_EXPRESSION", `unknown expression root: ${root}`)
  }

  let current: unknown = context[root as keyof CamRuntimeContext]
  for (const segment of segments.slice(1)) {
    if (!isPlainObject(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
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
  if (!value.startsWith("$")) {
    return
  }

  if (!EXPRESSION_RE.test(value)) {
    throw new CamError("CAM_INVALID_EXPRESSION", `invalid expression syntax: ${value}`, path)
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
