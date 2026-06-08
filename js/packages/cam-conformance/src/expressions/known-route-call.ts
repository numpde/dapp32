import {
  isRecordObject,
} from "@cam/protocol"

import {
  expressionReference,
  staticString,
} from "./reference.ts"

export type KnownRouteCallValue = {
  readonly value: unknown
  readonly paths: ReadonlyMap<string, string>
  readonly pathSuffix: string
}

export type KnownInputValue = {
  readonly value: unknown
  readonly pathSuffix: string
}

export type KnownInputResolver = (segments: readonly string[]) => KnownInputValue | undefined

export function knownRouteCallValue(routeArg: unknown, resolveInput: KnownInputResolver): KnownRouteCallValue | undefined {
  return knownRouteCallValueAt(routeArg, resolveInput, "", "")
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
      return knownLiteralValue(staticString(routeArg), sourcePath, routePath)
    }
    if (reference.root !== "inputs") return undefined

    const input = resolveInput(reference.segments)
    if (input === undefined) return undefined

    return knownLiteralValue(input.value, input.pathSuffix, routePath)
  }

  if (routeArg === null || typeof routeArg === "boolean" || typeof routeArg === "number") {
    return knownLiteralValue(routeArg, sourcePath, routePath)
  }

  if (Array.isArray(routeArg)) {
    return knownArrayValue(routeArg, (item, index) => {
      return knownRouteCallValueAt(item, resolveInput, `${routePath}.${index}`, `${sourcePath}.${index}`)
    }, sourcePath)
  }

  if (!isRecordObject(routeArg)) return undefined

  return knownRecordValue(routeArg, (item, name) => {
    return knownRouteCallValueAt(item, resolveInput, `${routePath}.${name}`, `${sourcePath}.${name}`)
  }, sourcePath)
}

function knownLiteralValue(value: unknown, sourcePath: string, routePath: string): KnownRouteCallValue | undefined {
  if (typeof value === "string") {
    const staticValue = staticString(value)
    if (staticValue === undefined) return undefined
    return leafValue(staticValue, sourcePath, routePath)
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return leafValue(value, sourcePath, routePath)
  }

  if (Array.isArray(value)) {
    return knownArrayValue(value, (item, index) => {
      return knownLiteralValue(item, `${sourcePath}.${index}`, `${routePath}.${index}`)
    }, sourcePath)
  }

  if (!isRecordObject(value)) return undefined

  return knownRecordValue(value, (item, name) => {
    return knownLiteralValue(item, `${sourcePath}.${name}`, `${routePath}.${name}`)
  }, sourcePath)
}

function knownArrayValue(
  value: readonly unknown[],
  resolve: (item: unknown, index: number) => KnownRouteCallValue | undefined,
  pathSuffix: string,
): KnownRouteCallValue | undefined {
  const result: unknown[] = []
  const paths = new Map<string, string>()

  for (const [index, item] of value.entries()) {
    const itemValue = resolve(item, index)
    if (itemValue === undefined) return undefined
    result.push(itemValue.value)
    mergePaths(paths, itemValue.paths)
  }

  return { value: result, paths, pathSuffix }
}

function knownRecordValue(
  value: Record<string, unknown>,
  resolve: (item: unknown, name: string) => KnownRouteCallValue | undefined,
  pathSuffix: string,
): KnownRouteCallValue | undefined {
  const result: Record<string, unknown> = {}
  const paths = new Map<string, string>()

  for (const [name, item] of Object.entries(value)) {
    const itemValue = resolve(item, name)
    if (itemValue === undefined) return undefined
    result[name] = itemValue.value
    mergePaths(paths, itemValue.paths)
  }

  return { value: result, paths, pathSuffix }
}

function leafValue(value: unknown, sourcePath: string, routePath: string): KnownRouteCallValue {
  return {
    value,
    paths: new Map([[routePath, sourcePath]]),
    pathSuffix: sourcePath,
  }
}

function mergePaths(target: Map<string, string>, source: ReadonlyMap<string, string>): void {
  for (const [routePath, sourcePath] of source) {
    target.set(routePath, sourcePath)
  }
}
