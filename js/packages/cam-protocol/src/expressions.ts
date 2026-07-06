import {
  createStringMap,
  hasOwn,
  isNonStringJsonScalar,
  isRecordObject,
  joinPath,
} from "./json.ts"

export type ExpressionErrorKind = "invalidField" | "invalidExpression" | "unresolvedValue"
export type ExpressionErrorDetails = {
  readonly expression?: string
  readonly root?: string
}

export type ExpressionRuntimeOptions<T> = {
  readonly roots: ReadonlySet<string>
  readonly numericSegments: boolean
  readonly normalize: (value: unknown, path: string) => T
  readonly error: (kind: ExpressionErrorKind, message: string, path?: string, details?: ExpressionErrorDetails) => Error
}

export type ExpressionRuntime<T> = {
  readonly validateString: (value: string, path?: string) => void
  readonly validateValue: (value: unknown, path: string) => void
  readonly parsePayload: (value: unknown, path: string) => T
  readonly resolveValue: (value: T, context: object, path: string) => T
}

export type ExpressionReference = {
  readonly root: string
  readonly segments: readonly string[]
}

export type ExpressionReferenceOccurrence = {
  readonly path: string
  readonly value: string
  readonly reference?: ExpressionReference
  readonly syntaxError?: string
}

export type ExpressionReferenceOptions = {
  readonly numericSegments: boolean
}

const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*$/

export function isExpressionIdentifier(value: string): boolean {
  return IDENTIFIER_RE.test(value)
}

export function isExpressionReferenceString(value: string): boolean {
  return value.startsWith("$") && !value.startsWith("$$")
}

export function isExpressionArrayIndex(value: string): boolean {
  if (value !== "0" && !/^[1-9][0-9]*$/.test(value)) return false

  // Expression walkers use JS arrays, so accepted indexes must survive
  // string-to-Number conversion without rounding to a different slot.
  return Number.isSafeInteger(Number(value))
}

// A doubled leading dollar is the protocol escape for literal strings that
// would otherwise be parsed as expression references.
export function parseStaticExpressionString(value: string): string | undefined {
  if (isExpressionReferenceString(value)) return undefined
  return value.startsWith("$$") ? value.slice(1) : value
}

// Keep expression grammar in protocol so runtime validators and static
// conformance do not fork on escaping or numeric path segment semantics.
export function parseExpressionReference(
  value: string,
  options: ExpressionReferenceOptions,
): ExpressionReference | undefined {
  if (!isExpressionReferenceString(value)) return undefined

  const [root, ...segments] = value.slice(1).split(".")
  if (
    root === undefined
    || !isExpressionIdentifier(root)
    || segments.some((segment) => !isValidExpressionSegment(segment, options.numericSegments))
  ) {
    return undefined
  }

  return { root, segments }
}

export function expressionReferenceSyntaxError(
  value: string,
  options: ExpressionReferenceOptions,
): string | undefined {
  if (!isExpressionReferenceString(value)) return undefined
  if (parseExpressionReference(value, options) !== undefined) return undefined

  return invalidExpressionSyntaxMessage(value)
}

export function collectExpressionReferences(
  value: unknown,
  options: ExpressionReferenceOptions,
  path = "",
): readonly ExpressionReferenceOccurrence[] {
  const occurrences: ExpressionReferenceOccurrence[] = []
  collectExpressionReferencesInto(value, options, path, occurrences, new WeakSet<object>())
  return occurrences
}

export function createExpressionRuntime<T>(options: ExpressionRuntimeOptions<T>): ExpressionRuntime<T> {
  function checkedExpressionReference(value: string, path?: string): ExpressionReference {
    const reference = parseExpressionReference(value, options)
    if (reference === undefined) {
      throw options.error("invalidExpression", invalidExpressionSyntaxMessage(value), path)
    }

    if (!options.roots.has(reference.root)) {
      throw options.error("invalidExpression", `unknown expression root: ${reference.root}`, path)
    }

    return reference
  }

  function validateString(value: string, path?: string): void {
    if (!isExpressionReferenceString(value)) return
    checkedExpressionReference(value, path)
  }

  function validateValue(value: unknown, path: string, ancestors = new WeakSet<object>()): void {
    if (typeof value === "string") {
      validateString(value, path)
      return
    }

    if (Array.isArray(value)) {
      if (ancestors.has(value)) {
        throw options.error("invalidField", "expected a JSON value", path)
      }
      ancestors.add(value)
      for (let index = 0; index < value.length; index++) {
        const itemPath = joinPath(path, String(index))
        if (!(index in value)) {
          throw options.error("invalidField", "expected a JSON value", itemPath)
        }

        validateValue(value[index], itemPath, ancestors)
      }
      ancestors.delete(value)
      return
    }

    if (isRecordObject(value)) {
      if (ancestors.has(value)) {
        throw options.error("invalidField", "expected a JSON value", path)
      }
      ancestors.add(value)
      for (const [key, item] of Object.entries(value)) {
        validateValue(item, joinPath(path, key), ancestors)
      }
      ancestors.delete(value)
      return
    }

    if (!isNonStringJsonScalar(value)) {
      throw options.error("invalidField", "expected a JSON value", path)
    }
  }

  function parsePayload(value: unknown, path: string): T {
    validateValue(value, path)
    return options.normalize(value, path)
  }

  function resolveValue(value: T, context: object, path: string): T {
    return options.normalize(resolveNode(value, context, path, new WeakSet<object>()), path)
  }

  function resolveNode(value: unknown, context: object, path: string, ancestors: WeakSet<object>): unknown {
    if (typeof value === "string") {
      return resolveString(value, context, path)
    }

    if (Array.isArray(value)) {
      if (ancestors.has(value)) {
        throw options.error("invalidField", "expected a JSON value", path)
      }
      ancestors.add(value)
      const resolved = value.map((item, index) => resolveNode(item, context, joinPath(path, String(index)), ancestors))
      ancestors.delete(value)
      return resolved
    }

    if (isRecordObject(value)) {
      if (ancestors.has(value)) {
        throw options.error("invalidField", "expected a JSON value", path)
      }
      ancestors.add(value)
      const resolved = createStringMap<unknown>()
      for (const [key, item] of Object.entries(value)) {
        resolved[key] = resolveNode(item, context, joinPath(path, key), ancestors)
      }
      ancestors.delete(value)
      return resolved
    }

    return value
  }

  function resolveString(value: string, context: object, path: string): unknown {
    const staticValue = parseStaticExpressionString(value)
    if (staticValue !== undefined) return staticValue

    const reference = checkedExpressionReference(value, path)
    let current: unknown = readExpressionSegment(context, reference.root)

    for (const segment of reference.segments) {
      current = readExpressionSegment(current, segment)
      if (current === undefined) {
        throw options.error("unresolvedValue", `unresolved expression: ${value}`, path, { expression: value, root: reference.root })
      }
    }

    if (current === undefined) {
      throw options.error("unresolvedValue", `unresolved expression: ${value}`, path, { expression: value, root: reference.root })
    }

    return current
  }

  function readExpressionSegment(source: unknown, segment: string): unknown {
    if (options.numericSegments && Array.isArray(source) && isExpressionArrayIndex(segment)) {
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

function collectExpressionReferencesInto(
  value: unknown,
  options: ExpressionReferenceOptions,
  path: string,
  occurrences: ExpressionReferenceOccurrence[],
  ancestors: WeakSet<object>,
): void {
  if (typeof value === "string") {
    if (!isExpressionReferenceString(value)) return

    const reference = parseExpressionReference(value, options)
    occurrences.push(reference === undefined
      ? { path, value, syntaxError: invalidExpressionSyntaxMessage(value) }
      : { path, value, reference })
    return
  }

  if (Array.isArray(value)) {
    if (ancestors.has(value)) return
    ancestors.add(value)
    for (let index = 0; index < value.length; index++) {
      if (index in value) {
        collectExpressionReferencesInto(value[index], options, joinPath(path, String(index)), occurrences, ancestors)
      }
    }
    ancestors.delete(value)
    return
  }

  if (isRecordObject(value)) {
    if (ancestors.has(value)) return
    ancestors.add(value)
    for (const [key, item] of Object.entries(value)) {
      collectExpressionReferencesInto(item, options, joinPath(path, key), occurrences, ancestors)
    }
    ancestors.delete(value)
  }
}

function isValidExpressionSegment(segment: string, numericSegments: boolean): boolean {
  return isExpressionIdentifier(segment) || (numericSegments && isExpressionArrayIndex(segment))
}

function invalidExpressionSyntaxMessage(value: string): string {
  return `invalid expression syntax: ${value}`
}
