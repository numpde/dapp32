import {
  createStringMap,
  hasOwn,
  isJsonScalar,
  isRecordObject,
  joinPath,
} from "./json.ts"

export type ExpressionErrorKind = "invalidField" | "invalidExpression" | "unresolvedValue"

export type ExpressionRuntimeOptions<T> = {
  readonly roots: ReadonlySet<string>
  readonly numericSegments: boolean
  readonly normalize: (value: unknown, path: string) => T
  readonly error: (kind: ExpressionErrorKind, message: string, path?: string) => Error
}

export type ExpressionRuntime<T> = {
  readonly validateString: (value: string, path?: string) => void
  readonly validateValue: (value: unknown, path: string) => void
  readonly parsePayload: (value: unknown, path: string) => T
  readonly resolveValue: (value: T, context: Record<string, unknown>, path: string) => T
}

const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*$/

export function createExpressionRuntime<T>(options: ExpressionRuntimeOptions<T>): ExpressionRuntime<T> {
  function validateString(value: string, path?: string): void {
    if (!value.startsWith("$")) {
      return
    }

    const segments = value.slice(1).split(".")
    const [root, ...pathSegments] = segments
    if (
      root === undefined ||
      !IDENTIFIER_RE.test(root) ||
      pathSegments.some((segment) => !isValidExpressionSegment(segment, options.numericSegments))
    ) {
      throw options.error("invalidExpression", `invalid expression syntax: ${value}`, path)
    }

    if (!options.roots.has(root)) {
      throw options.error("invalidExpression", `unknown expression root: ${root}`, path)
    }
  }

  function validateValue(value: unknown, path: string): void {
    if (typeof value === "string") {
      validateString(value, path)
      return
    }

    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index++) {
        const itemPath = joinPath(path, String(index))
        if (!(index in value)) {
          throw options.error("invalidField", "expected a JSON value", itemPath)
        }

        validateValue(value[index], itemPath)
      }
      return
    }

    if (isRecordObject(value)) {
      for (const [key, item] of Object.entries(value)) {
        validateValue(item, joinPath(path, key))
      }
      return
    }

    if (!isJsonScalar(value)) {
      throw options.error("invalidField", "expected a JSON value", path)
    }
  }

  function parsePayload(value: unknown, path: string): T {
    validateValue(value, path)
    return options.normalize(value, path)
  }

  function resolveValue(value: T, context: Record<string, unknown>, path: string): T {
    return options.normalize(resolveNode(value, context, path), path)
  }

  function resolveNode(value: unknown, context: Record<string, unknown>, path: string): unknown {
    if (typeof value === "string") {
      return resolveString(value, context, path)
    }

    if (Array.isArray(value)) {
      return value.map((item, index) => resolveNode(item, context, joinPath(path, String(index))))
    }

    if (isRecordObject(value)) {
      const resolved = createStringMap<unknown>()
      for (const [key, item] of Object.entries(value)) {
        resolved[key] = resolveNode(item, context, joinPath(path, key))
      }
      return resolved
    }

    return value
  }

  function resolveString(value: string, context: Record<string, unknown>, path: string): unknown {
    if (!value.startsWith("$")) {
      return value
    }

    validateString(value, path)

    const [root, ...segments] = value.slice(1).split(".")
    let current: unknown = root === undefined ? undefined : context[root]

    for (const segment of segments) {
      current = readExpressionSegment(current, segment)
      if (current === undefined) {
        throw options.error("unresolvedValue", `unresolved expression: ${value}`, path)
      }
    }

    if (current === undefined) {
      throw options.error("unresolvedValue", `unresolved expression: ${value}`, path)
    }

    return current
  }

  function readExpressionSegment(source: unknown, segment: string): unknown {
    if (options.numericSegments && Array.isArray(source) && isArrayIndex(segment)) {
      return source[Number(segment)]
    }

    if (isRecordObject(source) && hasOwn(source, segment)) {
      return source[segment]
    }

    return undefined
  }

  return {
    validateString,
    validateValue,
    parsePayload,
    resolveValue,
  }
}

function isValidExpressionSegment(segment: string, numericSegments: boolean): boolean {
  return IDENTIFIER_RE.test(segment) || (numericSegments && isArrayIndex(segment))
}

function isArrayIndex(value: string): boolean {
  return value === "0" || /^[1-9][0-9]*$/.test(value)
}
