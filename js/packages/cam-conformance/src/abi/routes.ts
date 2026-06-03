import {
  isRecordObject,
  parseJsonBytes,
} from "@cam/protocol"

import type {
  CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredRoute,
} from "../manifest/routes.ts"
import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"

type AbiFunction = {
  readonly name: string
  readonly stateMutability: "pure" | "view" | "nonpayable" | "payable"
  readonly inputNames: readonly string[]
  readonly outputs: readonly unknown[]
}

export function validateRouteAbiCompatibility({
  resource,
  resources,
  declarations,
  routes,
  issues,
}: {
  readonly resource: string
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly routes: readonly DeclaredRoute[]
  readonly issues: CamConformanceIssue[]
}): void {
  const functionsByNamespace = contractFunctionsByNamespace(resources, declarations, issues)
  for (const route of routes) {
    validateRouteCallAbi(resource, route, functionsByNamespace, issues)
  }
}

function contractFunctionsByNamespace(
  resources: ReadonlyMap<string, Uint8Array>,
  declarations: readonly ResourceDeclaration[],
  issues: CamConformanceIssue[],
): ReadonlyMap<string, ReadonlyMap<string, readonly AbiFunction[]>> {
  const result = new Map<string, ReadonlyMap<string, readonly AbiFunction[]>>()
  for (const declaration of declarations) {
    if (declaration.namespaceType !== "contract") continue

    const bytes = resources.get(declaration.uri)
    if (bytes === undefined) continue

    const functions = parseAbiFunctions(declaration.uri, bytes, issues)
    if (functions !== null) {
      result.set(declaration.namespace, functionsByName(functions))
    }
  }

  return result
}

function validateRouteCallAbi(
  resource: string,
  route: DeclaredRoute,
  functionsByNamespace: ReadonlyMap<string, ReadonlyMap<string, readonly AbiFunction[]>>,
  issues: CamConformanceIssue[],
): void {
  const path = `routes.${route.name}.call`
  const functions = functionsByNamespace.get(route.call.namespace)
  if (functions === undefined) return

  const matches = functions.get(route.call.function)
  if (matches === undefined) {
    issues.push(routeAbiIssue(resource, path, `route function not found in ABI: ${route.call.function}`))
    return
  }
  if (matches.length > 1) {
    issues.push(routeAbiIssue(resource, `${path}.function`, `route function is overloaded and not supported: ${route.call.function}`))
    return
  }

  const fn = matches[0]
  validateRouteMutability(resource, route, fn, issues)
  validateRouteArgs(resource, route, fn, issues)
  validateRouteOutputRefs(resource, route, fn, issues)
}

function validateRouteMutability(
  resource: string,
  route: DeclaredRoute,
  fn: AbiFunction,
  issues: CamConformanceIssue[],
): void {
  const path = `routes.${route.name}.call.function`
  if (route.kind === "read" && fn.stateMutability !== "view" && fn.stateMutability !== "pure") {
    issues.push(routeAbiIssue(resource, path, `read route function must be view or pure: ${fn.name}`))
  }
  if (route.kind === "write" && fn.stateMutability !== "nonpayable") {
    issues.push(routeAbiIssue(resource, path, `write route function must be nonpayable: ${fn.name}`))
  }
}

function validateRouteArgs(resource: string, route: DeclaredRoute, fn: AbiFunction, issues: CamConformanceIssue[]): void {
  const expected = new Set(fn.inputNames)
  const actual = new Set(Object.keys(route.call.args))

  for (const name of actual) {
    if (!expected.has(name)) {
      issues.push(routeAbiIssue(resource, `routes.${route.name}.call.args.${name}`, `unexpected route argument: ${name}`))
    }
  }

  for (const name of expected) {
    if (!actual.has(name)) {
      issues.push(routeAbiIssue(resource, `routes.${route.name}.call.args.${name}`, `missing route argument: ${name}`))
    }
  }
}

function validateRouteOutputRefs(resource: string, route: DeclaredRoute, fn: AbiFunction, issues: CamConformanceIssue[]): void {
  // This is intentionally reference-driven. The runtime ABI parser owns full ABI
  // validity; conformance only needs to prove route handoffs do not point at
  // outputs the called function cannot produce.
  forEachString(route.then.args, `routes.${route.name}.then.args`, (value, path) => {
    const segments = outputExpressionSegments(value)
    if (segments === undefined || segments.length === 0) return

    const [indexSegment, ...fieldSegments] = segments
    if (!isArrayIndex(indexSegment)) {
      issues.push(routeAbiIssue(resource, path, "route output reference must start with a numeric output index"))
      return
    }

    const output = fn.outputs[Number(indexSegment)]
    if (output === undefined) {
      issues.push(routeAbiIssue(resource, path, `route output reference has no ABI output at index ${indexSegment}`))
      return
    }

    validateOutputFieldPath(resource, path, output, fieldSegments, issues)
  })
}

function validateOutputFieldPath(
  resource: string,
  path: string,
  output: unknown,
  segments: readonly string[],
  issues: CamConformanceIssue[],
): void {
  const [segment, ...rest] = segments
  if (segment === undefined) return

  if (!isRecordObject(output)) {
    issues.push(routeAbiIssue(resource, path, "referenced route output ABI value must be an object"))
    return
  }

  const type = nonEmptyString(output.type)
  if (type === undefined) {
    issues.push(routeAbiIssue(resource, path, "referenced route output ABI value must declare a type"))
    return
  }

  if (type.endsWith("[]")) {
    if (!isArrayIndex(segment)) {
      issues.push(routeAbiIssue(resource, path, `route output array reference must use a numeric index before ${segment}`))
      return
    }

    validateOutputFieldPath(resource, path, {
      ...output,
      type: type.slice(0, -2),
    }, rest, issues)
    return
  }

  if (/\[[0-9]+\]$/.test(type)) {
    issues.push(routeAbiIssue(resource, path, `fixed-size route output arrays are not supported: ${type}`))
    return
  }

  if (type !== "tuple") {
    issues.push(routeAbiIssue(resource, path, `route output ${type} has no field named ${segment}`))
    return
  }

  if (!Array.isArray(output.components)) {
    issues.push(routeAbiIssue(resource, path, "referenced route output tuple must declare components"))
    return
  }

  const component = output.components.find((item) => isRecordObject(item) && item.name === segment)
  if (component === undefined) {
    issues.push(routeAbiIssue(resource, path, `route output tuple has no field named ${segment}`))
    return
  }

  validateOutputFieldPath(resource, path, component, rest, issues)
}

function parseAbiFunctions(
  resource: string,
  bytes: Uint8Array,
  issues: CamConformanceIssue[],
): readonly AbiFunction[] | null {
  let abi: unknown
  let parseError: string | undefined
  try {
    abi = parseJsonBytes(bytes)
  } catch (error) {
    parseError = errorMessage(error)
  }
  if (parseError !== undefined) {
    issues.push(abiIssue(resource, undefined, `ABI resource is not valid JSON: ${parseError}`))
    return null
  }

  if (!Array.isArray(abi)) {
    issues.push(abiIssue(resource, undefined, "ABI resource must be a JSON array"))
    return null
  }

  const functions: AbiFunction[] = []
  abi.forEach((item, index) => {
    const fn = parseAbiFunction(resource, item, String(index), issues)
    if (fn !== undefined) {
      functions.push(fn)
    }
  })

  return functions
}

function parseAbiFunction(
  resource: string,
  item: unknown,
  path: string,
  issues: CamConformanceIssue[],
): AbiFunction | undefined {
  if (!isRecordObject(item)) {
    issues.push(abiIssue(resource, path, "ABI item must be an object"))
    return undefined
  }

  if (item.type !== "function") return undefined

  const name = nonEmptyString(item.name)
  const stateMutability = abiStateMutability(item.stateMutability)
  const inputNames = abiInputNames(resource, path, item.inputs, issues)

  if (name === undefined) {
    issues.push(abiIssue(resource, `${path}.name`, "ABI function name must be a non-empty string"))
  }
  if (stateMutability === undefined) {
    issues.push(abiIssue(resource, `${path}.stateMutability`, "ABI function stateMutability is not supported"))
  }
  if (!Array.isArray(item.outputs)) {
    issues.push(abiIssue(resource, `${path}.outputs`, "ABI function outputs must be an array"))
  }

  if (name === undefined || stateMutability === undefined || inputNames === undefined || !Array.isArray(item.outputs)) {
    return undefined
  }

  return {
    name,
    stateMutability,
    inputNames,
    outputs: item.outputs,
  }
}

function abiInputNames(
  resource: string,
  path: string,
  inputs: unknown,
  issues: CamConformanceIssue[],
): readonly string[] | undefined {
  if (!Array.isArray(inputs)) {
    issues.push(abiIssue(resource, `${path}.inputs`, "ABI function inputs must be an array"))
    return undefined
  }

  const names: string[] = []
  for (const [index, input] of inputs.entries()) {
    const inputPath = `${path}.inputs.${index}`
    if (!isRecordObject(input)) {
      issues.push(abiIssue(resource, inputPath, "ABI input must be an object"))
      return undefined
    }

    const name = nonEmptyString(input.name)
    if (name === undefined) {
      issues.push(abiIssue(resource, `${inputPath}.name`, "ABI inputs used by CAM routes must be named"))
      return undefined
    }
    if (nonEmptyString(input.type) === undefined) {
      issues.push(abiIssue(resource, `${inputPath}.type`, "ABI input type must be a non-empty string"))
      return undefined
    }

    names.push(name)
  }

  return names
}

function functionsByName(functions: readonly AbiFunction[]): ReadonlyMap<string, readonly AbiFunction[]> {
  const result = new Map<string, AbiFunction[]>()
  for (const fn of functions) {
    const matches = result.get(fn.name)
    if (matches === undefined) {
      result.set(fn.name, [fn])
      continue
    }
    matches.push(fn)
  }

  return result
}

function abiStateMutability(value: unknown): AbiFunction["stateMutability"] | undefined {
  if (value === "pure" || value === "view" || value === "nonpayable" || value === "payable") {
    return value
  }

  return undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function outputExpressionSegments(value: string): readonly string[] | undefined {
  if (value === "$outputs") return []
  if (!value.startsWith("$outputs.") || value.startsWith("$$")) return undefined

  return value.slice("$outputs.".length).split(".")
}

function forEachString(value: unknown, path: string, visit: (value: string, path: string) => void): void {
  if (typeof value === "string") {
    visit(value, path)
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => forEachString(item, `${path}.${index}`, visit))
    return
  }

  if (isRecordObject(value)) {
    for (const [name, item] of Object.entries(value)) {
      forEachString(item, `${path}.${name}`, visit)
    }
  }
}

function isArrayIndex(value: string | undefined): value is string {
  return value === "0" || (value !== undefined && /^[1-9][0-9]*$/.test(value))
}

function abiIssue(resource: string, path: string | undefined, message: string): CamConformanceIssue {
  const issue = {
    rule: "CAM_ABI_INVALID",
    severity: "error",
    resource,
    message,
  } satisfies Omit<CamConformanceIssue, "path">

  if (path === undefined) {
    return issue
  }

  return {
    ...issue,
    path,
  }
}

function routeAbiIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return {
    rule: "CAM_ROUTE_ABI_MISMATCH",
    severity: "error",
    resource,
    path,
    message,
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
