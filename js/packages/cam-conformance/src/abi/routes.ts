import {
  isRecordObject,
  parseJsonBytes,
} from "@cam/protocol"

import {
  conformanceIssue,
  errorMessage,
  type CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredRoute,
} from "../manifest/routes.ts"
import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"
import {
  diffNameSets,
} from "../names.ts"
import {
  forEachString,
} from "../walk.ts"
import {
  expressionReference,
} from "../expressions/reference.ts"

export type AbiFunction = {
  readonly name: string
  readonly signature: string
  readonly stateMutability: "pure" | "view" | "nonpayable" | "payable"
  readonly inputNames: readonly string[]
  readonly outputs: readonly unknown[]
}

export type ContractFunctionsByNamespace = ReadonlyMap<string, ReadonlyMap<string, readonly AbiFunction[]>>

export function validateRouteAbiCompatibility({
  resource,
  routes,
  functionsByNamespace,
  issues,
}: {
  readonly resource: string
  readonly routes: readonly DeclaredRoute[]
  readonly functionsByNamespace: ContractFunctionsByNamespace
  readonly issues: CamConformanceIssue[]
}): void {
  for (const route of routes) {
    validateRouteCallAbi(resource, route, functionsByNamespace, issues)
  }
}

export function contractFunctionsByNamespace(
  resources: ReadonlyMap<string, Uint8Array>,
  declarations: readonly ResourceDeclaration[],
  issues: CamConformanceIssue[],
): ContractFunctionsByNamespace {
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

export function resolvedAbiFunction(
  functionName: string,
  functions: ReadonlyMap<string, readonly AbiFunction[]>,
): AbiFunction | undefined {
  if (isFunctionSignature(functionName)) {
    const matches = Array.from(functions.values()).flat().filter((fn) => fn.signature === functionName)
    return matches.length === 1 ? matches[0] : undefined
  }

  const matches = functions.get(functionName)
  return matches?.length === 1 ? matches[0] : undefined
}

export function abiOutputAtSegments(output: unknown, segments: readonly string[]): unknown | undefined {
  const [segment, ...rest] = segments
  if (segment === undefined) return output
  if (!isRecordObject(output)) return undefined

  const type = nonEmptyString(output.type)
  if (type === undefined) return undefined

  if (type.endsWith("[]")) {
    if (!isArrayIndex(segment)) return undefined
    return abiOutputAtSegments({
      ...output,
      type: type.slice(0, -2),
    }, rest)
  }
  if (type !== "tuple" || !Array.isArray(output.components)) return undefined

  const component = output.components.find((item) => isRecordObject(item) && item.name === segment)
  if (component === undefined) return undefined
  return abiOutputAtSegments(component, rest)
}

export function abiFunctionOutputForExpression(fn: AbiFunction, value: unknown): unknown | undefined {
  if (typeof value !== "string") return undefined

  const segments = outputExpressionSegments(value)
  if (segments === undefined) return undefined

  const [index, ...fieldSegments] = segments
  if (!isArrayIndex(index)) return undefined

  const output = fn.outputs[Number(index)]
  if (output === undefined) return undefined

  return abiOutputAtSegments(output, fieldSegments)
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

  const fn = resolveRouteFunction(resource, path, route.call.function, functions, issues)
  if (fn === undefined) {
    return
  }
  validateRouteMutability(resource, route, fn, issues)
  validateRouteArgs(resource, route, fn, issues)
  validateRouteOutputRefs(resource, route, fn, issues)
}

function resolveRouteFunction(
  resource: string,
  path: string,
  functionName: string,
  functions: ReadonlyMap<string, readonly AbiFunction[]>,
  issues: CamConformanceIssue[],
): AbiFunction | undefined {
  if (isFunctionSignature(functionName)) {
    return resolveRouteFunctionSignature(resource, path, functionName, functions, issues)
  }

  const matches = functions.get(functionName)
  if (matches === undefined) {
    issues.push(routeAbiIssue(resource, path, `route function not found in ABI: ${functionName}`))
    return undefined
  }
  if (matches.length > 1) {
    issues.push(routeAbiIssue(
      resource,
      `${path}.function`,
      `route function is overloaded; use a full signature such as ${firstSignature(matches)}`,
    ))
    return undefined
  }

  return matches[0]
}

function resolveRouteFunctionSignature(
  resource: string,
  path: string,
  signature: string,
  functions: ReadonlyMap<string, readonly AbiFunction[]>,
  issues: CamConformanceIssue[],
): AbiFunction | undefined {
  const matches = Array.from(functions.values()).flat().filter((fn) => fn.signature === signature)
  if (matches.length === 0) {
    issues.push(routeAbiIssue(resource, path, `route function signature not found in ABI: ${signature}`))
    return undefined
  }
  if (matches.length > 1) {
    issues.push(routeAbiIssue(resource, `${path}.function`, `route function signature is duplicated in ABI: ${signature}`))
    return undefined
  }

  return matches[0]
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
  diffNameSets({
    expectedNames: fn.inputNames,
    actualNames: Object.keys(route.call.args),
    onUnexpected: (name) => {
      issues.push(routeAbiIssue(resource, `routes.${route.name}.call.args.${name}`, `unexpected route argument: ${name}`))
    },
    onMissing: (name) => {
      issues.push(routeAbiIssue(resource, `routes.${route.name}.call.args.${name}`, `missing route argument: ${name}`))
    },
  })
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
  const inputs = abiInputs(resource, path, item.inputs, issues)

  if (name === undefined) {
    issues.push(abiIssue(resource, `${path}.name`, "ABI function name must be a non-empty string"))
  }
  if (stateMutability === undefined) {
    issues.push(abiIssue(resource, `${path}.stateMutability`, "ABI function stateMutability is not supported"))
  }
  if (!Array.isArray(item.outputs)) {
    issues.push(abiIssue(resource, `${path}.outputs`, "ABI function outputs must be an array"))
  }

  if (name === undefined || stateMutability === undefined || inputs === undefined || !Array.isArray(item.outputs)) {
    return undefined
  }

  return {
    name,
    signature: `${name}(${inputs.types.join(",")})`,
    stateMutability,
    inputNames: inputs.names,
    outputs: item.outputs,
  }
}

function abiInputs(
  resource: string,
  path: string,
  inputs: unknown,
  issues: CamConformanceIssue[],
): { readonly names: readonly string[], readonly types: readonly string[] } | undefined {
  if (!Array.isArray(inputs)) {
    issues.push(abiIssue(resource, `${path}.inputs`, "ABI function inputs must be an array"))
    return undefined
  }

  const names: string[] = []
  const types: string[] = []
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
    const type = canonicalAbiType(resource, inputPath, input, issues)
    if (type === undefined) {
      return undefined
    }

    names.push(name)
    types.push(type)
  }

  return { names, types }
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

function isFunctionSignature(value: string): boolean {
  return value.includes("(")
}

function canonicalAbiType(
  resource: string,
  path: string,
  item: Record<string, unknown>,
  issues: CamConformanceIssue[],
): string | undefined {
  const type = nonEmptyString(item.type)
  if (type === undefined) {
    issues.push(abiIssue(resource, `${path}.type`, "ABI input type must be a non-empty string"))
    return undefined
  }

  const suffix = tupleArraySuffix(type)
  if (suffix === undefined) return type

  if (!Array.isArray(item.components)) {
    issues.push(abiIssue(resource, `${path}.components`, "tuple ABI input must declare components"))
    return undefined
  }

  const componentTypes: string[] = []
  for (const [index, component] of item.components.entries()) {
    if (!isRecordObject(component)) {
      issues.push(abiIssue(resource, `${path}.components.${index}`, "tuple ABI component must be an object"))
      return undefined
    }

    const componentType = canonicalAbiType(resource, `${path}.components.${index}`, component, issues)
    if (componentType === undefined) return undefined
    componentTypes.push(componentType)
  }

  return `(${componentTypes.join(",")})${suffix}`
}

function firstSignature(functions: readonly AbiFunction[]): string {
  const [first] = functions
  if (first === undefined) return "<signature>"
  return first.signature
}

function tupleArraySuffix(type: string): string | undefined {
  if (type === "tuple") return ""
  if (/^tuple(\[[0-9]*\])+$/.test(type)) return type.slice("tuple".length)
  return undefined
}

function outputExpressionSegments(value: string): readonly string[] | undefined {
  const reference = expressionReference(value)
  if (reference === undefined || reference.root !== "outputs") return undefined

  return reference.segments
}

function isArrayIndex(value: string | undefined): value is string {
  return value === "0" || (value !== undefined && /^[1-9][0-9]*$/.test(value))
}

function abiIssue(resource: string, path: string | undefined, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: "CAM_ABI_INVALID",
    resource,
    path,
    message,
  })
}

function routeAbiIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: "CAM_ROUTE_ABI_MISMATCH",
    resource,
    path,
    message,
  })
}
