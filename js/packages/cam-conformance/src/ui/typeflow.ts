import {
  abiScalarKind,
  isExpressionIdentifier,
  UI_PROP_SCHEMAS,
  type UiPropTag,
  isRecordObject,
} from "@cam/protocol"

import {
  abiArgValueMismatches,
  abiOutputAtSegments,
  abiFunctionOutputForExpression,
  resolvedAbiFunction,
  type ContractFunctionsByNamespace,
} from "../abi/routes.ts"
import {
  expressionReference,
  staticString,
  staticStringList,
} from "../expressions/reference.ts"
import {
  conformanceIssue,
  type CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredRoute,
} from "../manifest/routes.ts"
import {
  diffNameSets,
} from "../names.ts"
import {
  forEachString,
} from "../walk.ts"
import type { RawUiDocuments } from "./resources.ts"

type AbiContext = ReadonlyMap<string, unknown>
type AbiLookup =
  | { readonly kind: "missing" }
  | { readonly kind: "unknown" }
  | { readonly kind: "value", readonly value: unknown }
type Scope = {
  readonly resource: string
  readonly nodes: Record<string, unknown>
  readonly routesByName: ReadonlyMap<string, DeclaredRoute>
  readonly functionsByNamespace: ContractFunctionsByNamespace
  readonly routeName: string
  readonly reported: Set<string>
  readonly issues: CamConformanceIssue[]
}
type ValueExpectation = "address" | "integer-or-string" | "string" | "string-or-string-array"
type ValueResolver = (value: unknown) => unknown | undefined
type IncludeSelection = {
  readonly names: readonly string[]
  readonly resolved: boolean
}
const UNKNOWN_VALUE = { type: "unknown" } as const

export function validateUiTypeflow({
  uiDocuments,
  routes,
  functionsByNamespace,
  issues,
}: {
  readonly uiDocuments: RawUiDocuments
  readonly routes: readonly DeclaredRoute[]
  readonly functionsByNamespace: ContractFunctionsByNamespace
  readonly issues: CamConformanceIssue[]
}): void {
  const routesByName = new Map(routes.map((route) => [route.name, route]))
  for (const [resource, ui] of uiDocuments) {
    for (const route of routes) {
      const scope = {
        resource,
        nodes: ui.nodes,
        routesByName,
        functionsByNamespace,
        routeName: route.name,
        reported: new Set<string>(),
        issues,
      }
      validateRouteTypeflow(scope, route, functionsByNamespace)
    }
  }
}

function validateRouteTypeflow(
  scope: Scope,
  route: DeclaredRoute,
  functionsByNamespace: ContractFunctionsByNamespace,
): void {
  if (route.kind !== "read") return

  const functions = functionsByNamespace.get(route.call.namespace)
  if (functions === undefined) return

  const fn = resolvedAbiFunction(route.call.function, functions)
  const nodeName = staticString(route.then.function)
  if (fn === undefined || nodeName === undefined) return

  // Typeflow follows runtime's concrete handoff: route outputs become named UI
  // args, and literal Includes pass a new typed arg set to the selected node.
  // When selectors resolve to literal call args, it walks those targets too.
  const context = contextForArgs(route.then.args, (value) => abiFunctionOutputForExpression(fn, value))
  const inputNames = routeInputNames(scope, nodeName, context)
  walkNamedNode(
    scope,
    nodeName,
    `nodes.${nodeName}`,
    context,
    inputNames,
    [],
  )
}

function walkNamedNode(
  scope: Scope,
  nodeName: string,
  path: string,
  context: AbiContext,
  inputNames: ReadonlySet<string>,
  stack: readonly string[],
): void {
  if (stack.includes(nodeName)) {
    reportTypeflowIssue(scope, path, `UI Include cycle detected: ${[...stack, nodeName].join(" -> ")}`)
    return
  }

  const node = scope.nodes[nodeName]
  if (!isRecordObject(node)) return

  walkNode(scope, node, path, context, inputNames, [...stack, nodeName])
}

function walkNode(
  scope: Scope,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
  inputNames: ReadonlySet<string>,
  stack: readonly string[],
): void {
  const tag = node.tag
  if (typeof tag !== "string") return

  validateProps(scope, tag, node, path, context)
  validateCall(scope, tag, node, path, context, inputNames, stack)

  if (!Array.isArray(node.children)) return
  node.children.forEach((child, index) => {
    if (isRecordObject(child)) {
      walkNode(scope, child, `${path}.children.${index}`, context, inputNames, stack)
    }
  })
}

function validateProps(
  scope: Scope,
  tag: string,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
): void {
  if (!isUiPropTag(tag) || !isRecordObject(node.props)) return

  for (const [name, value] of Object.entries(node.props)) {
    const expectation = propExpectation(tag, name)
    if (expectation !== undefined) {
      validateBoundValue(scope, `${path}.props.${name}`, `UI ${tag}.${name}`, value, expectation, context)
    }
  }
}

function validateCall(
  scope: Scope,
  tag: string,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
  inputNames: ReadonlySet<string>,
  stack: readonly string[],
): void {
  if (!isRecordObject(node.call)) return

  if (tag === "Action") {
    validateBoundValue(scope, `${path}.call.function`, "UI Action route", node.call.function, "string", context)
    validateKnownActionRoute(scope, path, node.call.function, node.call.args, context)
    if (isRecordObject(node.call.args)) {
      validateActionStateInputs(scope, path, node.call.args, inputNames)
    }
    return
  }

  if (tag !== "Include") return

  validateBoundValue(scope, `${path}.call.function`, "UI Include target", node.call.function, "string-or-string-array", context)
  const selection = includeSelection(node.call.function, context)
  if (selection === undefined) return

  if (selection.resolved) {
    if (!validateIncludeSelection(scope, `${path}.call.function`, selection.names)) return
  }
  if (!isRecordObject(node.call.args)) return

  for (const nodeName of selection.names) {
    const target = scope.nodes[nodeName]
    if (!isRecordObject(target)) {
      if (selection.resolved) {
        reportTypeflowIssue(scope, `${path}.call.function`, `UI Include calls unknown UI node: ${nodeName}`)
      }
      continue
    }

    if (selection.resolved) {
      validateNodeArgs(scope, `${path}.call.args`, target, nodeName, Object.keys(node.call.args))
    }

    walkNamedNode(
      scope,
      nodeName,
      `${path}.${nodeName}`,
      contextForArgs(node.call.args, (value) => valueFromExpression(value, context)),
      inputNames,
      stack,
    )
  }
}

function validateBoundValue(
  scope: Scope,
  path: string,
  label: string,
  value: unknown,
  expectation: ValueExpectation,
  context: AbiContext,
): void {
  if (typeof value !== "string") return

  const reference = expressionReference(value)
  if (reference === undefined) return

  const lookup = valueAtReference(reference.root, reference.segments, context)
  if (lookup.kind === "unknown") return
  if (lookup.kind === "missing") {
    reportTypeflowIssue(scope, path, `${label} references no ABI-backed value: ${value}`)
    return
  }

  if (!abiValueMatches(lookup.value, expectation)) {
    reportTypeflowIssue(
      scope,
      path,
      `${label} expects ${expectation}, but ABI provides ${abiTypeName(lookup.value)}`,
    )
  }
}

function contextForArgs(
  args: Record<string, unknown>,
  resolve: ValueResolver,
): AbiContext {
  const context = new Map<string, unknown>()
  for (const [name, value] of Object.entries(args)) {
    const resolved = knownValueShape(value, resolve)
    if (resolved !== undefined) context.set(name, resolved)
  }
  return context
}

function knownValueShape(value: unknown, resolve: ValueResolver): unknown | undefined {
  const resolved = resolve(value)
  if (resolved !== undefined) return resolved

  // Runtime merges literal call args into the UI context. Conformance should
  // reject deterministic literal mismatches while leaving true expressions as
  // unknown, because their runtime value is supplied by another context root.
  if (typeof value === "string") {
    if (expressionReference(value) !== undefined) return UNKNOWN_VALUE
    return { type: "literal-string", value }
  }

  if (typeof value === "boolean") return { type: "bool" }
  if (typeof value === "number") return { type: Number.isSafeInteger(value) ? "uint256" : "number" }
  if (value === null) return { type: "null" }

  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string" && expressionReference(item) === undefined)) {
      return { type: "literal-string[]", items: value }
    }
    const itemShapes = value.map((item) => knownValueShape(item, resolve))
    return itemShapes.some(isUnknownValue) ? UNKNOWN_VALUE : { type: "array" }
  }

  if (!isRecordObject(value)) return undefined

  const components = Object.entries(value).flatMap(([name, item]) => {
    const shape = knownValueShape(item, resolve)
    return isRecordObject(shape) ? [{ name, ...shape }] : []
  })

  return {
    type: "tuple",
    components,
  }
}

function valueFromExpression(value: unknown, context: AbiContext): unknown | undefined {
  if (typeof value !== "string") return undefined

  const reference = expressionReference(value)
  if (reference === undefined) return undefined

  const lookup = valueAtReference(reference.root, reference.segments, context)
  return lookup.kind === "value" ? lookup.value : undefined
}

function valueAtReference(root: string, segments: readonly string[], context: AbiContext): AbiLookup {
  const rootValue = context.get(root)
  if (rootValue === undefined) return { kind: "unknown" }
  if (isUnknownValue(rootValue)) return { kind: "unknown" }

  const value = valueAtSegments(rootValue, segments)
  if (isUnknownValue(value)) return { kind: "unknown" }
  return value === undefined ? { kind: "missing" } : { kind: "value", value }
}

function routeInputNames(scope: Scope, nodeName: string, context: AbiContext): ReadonlySet<string> {
  const inputNames = new Set<string>()
  collectRouteInputs(scope, nodeName, `nodes.${nodeName}`, context, [], inputNames)
  return inputNames
}

function collectRouteInputs(
  scope: Scope,
  nodeName: string,
  path: string,
  context: AbiContext,
  stack: readonly string[],
  inputNames: Set<string>,
): void {
  if (stack.includes(nodeName)) return

  const node = scope.nodes[nodeName]
  if (!isRecordObject(node)) return

  collectNodeInputs(scope, node, path, context, [...stack, nodeName], inputNames)
}

function collectNodeInputs(
  scope: Scope,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
  stack: readonly string[],
  inputNames: Set<string>,
): void {
  if (node.tag === "Action") return

  const inputName = resolvedInputName(scope, node, `${path}.props.name`, context)
  if (inputName !== undefined) {
    if (inputNames.has(inputName)) {
      reportTypeflowIssue(scope, `${path}.props.name`, `duplicate rendered Input name: ${inputName}`)
    }
    inputNames.add(inputName)
  }

  if (node.tag === "Include" && isRecordObject(node.call) && isRecordObject(node.call.args)) {
    const selection = includeSelection(node.call.function, context)
    if (selection !== undefined) {
      const nextContext = contextForArgs(node.call.args, (value) => valueFromExpression(value, context))
      for (const nodeName of selection.names) {
        collectRouteInputs(scope, nodeName, `${path}.${nodeName}`, nextContext, stack, inputNames)
      }
    }
  }

  if (Array.isArray(node.children)) {
    for (const [index, child] of node.children.entries()) {
      if (isRecordObject(child)) collectNodeInputs(scope, child, `${path}.children.${index}`, context, stack, inputNames)
    }
  }
}

function includeSelection(value: unknown, context: AbiContext): IncludeSelection | undefined {
  const staticNames = staticStringList(value)
  if (staticNames !== undefined) {
    return {
      names: staticNames,
      resolved: false,
    }
  }

  const names = knownSelectorNames(value, context)
  return names === undefined
    ? undefined
    : {
      names,
      resolved: true,
    }
}

function validateIncludeSelection(
  scope: Scope,
  path: string,
  names: readonly string[],
): boolean {
  let valid = true
  const seen = new Set<string>()
  for (const name of names) {
    if (name.length === 0) {
      reportTypeflowIssue(scope, path, "UI Include target must not be empty")
      valid = false
    } else if (seen.has(name)) {
      reportTypeflowIssue(scope, path, `UI Include target must not be duplicated: ${name}`)
      valid = false
    }
    seen.add(name)
  }

  return valid
}

function validateKnownActionRoute(
  scope: Scope,
  path: string,
  value: unknown,
  args: unknown,
  context: AbiContext,
): void {
  const staticRouteName = staticString(value)
  const routeName = staticRouteName === undefined ? knownActionRouteName(value, context) : staticRouteName
  if (routeName === undefined || !isRecordObject(args)) return

  const route = scope.routesByName.get(routeName)
  if (route === undefined) {
    if (staticRouteName === undefined) {
      reportTypeflowIssue(scope, `${path}.call.function`, `UI action calls unknown route: ${routeName}`)
    }
    return
  }

  if (staticRouteName === undefined) {
    validateExactNames({
      scope,
      path: `${path}.call.args`,
      expectedNames: route.inputs,
      actualNames: Object.keys(args),
      destination: `route ${route.name}`,
    })
  }
  validateActionRouteAbi(scope, path, route, args, context)
}

function knownActionRouteName(value: unknown, context: AbiContext): string | undefined {
  const names = knownSelectorNames(value, context)
  return names?.length === 1 ? names[0] : undefined
}

function validateActionRouteAbi(
  scope: Scope,
  path: string,
  route: DeclaredRoute,
  actionArgs: Record<string, unknown>,
  context: AbiContext,
): void {
  const functions = scope.functionsByNamespace.get(route.call.namespace)
  if (functions === undefined) return

  const fn = resolvedAbiFunction(route.call.function, functions)
  if (fn === undefined) return

  for (const input of fn.inputs) {
    if (!Object.hasOwn(route.call.args, input.name)) continue

    const resolved = actionValueForRouteCall(route.call.args[input.name], actionArgs, context)
    if (resolved === undefined) continue

    for (const mismatch of abiArgValueMismatches(input.name, resolved.value, input.abi)) {
      reportTypeflowIssue(scope, `${path}.call.args${resolved.pathSuffix}${mismatch.pathSuffix}`, mismatch.message)
    }
  }
}

function actionValueForRouteCall(
  routeArg: unknown,
  actionArgs: Record<string, unknown>,
  context: AbiContext,
): { readonly value: unknown, readonly pathSuffix: string } | undefined {
  if (typeof routeArg !== "string") return undefined

  const reference = expressionReference(routeArg)
  if (reference === undefined || reference.root !== "inputs") return undefined

  const actionValue = rawValueAtSegments(actionArgs, reference.segments)
  if (actionValue === undefined) return undefined

  const value = knownActionLiteral(actionValue, context)
  return value === undefined
    ? undefined
    : {
      value,
      pathSuffix: reference.segments.map((segment) => `.${segment}`).join(""),
    }
}

function knownActionLiteral(value: unknown, context: AbiContext): unknown | undefined {
  if (typeof value === "string") {
    const reference = expressionReference(value)
    if (reference === undefined) return staticString(value)

    const lookup = valueAtReference(reference.root, reference.segments, context)
    if (lookup.kind !== "value") return undefined
    return literalFromKnownValue(lookup.value)
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (Array.isArray(value)) {
    const items = value.map((item) => knownActionLiteral(item, context))
    return items.some((item) => item === undefined) ? undefined : items
  }
  if (!isRecordObject(value)) return undefined

  const record: Record<string, unknown> = {}
  for (const [name, item] of Object.entries(value)) {
    const resolved = knownActionLiteral(item, context)
    if (resolved === undefined) return undefined
    record[name] = resolved
  }
  return record
}

function literalFromKnownValue(value: unknown): unknown | undefined {
  if (!isRecordObject(value)) return undefined
  if (value.type === "literal-string" && typeof value.value === "string") return value.value
  if (
    value.type === "literal-string[]"
    && Array.isArray(value.items)
    && value.items.every((item) => typeof item === "string")
  ) {
    return value.items
  }

  return undefined
}

function knownSelectorNames(value: unknown, context: AbiContext): readonly string[] | undefined {
  if (typeof value !== "string") return undefined

  const reference = expressionReference(value)
  if (reference === undefined) return undefined

  const lookup = valueAtReference(reference.root, reference.segments, context)
  if (lookup.kind !== "value" || !isRecordObject(lookup.value)) return undefined

  if (lookup.value.type === "literal-string" && typeof lookup.value.value === "string") {
    return [lookup.value.value]
  }
  if (
    lookup.value.type === "literal-string[]"
    && Array.isArray(lookup.value.items)
    && lookup.value.items.every((item) => typeof item === "string")
  ) {
    return lookup.value.items
  }

  return undefined
}

function validateNodeArgs(
  scope: Scope,
  path: string,
  node: Record<string, unknown>,
  nodeName: string,
  actualNames: readonly string[],
): void {
  if (!Array.isArray(node.requires) || !node.requires.every((item) => typeof item === "string")) return

  validateExactNames({
    scope,
    path,
    expectedNames: node.requires,
    actualNames,
    destination: `UI node ${nodeName}`,
  })
}

function validateActionStateInputs(
  scope: Scope,
  path: string,
  args: Record<string, unknown>,
  inputNames: ReadonlySet<string>,
): void {
  forEachString(args, "", (value, suffix) => {
    const stateInput = referencedStateInput(value)
    if (stateInput === undefined) return

    const argPath = `${path}.call.args${suffix.length === 0 ? "" : `.${suffix}`}`
    if (stateInput.length === 0) {
      reportTypeflowIssue(scope, argPath, "UI action state expression must name an input")
      return
    }
    if (!inputNames.has(stateInput)) {
      reportTypeflowIssue(
        scope,
        argPath,
        `UI action references state without a matching route-local Input name: ${stateInput}`,
      )
    }
  })
}

function referencedStateInput(value: string): string | undefined {
  const reference = expressionReference(value)
  if (reference === undefined) return undefined

  const { root, segments } = reference
  const firstSegment = segments[0]
  if (root !== "state") return undefined
  if (firstSegment === undefined || !isExpressionIdentifier(firstSegment)) return ""
  return firstSegment
}

function resolvedInputName(
  scope: Scope,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
): string | undefined {
  if (node.tag !== "Input" || !isRecordObject(node.props)) return undefined

  const staticName = staticString(node.props.name)
  const name = staticName === undefined ? knownLiteralString(node.props.name, context) : staticName
  if (name === undefined) return undefined
  if (name.length === 0) {
    reportTypeflowIssue(scope, path, "Input name must not be empty")
    return undefined
  }
  if (!isExpressionIdentifier(name)) {
    reportTypeflowIssue(scope, path, `Input name must be an expression identifier: ${name}`)
    return undefined
  }

  return name
}

function knownLiteralString(value: unknown, context: AbiContext): string | undefined {
  if (typeof value !== "string") return undefined

  const reference = expressionReference(value)
  if (reference === undefined) return undefined

  const lookup = valueAtReference(reference.root, reference.segments, context)
  if (lookup.kind !== "value" || !isRecordObject(lookup.value)) return undefined
  return lookup.value.type === "literal-string" && typeof lookup.value.value === "string"
    ? lookup.value.value
    : undefined
}

function validateExactNames({
  scope,
  path,
  expectedNames,
  actualNames,
  destination,
}: {
  readonly scope: Scope
  readonly path: string
  readonly expectedNames: readonly string[]
  readonly actualNames: readonly string[]
  readonly destination: string
}): void {
  diffNameSets({
    expectedNames,
    actualNames,
    onUnexpected: (name) => {
      reportTypeflowIssue(scope, `${path}.${name}`, `unexpected UI call argument for ${destination}: ${name}`)
    },
    onMissing: (name) => {
      reportTypeflowIssue(scope, `${path}.${name}`, `missing UI call argument for ${destination}: ${name}`)
    },
  })
}

function valueAtSegments(value: unknown, segments: readonly string[]): unknown | undefined {
  const [segment, ...rest] = segments
  if (segment === undefined || isUnknownValue(value)) return value

  const nextValue = abiOutputAtSegments(value, [segment])
  return nextValue === undefined ? undefined : valueAtSegments(nextValue, rest)
}

function rawValueAtSegments(value: unknown, segments: readonly string[]): unknown | undefined {
  const [segment, ...rest] = segments
  if (segment === undefined) return value
  if (Array.isArray(value) && isArrayIndex(segment)) {
    return rawValueAtSegments(value[Number(segment)], rest)
  }
  if (isRecordObject(value) && Object.hasOwn(value, segment)) {
    return rawValueAtSegments(value[segment], rest)
  }

  return undefined
}

function isArrayIndex(value: string): boolean {
  return value === "0" || /^[1-9][0-9]*$/.test(value)
}

function propExpectation(tag: UiPropTag, prop: string): ValueExpectation | undefined {
  if (tag === "Address" && prop === "address") return "address"
  if (tag === "Nft" && prop === "contractAddress") return "address"
  if (tag === "Nft" && prop === "tokenId") return "integer-or-string"
  if ((UI_PROP_SCHEMAS[tag].string as readonly string[]).includes(prop)) return "string"
  return undefined
}

function abiValueMatches(value: unknown, expectation: ValueExpectation): boolean {
  const type = abiType(value)
  switch (expectation) {
    case "address":
      return type === "address" || type === "literal-string"
    case "integer-or-string":
      return type === "integer" || type === "string" || type === "literal-string"
    case "string":
      return type === "string" || type === "literal-string"
    case "string-or-string-array":
      return type === "string" || type === "string-array" || type === "literal-string" || type === "literal-string-array"
  }
}

function abiType(value: unknown): string {
  if (!isRecordObject(value) || typeof value.type !== "string") return "unknown"

  const type = value.type
  if (type === "literal-string") return type
  if (type === "literal-string[]") return "literal-string-array"
  if (type === "address" || type === "string" || type === "bool" || type === "bytes" || type === "tuple") return type
  const scalarKind = abiScalarKind(type)
  if (scalarKind === "integer") return "integer"
  if (scalarKind === "fixed-bytes") return "bytes"
  if (type === "string[]") return "string-array"
  if (type.endsWith("[]")) return "array"
  return type
}

function abiTypeName(value: unknown): string {
  if (isRecordObject(value) && typeof value.type === "string") return value.type
  return "unknown"
}

function isUnknownValue(value: unknown): boolean {
  return isRecordObject(value) && value.type === UNKNOWN_VALUE.type
}

function isUiPropTag(value: string): value is UiPropTag {
  return Object.hasOwn(UI_PROP_SCHEMAS, value)
}

function reportTypeflowIssue(scope: Scope, path: string, message: string): void {
  const key = `${path}\0${message}`
  if (scope.reported.has(key)) return

  scope.reported.add(key)
  scope.issues.push(typeflowIssue(scope.resource, path, `route ${scope.routeName}: ${message}`))
}

function typeflowIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: "CAM_UI_TYPEFLOW_MISMATCH",
    resource,
    path,
    message,
  })
}
