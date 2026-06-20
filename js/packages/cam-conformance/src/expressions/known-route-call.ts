import {
  isRecordObject,
} from "@cam/protocol"

import {
  expressionReference,
  staticString,
} from "./reference.ts"

export type KnownRouteCallValue = {
  readonly value: unknown
  readonly source: KnownRouteCallSource
  readonly paths: ReadonlyMap<string, KnownRouteCallSource>
}

export type KnownStaticStringValue = {
  readonly type: "static-string"
  readonly value: string
}

export type KnownRouteCallSource = {
  readonly owner: "input" | "route"
  readonly pathSuffix: string
}

type KnownInputValue = {
  readonly value: unknown
  readonly pathSuffix: string
}

export const UNKNOWN_ROUTE_CALL_VALUE: unique symbol = Symbol("CAM_CONFORMANCE_UNKNOWN_ROUTE_CALL_VALUE")

type KnownInputResolver = (segments: readonly string[]) => KnownInputValue | undefined

export function knownRouteCallValue(routeArg: unknown, resolveInput: KnownInputResolver): KnownRouteCallValue | undefined {
  return knownRouteCallValueAt(routeArg, resolveInput, "", "")
}

export function knownRouteCallPathSuffix(segments: readonly string[]): string {
  return segments.map((segment) => `.${segment}`).join("")
}

export function knownRouteCallSource(value: KnownRouteCallValue, pathSuffix: string): KnownRouteCallSource {
  const source = value.paths.get(pathSuffix)
  return source === undefined
    ? { owner: value.source.owner, pathSuffix: `${value.source.pathSuffix}${pathSuffix}` }
    : source
}

function knownRouteCallValueAt(
  routeArg: unknown,
  resolveInput: KnownInputResolver,
  routePath: string,
  sourcePath: string,
): KnownRouteCallValue | undefined {
  if (typeof routeArg === "string") {
    const reference = expressionReference(routeArg)
    if (reference === undefined) {
      return knownLiteralValue(knownStaticStringValue(routeArg), { owner: "route", pathSuffix: sourcePath }, routePath)
    }
    if (reference.root !== "inputs") return undefined

    const input = resolveInput(reference.segments)
    if (input === undefined) return undefined

    return knownLiteralValue(input.value, { owner: "input", pathSuffix: input.pathSuffix }, routePath)
  }

  if (routeArg === null || typeof routeArg === "boolean" || typeof routeArg === "number") {
    return knownLiteralValue(routeArg, { owner: "route", pathSuffix: sourcePath }, routePath)
  }

  if (Array.isArray(routeArg)) {
    return knownArrayValue(routeArg, (item, index) => {
      return knownRouteCallValueAt(item, resolveInput, `${routePath}.${index}`, `${sourcePath}.${index}`)
    }, { owner: "route", pathSuffix: sourcePath })
  }

  if (!isRecordObject(routeArg)) return undefined

  return knownRecordValue(routeArg, (item, name) => {
    return knownRouteCallValueAt(item, resolveInput, `${routePath}.${name}`, `${sourcePath}.${name}`)
  }, { owner: "route", pathSuffix: sourcePath })
}

function knownLiteralValue(
  value: unknown,
  source: KnownRouteCallSource,
  routePath: string,
): KnownRouteCallValue | undefined {
  if (typeof value === "string") {
    const staticValue = knownStaticStringValue(value)
    return leafValue(staticValue === undefined ? value : staticValue, source, routePath)
  }

  if (value === UNKNOWN_ROUTE_CALL_VALUE || isKnownStaticStringValue(value)) {
    return leafValue(value, source, routePath)
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return leafValue(value, source, routePath)
  }

  if (Array.isArray(value)) {
    return knownArrayValue(value, (item, index) => {
      return knownLiteralValue(item, { owner: source.owner, pathSuffix: `${source.pathSuffix}.${index}` }, `${routePath}.${index}`)
    }, source)
  }

  if (!isRecordObject(value)) return undefined

  return knownRecordValue(value, (item, name) => {
    return knownLiteralValue(item, { owner: source.owner, pathSuffix: `${source.pathSuffix}.${name}` }, `${routePath}.${name}`)
  }, source)
}

function knownArrayValue(
  value: readonly unknown[],
  resolve: (item: unknown, index: number) => KnownRouteCallValue | undefined,
  source: KnownRouteCallSource,
): KnownRouteCallValue | undefined {
  const result: unknown[] = []
  const paths = new Map<string, KnownRouteCallSource>()

  for (const [index, item] of value.entries()) {
    const itemValue = resolve(item, index)
    result.push(itemValue === undefined ? UNKNOWN_ROUTE_CALL_VALUE : itemValue.value)
    if (itemValue !== undefined) mergePaths(paths, itemValue.paths)
  }

  return { value: result, source, paths }
}

function knownRecordValue(
  value: Record<string, unknown>,
  resolve: (item: unknown, name: string) => KnownRouteCallValue | undefined,
  source: KnownRouteCallSource,
): KnownRouteCallValue | undefined {
  const result: Record<string, unknown> = {}
  const paths = new Map<string, KnownRouteCallSource>()

  for (const [name, item] of Object.entries(value)) {
    const itemValue = resolve(item, name)
    result[name] = itemValue === undefined ? UNKNOWN_ROUTE_CALL_VALUE : itemValue.value
    if (itemValue !== undefined) mergePaths(paths, itemValue.paths)
  }

  return { value: result, source, paths }
}

function leafValue(value: unknown, source: KnownRouteCallSource, routePath: string): KnownRouteCallValue {
  return {
    value,
    source,
    paths: new Map([[routePath, source]]),
  }
}

export function isKnownStaticStringValue(value: unknown): value is KnownStaticStringValue {
  return isRecordObject(value) && value.type === "static-string" && typeof value.value === "string"
}

export function knownStaticStringContent(value: string | KnownStaticStringValue): string {
  return typeof value === "string" ? value : value.value
}

export function knownStaticStringValue(value: string): string | KnownStaticStringValue | undefined {
  const result = staticString(value)
  if (result === undefined) return undefined
  return result.startsWith("$") ? { type: "static-string", value: result } : result
}

function mergePaths(target: Map<string, KnownRouteCallSource>, source: ReadonlyMap<string, KnownRouteCallSource>): void {
  for (const [routePath, sourcePath] of source) {
    target.set(routePath, sourcePath)
  }
}
