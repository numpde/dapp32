import {
  abiDynamicArrayElementType,
  abiFunctionSignature,
  abiScalarKind,
  isAbiAddressValue,
  isAbiBytesValue,
  isAbiFunctionName,
  isAbiFunctionSignatureReference,
  isAbiIntegerValue,
  isAbiStateMutability,
  isExpressionArrayIndex,
  isFixedAbiArrayType,
  isRecordObject,
  isSupportedAbiScalarType,
  diffNameSets,
  inspectAbiParameterNames,
  parseAbiFixedBytesLength,
  parseAbiIntegerType,
  parseJsonBytes,
  type AbiParameterNameIssue,
  type AbiStateMutability,
} from "@cam/protocol"

import {
  conformanceIssue,
  conformanceRules,
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
  forEachString,
  nonEmptyString,
} from "../walk.ts"
import {
  expressionReference,
  staticString,
} from "../expressions/reference.ts"
import {
  isKnownStaticStringValue,
  knownStaticStringContent,
  UNKNOWN_ROUTE_CALL_VALUE,
} from "../expressions/known-route-call.ts"

export type AbiFunction = {
  readonly name: string
  readonly signature: string
  readonly stateMutability: AbiStateMutability
  readonly inputs: readonly AbiInput[]
  readonly outputs: readonly unknown[]
}

export type ContractFunctionsByNamespace = ReadonlyMap<string, ReadonlyMap<string, readonly AbiFunction[]>>

type AbiInput = {
  readonly name: string
  readonly type: string
  readonly abi: Record<string, unknown>
}

type KnownRouteArgKind = "address" | "array" | "bool" | "bytes" | "integer" | "null" | "number" | "object" | "string" | "string-literal"
type KnownRouteArgValue = {
  readonly kind: KnownRouteArgKind
  readonly description: string
}
export type AbiArgValueMismatch = {
  readonly pathSuffix: string
  readonly message: string
}

const RULES = conformanceRules({
  CAM_ABI_INVALID: {
    class: "A",
    reason: "ABI resource shape is publication input for route/UI joins.",
  },
  CAM_ROUTE_ABI_MISMATCH: {
    class: "A",
    reason: "Route declarations must agree with ABI functions and known argument/output shapes.",
  },
  CAM_ROUTE_VALUE_MISMATCH: {
    class: "A",
    reason: "Payable writes require a declared uint256 transaction value; nonpayable writes forbid one.",
  },
  CAM_RESOLVER_ARGUMENT_ABI_MISMATCH: {
    class: "B",
    reason: "Direct resolver output arguments must agree with the final write ABI.",
    limitation: "Only complete direct output arguments are compared, using exact ABI type-string equality; tuple component compatibility remains a runtime check, and safe conversions are not inferred.",
  },
})

const TRANSACTION_VALUE_ABI = {
  name: "value",
  type: "uint256",
} as const

export function validateRouteAbiCompatibility({
  resource,
  routes,
  functionsByNamespace,
  eventsByNamespace,
  issues,
}: {
  readonly resource: string
  readonly routes: readonly DeclaredRoute[]
  readonly functionsByNamespace: ContractFunctionsByNamespace
  readonly eventsByNamespace: ContractEventsByNamespace
  readonly issues: CamConformanceIssue[]
}): void {
  for (const route of routes) {
    const fn = validateRouteCallAbi(resource, route, functionsByNamespace, issues)
    validateRouteValue(resource, route, fn, issues)
    validateRouteResolverAbi(resource, route, fn, functionsByNamespace, issues)
    validateTransactionPresentations(resource, route, functionsByNamespace, eventsByNamespace, issues)
  }
}

function validateRouteResolverAbi(
  resource: string,
  route: DeclaredRoute,
  write: AbiFunction | undefined,
  functionsByNamespace: ContractFunctionsByNamespace,
  issues: CamConformanceIssue[],
): void {
  if (route.resolve === undefined) return
  const path = `routes.${route.name}.resolve`
  const functions = functionsByNamespace.get(route.resolve.namespace)
  if (functions === undefined) return
  const resolver = resolveRouteFunction(resource, path, route.resolve.function, functions, issues)
  if (resolver === undefined) return
  if (resolver.stateMutability !== "view" && resolver.stateMutability !== "pure") {
    issues.push(routeAbiIssue(resource, `${path}.function`, "route resolver ABI function must be view or pure"))
  }
  diffNameSets({
    expectedNames: resolver.inputs.map(input => input.name), actualNames: Object.keys(route.resolve.args),
    onMissing: name => { issues.push(routeAbiIssue(resource, `${path}.args.${name}`, `missing resolver argument: ${name}`)) },
    onUnexpected: name => { issues.push(routeAbiIssue(resource, `${path}.args.${name}`, `unexpected resolver argument: ${name}`)) },
  })
  for (const input of resolver.inputs) {
    if (Object.hasOwn(route.resolve.args, input.name)) {
      validateRouteArgValue(resource, `${path}.args.${input.name}`, input.name, route.resolve.args[input.name], input.abi, issues)
    }
  }
  const target = abiFunctionOutputForExpression(resolver, route.call.target)
  if (!isRecordObject(target) || target.type !== "address") {
    issues.push(routeAbiIssue(resource, `routes.${route.name}.call.target`, "resolved write target must reference a scalar address ABI output"))
  }
  if (write === undefined) return
  for (const input of write.inputs) {
    const value = route.call.args[input.name]
    if (typeof value !== "string" || expressionReference(value)?.root !== "outputs") continue
    const output = abiFunctionOutputForExpression(resolver, value)
    if (output === undefined) {
      issues.push(routeAbiIssue(resource, `routes.${route.name}.call.args.${input.name}`, `resolver output reference has no ABI output: ${value}`))
    } else if (isRecordObject(output) && output.type !== input.type) {
      issues.push(conformanceIssue({
        rule: RULES.CAM_RESOLVER_ARGUMENT_ABI_MISMATCH, resource, path: `routes.${route.name}.call.args.${input.name}`,
        message: `resolver output ABI type ${String(output.type)} does not match write argument ${input.name} type ${input.type}; direct resolver arguments require matching ABI type strings`,
      }))
    }
  }
}

export type ContractEventsByNamespace = ReadonlyMap<string, readonly Record<string, unknown>[]>

export function contractAbisByNamespace(
  resources: ReadonlyMap<string, Uint8Array>,
  declarations: readonly ResourceDeclaration[],
  issues: CamConformanceIssue[],
): { readonly functionsByNamespace: ContractFunctionsByNamespace; readonly eventsByNamespace: ContractEventsByNamespace } {
  const events = new Map<string, readonly Record<string, unknown>[]>()
  const result = new Map<string, ReadonlyMap<string, readonly AbiFunction[]>>()
  for (const declaration of declarations) {
    if (declaration.namespaceType !== "contract") continue

    const bytes = resources.get(declaration.uri)
    if (bytes === undefined) continue

    const parsed = parseAbiResource(declaration.uri, bytes, issues)
    if (parsed !== null) {
      result.set(declaration.namespace, functionsByName(parsed.functions))
      events.set(declaration.namespace, parsed.events)
    }
  }

  return { functionsByNamespace: result, eventsByNamespace: events }
}

export function resolvedAbiFunction(
  functionName: string,
  functions: ReadonlyMap<string, readonly AbiFunction[]>,
): AbiFunction | undefined {
  if (isAbiFunctionSignatureReference(functionName)) {
    const matches = Array.from(functions.values()).flat().filter((fn) => fn.signature === functionName)
    return matches.length === 1 ? matches[0] : undefined
  }
  if (!isAbiFunctionName(functionName)) return undefined

  const matches = functions.get(functionName)
  return matches?.length === 1 ? matches[0] : undefined
}

export function abiOutputAtSegments(output: unknown, segments: readonly string[]): unknown | undefined {
  const [segment, ...rest] = segments
  if (segment === undefined) return output
  if (!isRecordObject(output)) return undefined

  const type = nonEmptyString(output.type)
  if (type === undefined) return undefined

  if (type === "array" && Array.isArray(output.items)) {
    if (!isExpressionArrayIndex(segment)) return undefined
    return abiOutputAtSegments(output.items[Number(segment)], rest)
  }
  const arrayElementType = abiDynamicArrayElementType(type)
  if (arrayElementType !== undefined) {
    if (!isExpressionArrayIndex(segment)) return undefined
    return abiOutputAtSegments({
      ...output,
      type: arrayElementType,
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
  if (!isExpressionArrayIndex(index)) return undefined

  const output = fn.outputs[Number(index)]
  if (output === undefined) return undefined

  return abiOutputAtSegments(output, fieldSegments)
}

function validateRouteCallAbi(
  resource: string,
  route: DeclaredRoute,
  functionsByNamespace: ReadonlyMap<string, ReadonlyMap<string, readonly AbiFunction[]>>,
  issues: CamConformanceIssue[],
): AbiFunction | undefined {
  const path = `routes.${route.name}.call`
  const functions = functionsByNamespace.get(route.call.namespace)
  if (functions === undefined) return undefined

  const fn = resolveRouteFunction(resource, path, route.call.function, functions, issues)
  if (fn === undefined) {
    return undefined
  }
  validateRouteMutability(resource, route, fn, issues)
  validateRouteArgs(resource, route, fn, issues)
  validateRouteOutputRefs(resource, route, fn, issues)
  return fn
}

function validateRouteValue(
  resource: string,
  route: DeclaredRoute,
  fn: AbiFunction | undefined,
  issues: CamConformanceIssue[],
): void {
  if (route.kind !== "write" || fn === undefined) return

  if (fn.stateMutability === "payable") {
    if (!Object.hasOwn(route, "value")) {
      issues.push(routeValueIssue(resource, route, `payable write route must declare value: ${fn.name}`))
      return
    }

    for (const mismatch of abiArgValueMismatches("transaction value", route.value, TRANSACTION_VALUE_ABI)) {
      issues.push(routeValueIssue(resource, route, mismatch.message, mismatch.pathSuffix))
    }
    return
  }

  if (fn.stateMutability === "nonpayable" && Object.hasOwn(route, "value")) {
    issues.push(routeValueIssue(resource, route, `nonpayable write route must not declare value: ${fn.name}`))
  }
}

function routeValueIssue(
  resource: string,
  route: DeclaredRoute,
  message: string,
  pathSuffix = "",
): CamConformanceIssue {
  return conformanceIssue({
    rule: RULES.CAM_ROUTE_VALUE_MISMATCH,
    resource,
    path: `routes.${route.name}.value${pathSuffix}`,
    message,
  })
}

function resolveRouteFunction(
  resource: string,
  path: string,
  functionName: string,
  functions: ReadonlyMap<string, readonly AbiFunction[]>,
  issues: CamConformanceIssue[],
): AbiFunction | undefined {
  if (isAbiFunctionSignatureReference(functionName)) {
    return resolveRouteFunctionSignature(resource, path, functionName, functions, issues)
  }
  if (!isAbiFunctionName(functionName)) {
    issues.push(routeAbiIssue(resource, `${path}.function`, `route function must be a name or full signature: ${functionName}`))
    return undefined
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
  if (
    route.kind === "write"
    && fn.stateMutability !== "nonpayable"
    && fn.stateMutability !== "payable"
  ) {
    issues.push(routeAbiIssue(resource, path, `write route function must be payable or nonpayable: ${fn.name}`))
  }
}

function validateRouteArgs(resource: string, route: DeclaredRoute, fn: AbiFunction, issues: CamConformanceIssue[]): void {
  validateInvocationArguments(resource, `routes.${route.name}.call.args`, route.call.args, fn, issues)
}

function validateRouteArgValue(
  resource: string,
  path: string,
  label: string,
  value: unknown,
  parameter: Record<string, unknown>,
  issues: CamConformanceIssue[],
): void {
  // Route arguments are joined to the declared ABI here; this rejects only
  // deterministic literal/aggregate mismatches and skips unknown expressions
  // that need runtime account/state/RPC resolution.
  for (const mismatch of abiArgValueMismatches(label, value, parameter)) {
    issues.push(routeAbiIssue(resource, `${path}${mismatch.pathSuffix}`, mismatch.message))
  }
}

export function abiArgValueMismatches(
  label: string,
  value: unknown,
  parameter: Record<string, unknown>,
): readonly AbiArgValueMismatch[] {
  const mismatches: AbiArgValueMismatch[] = []
  collectAbiArgValueMismatches("", label, value, parameter, mismatches)
  return mismatches
}

function collectAbiArgValueMismatches(
  pathSuffix: string,
  label: string,
  value: unknown,
  parameter: Record<string, unknown>,
  mismatches: AbiArgValueMismatch[],
): void {
  const type = nonEmptyString(parameter.type)
  if (type === undefined) return
  if (value === UNKNOWN_ROUTE_CALL_VALUE) return

  const arrayElementType = abiDynamicArrayElementType(type)
  if (arrayElementType !== undefined) {
    if (isUnknownExpression(value)) return
    if (!Array.isArray(value)) {
      const known = knownRouteArgValue(value)
      mismatches.push(argValueMismatch(pathSuffix, label, type, known === undefined ? "not an array" : known.description))
      return
    }

    const element = { ...parameter, type: arrayElementType }
    value.forEach((item, index) => {
      collectAbiArgValueMismatches(`${pathSuffix}.${index}`, `${label}.${index}`, item, element, mismatches)
    })
    return
  }

  if (type === "tuple") {
    if (isUnknownExpression(value)) return
    if (!isRecordObject(value)) {
      const known = knownRouteArgValue(value)
      mismatches.push(argValueMismatch(pathSuffix, label, type, known === undefined ? "not an object" : known.description))
      return
    }

    const components = abiComponents(parameter)
    if (components === undefined) return

    diffNameSets({
      expectedNames: components.map((component) => nonEmptyString(component.name)).filter((name): name is string => name !== undefined),
      actualNames: Object.keys(value),
      onUnexpected: (name) => {
        mismatches.push({
          pathSuffix: `${pathSuffix}.${name}`,
          message: `unexpected tuple component for ${label}: ${name}`,
        })
      },
      onMissing: (name) => {
        mismatches.push({
          pathSuffix: `${pathSuffix}.${name}`,
          message: `missing tuple component for ${label}: ${name}`,
        })
      },
    })

    for (const component of components) {
      const componentName = nonEmptyString(component.name)
      if (componentName === undefined || !Object.hasOwn(value, componentName)) continue
      collectAbiArgValueMismatches(
        `${pathSuffix}.${componentName}`,
        `${label}.${componentName}`,
        value[componentName],
        component,
        mismatches,
      )
    }
    return
  }

  const scalarKind = abiScalarKind(type)
  if (scalarKind === undefined) return

  const mismatch = routeArgMismatch(type, value, scalarKind)
  if (mismatch === undefined) return

  mismatches.push(argValueMismatch(pathSuffix, label, type, mismatch))
}

function argValueMismatch(
  pathSuffix: string,
  label: string,
  type: string,
  mismatch: string,
): AbiArgValueMismatch {
  return {
    pathSuffix,
    message: `route argument ${label} expects ABI ${type}, but ${mismatch}`,
  }
}

function routeArgMismatch(
  type: string,
  value: unknown,
  expected: "address" | "bool" | "bytes" | "fixed-bytes" | "integer" | "string",
): string | undefined {
  const known = knownRouteArgValue(value)
  if (expected === "string") {
    if (typeof value === "string") return undefined
    if (isKnownStaticStringValue(value)) return undefined
    if (known === undefined) return undefined
    return known.kind === "address" || known.kind === "bytes" || known.kind === "string" || known.kind === "string-literal"
      ? undefined
      : `value is ${known.description}`
  }
  if (known === undefined) return undefined

  if (expected === "address") {
    if (known.kind === "string-literal") {
      return isAbiAddressValue(staticScalarString(value)) ? undefined : "string literal is not an address"
    }
    return known.kind === "address" ? undefined : `value is ${known.description}`
  }
  if (expected === "bool") {
    return known.kind === "bool" ? undefined : `value is ${known.description}`
  }
  if (expected === "integer") {
    if (known.kind === "integer" || known.kind === "string-literal") {
      const integerType = parseAbiIntegerType(type)
      return integerType !== undefined && isAbiIntegerValue(staticScalarString(value), integerType)
        ? undefined
        : `value is not in range for ${type}`
    }
    return `value is ${known.description}`
  }
  if (expected === "bytes") {
    if (known.kind === "string-literal") {
      return isAbiBytesValue(staticScalarString(value)) ? undefined : "string literal is not hex bytes"
    }
    return known.kind === "bytes" ? undefined : `value is ${known.description}`
  }
  if (expected === "fixed-bytes") {
    if (known.kind === "string-literal") {
      const fixedBytesLength = parseAbiFixedBytesLength(type)
      return fixedBytesLength !== undefined && isAbiBytesValue(staticScalarString(value), fixedBytesLength)
        ? undefined
        : `string literal is not ${type}`
    }
    if (known.kind !== "bytes") return `value is ${known.description}`
    return undefined
  }

  return undefined
}

function knownRouteArgValue(value: unknown): KnownRouteArgValue | undefined {
  if (value === UNKNOWN_ROUTE_CALL_VALUE) return undefined
  if (isKnownStaticStringValue(value)) return { kind: "string-literal", description: "a string literal" }
  if (typeof value === "boolean") return { kind: "bool", description: "a boolean literal" }
  if (typeof value === "number" && Number.isSafeInteger(value)) return { kind: "integer", description: "an integer literal" }
  if (typeof value === "number") return { kind: "number", description: "an unsafe number literal" }
  if (value === null) return { kind: "null", description: "null" }
  if (Array.isArray(value)) return { kind: "array", description: "an array literal" }
  if (isRecordObject(value)) return { kind: "object", description: "an object literal" }

  if (typeof value !== "string") return undefined

  if (staticString(value) !== undefined) {
    return { kind: "string-literal", description: "a string literal" }
  }

  const reference = expressionReference(value)
  if (reference === undefined) return undefined

  // Protocol roots have static semantic types even when their concrete values
  // are runtime-supplied. Conformance may check address-vs-string wiring here,
  // but not whether an account, host, or RPC value is currently available.
  if (reference.root === "account" && reference.segments.join(".") === "address") {
    return { kind: "address", description: "$account.address" }
  }
  if (reference.root === "host" && reference.segments.join(".") === "address") {
    return { kind: "address", description: "$host.address" }
  }
  if (reference.root === "host" && reference.segments.join(".") === "chainId") {
    return { kind: "string", description: "$host.chainId" }
  }
  return undefined
}

function isUnknownExpression(value: unknown): boolean {
  return typeof value === "string" && staticString(value) === undefined && knownRouteArgValue(value) === undefined
}

function staticScalarString(value: unknown): unknown {
  return isKnownStaticStringValue(value) ? knownStaticStringContent(value) : value
}

function validateRouteOutputRefs(resource: string, route: DeclaredRoute, fn: AbiFunction, issues: CamConformanceIssue[]): void {
  // This is reference-driven and cross-document: route handoffs must not point
  // at ABI outputs the called function cannot produce. Runtime still owns
  // concrete decoded output normalization.
  forEachString(route.then.args, `routes.${route.name}.then.args`, (value, path) => {
    const segments = outputExpressionSegments(value)
    if (segments === undefined || segments.length === 0) return

    const [indexSegment, ...fieldSegments] = segments
    if (!isExpressionArrayIndex(indexSegment)) {
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

  const arrayElementType = abiDynamicArrayElementType(type)
  if (arrayElementType !== undefined) {
    if (!isExpressionArrayIndex(segment)) {
      issues.push(routeAbiIssue(resource, path, `route output array reference must use a numeric index before ${segment}`))
      return
    }

    validateOutputFieldPath(resource, path, {
      ...output,
      type: arrayElementType,
    }, rest, issues)
    return
  }

  if (isFixedAbiArrayType(type)) {
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

function parseAbiResource(
  resource: string,
  bytes: Uint8Array,
  issues: CamConformanceIssue[],
): { readonly functions: readonly AbiFunction[]; readonly events: readonly Record<string, unknown>[] } | null {
  // Functions join calls and UI values; event declarations are admitted only
  // when a receipt presentation selects them. Unused events are not linted.
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
  const signatures = new Set<string>()
  abi.forEach((item, index) => {
    const fn = parseAbiFunction(resource, item, String(index), issues)
    if (fn !== undefined) {
      if (signatures.has(fn.signature)) {
        issues.push(abiIssue(resource, String(index), `ABI contains duplicate function signature: ${fn.signature}`))
        return
      }
      signatures.add(fn.signature)
      functions.push(fn)
    }
  })

  return { functions, events: abi.filter((item): item is Record<string, unknown> => isRecordObject(item) && item.type === "event") }
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

  const itemType = nonEmptyString(item.type)
  if (itemType === undefined) {
    issues.push(abiIssue(resource, `${path}.type`, "ABI item type must be a non-empty string"))
    return undefined
  }

  if (itemType !== "function") return undefined

  const name = nonEmptyString(item.name)
  const stateMutability = isAbiStateMutability(item.stateMutability) ? item.stateMutability : undefined
  const inputs = abiInputs(resource, path, item.inputs, issues)
  const outputs = abiOutputs(resource, path, item.outputs, issues)

  const validName = name !== undefined && isAbiFunctionName(name)
  if (name === undefined) {
    issues.push(abiIssue(resource, `${path}.name`, "ABI function name must be a non-empty string"))
  } else if (!validName) {
    issues.push(abiIssue(resource, `${path}.name`, "ABI function name is not supported"))
  }
  if (stateMutability === undefined) {
    issues.push(abiIssue(resource, `${path}.stateMutability`, "ABI function stateMutability is not supported"))
  }

  if (!validName || stateMutability === undefined || inputs === undefined || outputs === undefined) {
    return undefined
  }

  const signature = abiFunctionSignature({ name, inputs })
  if (signature === undefined) {
    issues.push(abiIssue(resource, path, "ABI function signature cannot be derived"))
    return undefined
  }

  return {
    name,
    signature,
    stateMutability,
    inputs,
    outputs,
  }
}

function abiInputs(
  resource: string,
  path: string,
  inputs: unknown,
  issues: CamConformanceIssue[],
): readonly AbiInput[] | undefined {
  if (!Array.isArray(inputs)) {
    issues.push(abiIssue(resource, `${path}.inputs`, "ABI function inputs must be an array"))
    return undefined
  }

  const inputRecords: Record<string, unknown>[] = []
  for (const [index, input] of inputs.entries()) {
    const inputPath = `${path}.inputs.${index}`
    if (!isRecordObject(input)) {
      issues.push(abiIssue(resource, inputPath, "ABI input must be an object"))
      return undefined
    }
    inputRecords.push(input)
  }

  const inspected = inspectAbiParameterNames(inputRecords)
  const nameIssue = inspected.issues[0]
  if (nameIssue !== undefined) {
    issues.push(abiParameterNameIssue({
      resource,
      path: `${path}.inputs`,
      issue: nameIssue,
      unnamedMessage: "ABI inputs used by CAM routes must be named",
      duplicateMessage: "ABI input name is duplicated",
    }))
    return undefined
  }

  const result: AbiInput[] = []
  for (const { parameter: input, name, index } of inspected.entries) {
    const inputPath = `${path}.inputs.${index}`
    const type = canonicalAbiType(resource, inputPath, input, "input", issues)
    if (type === undefined) {
      return undefined
    }

    result.push({ name, type, abi: input })
  }

  return result
}

function abiComponents(parameter: Record<string, unknown>): readonly Record<string, unknown>[] | undefined {
  return Array.isArray(parameter.components) && parameter.components.every(isRecordObject)
    ? parameter.components
    : undefined
}

function abiOutputs(
  resource: string,
  path: string,
  outputs: unknown,
  issues: CamConformanceIssue[],
): readonly unknown[] | undefined {
  if (!Array.isArray(outputs)) {
    issues.push(abiIssue(resource, `${path}.outputs`, "ABI function outputs must be an array"))
    return undefined
  }

  for (const [index, output] of outputs.entries()) {
    if (!isRecordObject(output)) {
      issues.push(abiIssue(resource, `${path}.outputs.${index}`, "ABI output must be an object"))
      return undefined
    }
    if (canonicalAbiType(resource, `${path}.outputs.${index}`, output, "output", issues) === undefined) {
      return undefined
    }
  }

  return outputs
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

function canonicalAbiType(
  resource: string,
  path: string,
  item: Record<string, unknown>,
  position: "input" | "output",
  issues: CamConformanceIssue[],
): string | undefined {
  // CAM supports a deliberately small ABI type surface. Conformance rejects
  // unsupported publication resources without becoming a Solidity ABI linter.
  const type = nonEmptyString(item.type)
  if (type === undefined) {
    issues.push(abiIssue(resource, `${path}.type`, `ABI ${position} type must be a non-empty string`))
    return undefined
  }

  const arrayElementType = abiDynamicArrayElementType(type)
  if (arrayElementType !== undefined) {
    const elementType = canonicalAbiType(resource, path, { ...item, type: arrayElementType }, position, issues)
    return elementType === undefined ? undefined : `${elementType}[]`
  }

  if (isFixedAbiArrayType(type)) {
    issues.push(abiIssue(resource, path, `ABI fixed-size arrays are not supported: ${type}`))
    return undefined
  }

  if (type !== "tuple") {
    if (!isSupportedAbiScalarType(type)) {
      issues.push(abiIssue(resource, path, `ABI ${position} type is not supported: ${type}`))
      return undefined
    }
    if ("components" in item) {
      issues.push(abiIssue(resource, `${path}.components`, "ABI components require a tuple type"))
      return undefined
    }
    return type
  }

  if (!Array.isArray(item.components)) {
    issues.push(abiIssue(resource, `${path}.components`, `tuple ABI ${position} must declare components`))
    return undefined
  }

  const componentTypes: string[] = []
  const componentRecords: Record<string, unknown>[] = []
  for (const [index, component] of item.components.entries()) {
    const componentPath = `${path}.components.${index}`
    if (!isRecordObject(component)) {
      issues.push(abiIssue(resource, componentPath, "tuple ABI component must be an object"))
      return undefined
    }
    componentRecords.push(component)
  }

  const inspected = inspectAbiParameterNames(componentRecords)
  const nameIssue = inspected.issues[0]
  if (nameIssue !== undefined) {
    issues.push(abiParameterNameIssue({
      resource,
      path: `${path}.components`,
      issue: nameIssue,
      unnamedMessage: "tuple ABI components used by CAM routes must be named",
      duplicateMessage: "tuple ABI component name is duplicated",
    }))
    return undefined
  }

  for (const { parameter: component, index } of inspected.entries) {
    const componentPath = `${path}.components.${index}`
    const componentType = canonicalAbiType(resource, componentPath, component, position, issues)
    if (componentType === undefined) return undefined
    componentTypes.push(componentType)
  }

  return `(${componentTypes.join(",")})`
}

function abiParameterNameIssue({
  resource,
  path,
  issue,
  unnamedMessage,
  duplicateMessage,
}: {
  readonly resource: string
  readonly path: string
  readonly issue: AbiParameterNameIssue
  readonly unnamedMessage: string
  readonly duplicateMessage: string
}): CamConformanceIssue {
  if (issue.kind === "unnamed") {
    return abiIssue(resource, `${path}.${issue.index}.name`, unnamedMessage)
  }

  return abiIssue(resource, `${path}.${issue.index}.name`, `${duplicateMessage}: ${issue.name}`)
}

function firstSignature(functions: readonly AbiFunction[]): string {
  const [first] = functions
  if (first === undefined) return "<signature>"
  return first.signature
}

function outputExpressionSegments(value: string): readonly string[] | undefined {
  const reference = expressionReference(value)
  if (reference === undefined || reference.root !== "outputs") return undefined

  return reference.segments
}

function abiIssue(resource: string, path: string | undefined, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: RULES.CAM_ABI_INVALID,
    resource,
    path,
    message,
  })
}

function routeAbiIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: RULES.CAM_ROUTE_ABI_MISMATCH,
    resource,
    path,
    message,
  })
}

export type TransactionPresentationPhase = "review" | "receipt" | "empty"

export function transactionPresentationOutput(
  route: DeclaredRoute,
  phase: TransactionPresentationPhase,
  functions: ContractFunctionsByNamespace,
  events: ContractEventsByNamespace,
  value: unknown,
): unknown | undefined {
  const reference = typeof value === "string" ? expressionReference(value) : undefined
  if (reference?.root !== "outputs" || reference.segments[0] !== "0") return undefined
  const [, selector, ...rest] = reference.segments
  if (phase === "receipt") {
    const matches = events.get(route.call.namespace)?.filter(event => event.name === route.receipt?.event)
    const inputs = matches?.length === 1 ? matches[0]?.inputs : undefined
    if (!Array.isArray(inputs)) return undefined
    if (selector === undefined) return { type: "tuple", components: inputs }
    const parameter = inputs.find(input => isRecordObject(input) && input.name === selector)
    return abiOutputAtSegments(parameter, rest)
  }
  if (phase !== "review" || route.review === undefined) return undefined
  if (selector === undefined) {
    const readInventory = functions.get(route.review.call.namespace)
    const writeInventory = functions.get(route.call.namespace)
    const read = readInventory === undefined ? undefined : resolvedAbiFunction(route.review.call.function, readInventory)
    const write = writeInventory === undefined ? undefined : resolvedAbiFunction(route.call.function, writeInventory)
    if (read === undefined || write === undefined) return undefined
    return { type: "tuple", components: [{ name: "read", type: "array", items: read.outputs }, { name: "simulation", type: "array", items: write.outputs }] }
  }
  if (selector !== "read" && selector !== "simulation") return undefined
  const invocation = selector === "read" ? route.review.call : route.call
  const inventory = functions.get(invocation.namespace)
  const fn = inventory === undefined ? undefined : resolvedAbiFunction(invocation.function, inventory)
  const [index, ...fields] = rest
  if (fn === undefined) return undefined
  if (index === undefined) return { type: "array", items: fn.outputs }
  if (!isExpressionArrayIndex(index)) return undefined
  return abiOutputAtSegments(fn.outputs[Number(index)], fields)
}

function validateTransactionPresentations(resource: string, route: DeclaredRoute, functions: ContractFunctionsByNamespace, events: ContractEventsByNamespace, issues: CamConformanceIssue[]): void {
  if (route.review !== undefined) {
    const call = route.review.call
    const inventory = functions.get(call.namespace)
    const fn = inventory === undefined ? undefined : resolveRouteFunction(resource, `routes.${route.name}.review.call`, call.function, inventory, issues)
    if (fn !== undefined) {
      if (fn.stateMutability !== "view" && fn.stateMutability !== "pure") issues.push(routeAbiIssue(resource, `routes.${route.name}.review.call.function`, "review call must be view or pure"))
      validateInvocationArguments(resource, `routes.${route.name}.review.call.args`, call.args, fn, issues)
    }
  }
  if (route.receipt !== undefined) {
    const matches = events.get(route.call.namespace)?.filter(event => event.name === route.receipt?.event)
    const event = matches?.length === 1 ? matches[0] : undefined
    const inputs = event?.inputs
    if (event === undefined || !Array.isArray(inputs) || event.anonymous !== undefined && event.anonymous !== false
      || inputs.some(input => !isRecordObject(input) || typeof input.type !== "string" || input.indexed === true && (input.type === "string" || input.type === "bytes" || input.type.startsWith("tuple") || input.type.includes("[")))
      || inspectAbiParameterNames(inputs).issues.length !== 0) {
      issues.push(routeAbiIssue(resource, `routes.${route.name}.receipt.event`, "receipt requires one nonanonymous ABI event with named, recoverable arguments"))
    }
    if (Array.isArray(inputs)) inputs.forEach((input, index) => {
      if (!isRecordObject(input)) return
      const path = `routes.${route.name}.receipt.event.inputs.${index}`
      canonicalAbiType(resource, path, input, "output", issues)
      if (input.indexed !== undefined && typeof input.indexed !== "boolean") issues.push(routeAbiIssue(resource, path, "event indexed must be boolean"))
    })
  }
  for (const [phase, invocation] of [["review", route.review?.then], ["receipt", route.receipt?.then], ["empty", route.receipt?.empty]] as const) {
    if (invocation === undefined) continue
    forEachString(invocation.args, `routes.${route.name}.${phase === "empty" ? "receipt.empty" : `${phase}.then`}.args`, (value, path) => {
      if (expressionReference(value)?.root !== "outputs") return
      if (transactionPresentationOutput(route, phase, functions, events, value) === undefined) issues.push(routeAbiIssue(resource, path, `transaction presentation references an unavailable output: ${value}`))
    })
  }
}

function validateInvocationArguments(resource: string, path: string, args: Record<string, unknown>, fn: AbiFunction, issues: CamConformanceIssue[]): void {
  diffNameSets({
    expectedNames: fn.inputs.map(input => input.name), actualNames: Object.keys(args),
    onUnexpected: name => { issues.push(routeAbiIssue(resource, `${path}.${name}`, `unexpected route argument: ${name}`)) },
    onMissing: name => { issues.push(routeAbiIssue(resource, `${path}.${name}`, `missing route argument: ${name}`)) },
  })
  for (const input of fn.inputs) {
    if (Object.hasOwn(args, input.name)) validateRouteArgValue(resource, `${path}.${input.name}`, input.name, args[input.name], input.abi, issues)
  }
}
