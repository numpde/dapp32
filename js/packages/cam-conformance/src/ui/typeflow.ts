import {
  abiDynamicArrayElementType,
  isAbiAddressValue,
  abiScalarKind,
  isExpressionIdentifier,
  isUiPropElement,
  nameListShapeIssues,
  UI_PROP_SCHEMAS,
  type UiPropElement,
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
  expressionSyntaxError,
  staticString,
  staticStringList,
} from "../expressions/reference.ts"
import {
  isKnownStaticStringValue,
  knownStaticStringValue,
  knownRouteCallPathSuffix,
  knownRouteCallSource,
  knownRouteCallValue,
  type KnownRouteCallValue,
  UNKNOWN_ROUTE_CALL_VALUE,
} from "../expressions/known-route-call.ts"
import {
  conformanceIssue,
  type CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredRoute,
} from "../manifest/routes.ts"
import {
  forEachString,
  rawValueAtSegments,
} from "../walk.ts"
import type { DeclaredUiDocument } from "./resources.ts"
import {
  UI_CALL_RULES,
  validateExpectedArgumentNames,
  validateKnownCallTargets,
} from "./calls.ts"

type AbiContext = ReadonlyMap<string, unknown>
type AbiLookup =
  | { readonly kind: "missing" }
  | { readonly kind: "unknown" }
  | { readonly kind: "value", readonly value: unknown }
type KnownSelectorInfo = {
  readonly names: readonly string[]
  readonly hasUnknown: boolean
}
type Scope = {
  readonly resource: string
  readonly nodes: Record<string, unknown>
  readonly routesByName: ReadonlyMap<string, DeclaredRoute>
  readonly functionsByNamespace: ContractFunctionsByNamespace
  readonly routeName: string
  readonly reported: Set<string>
  readonly issues: CamConformanceIssue[]
}
type RouteInputs = {
  readonly names: ReadonlySet<string>
  readonly hasUnknown: boolean
}
type RouteInputCollector = {
  readonly names: Set<string>
  hasUnknown: boolean
}
type ValueExpectation = "address" | "integer-or-string" | "string" | "string-or-string-array"
type ValueResolver = (value: unknown) => unknown | undefined
type IncludeSelection = {
  readonly names: readonly string[]
  readonly hasUnknown: boolean
  readonly resolved: boolean
}
const UNKNOWN_VALUE = { type: "unknown", value: UNKNOWN_ROUTE_CALL_VALUE } as const

export function validateUiTypeflow({
  uiDocument,
  routes,
  functionsByNamespace,
  issues,
}: {
  readonly uiDocument: DeclaredUiDocument | undefined
  readonly routes: readonly DeclaredRoute[]
  readonly functionsByNamespace: ContractFunctionsByNamespace
  readonly issues: CamConformanceIssue[]
}): void {
  if (uiDocument === undefined) return

  const routesByName = new Map(routes.map((route) => [route.name, route]))
  // Route-local validation is critical: the same UI graph can be rendered from
  // multiple route outputs, and each route declares a different argument
  // context. We must validate each route independently so unresolved or missing
  // state/input bindings are surfaced at the correct workflow boundary.
  for (const route of routes) {
    const scope = {
      resource: uiDocument.resource,
      nodes: uiDocument.document.nodes,
      routesByName,
      functionsByNamespace,
      routeName: route.name,
      reported: new Set<string>(),
      issues,
    }
    validateRouteTypeflow(scope, route)
  }
}

function validateRouteTypeflow(
  scope: Scope,
  route: DeclaredRoute,
): void {
  if (route.kind !== "read") return

  const functions = scope.functionsByNamespace.get(route.call.namespace)
  if (functions === undefined) return

  const fn = resolvedAbiFunction(route.call.function, functions)
  const nodeName = staticString(route.then.function)
  if (fn === undefined || nodeName === undefined) return

  // Typeflow follows declared handoffs only where values are ABI-known or
  // literal: route outputs become named UI args, and literal Includes pass a new
  // typed arg set to the selected node.
  const context = contextForArgs(route.then.args, (value) => abiFunctionOutputForExpression(fn, value))
  validateRouteRootCardinality(scope, nodeName, context)
  const routeInputs = routeInputNames(scope, nodeName, context)
  walkNamedNode(
    scope,
    nodeName,
    `nodes.${nodeName}`,
    context,
    routeInputs,
    [],
    true,
  )
}

function walkNamedNode(
  scope: Scope,
  nodeName: string,
  path: string,
  context: AbiContext,
  routeInputs: RouteInputs,
  stack: readonly string[],
  allowRecurse: boolean,
): void {
  visitNamedUiNode(scope, nodeName, path, stack, allowRecurse, (node, nextStack, nextAllowRecurse) => {
    walkNode(
      scope,
      node,
      path,
      context,
      routeInputs,
      nextStack,
      nextAllowRecurse,
    )
  })
}

function walkNode(
  scope: Scope,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
  routeInputs: RouteInputs,
  stack: readonly string[],
  allowRecurse: boolean,
): void {
  const element = node.element
  if (typeof element !== "string") return

  validateProps(scope, element, node, path, context)
  validateStateBinding(scope, element, node, path, context)
  validateCall(scope, element, node, path, context, routeInputs, stack, allowRecurse)

  if (!Array.isArray(node.children)) return
  node.children.forEach((child, index) => {
    if (isRecordObject(child)) {
      walkNode(scope, child, `${path}.children.${index}`, context, routeInputs, stack, allowRecurse)
    }
  })
}

function validateProps(
  scope: Scope,
  element: string,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
): void {
  if (!isUiPropElement(element) || !isRecordObject(node.props)) return

  for (const [name, value] of Object.entries(node.props)) {
    const expectation = propExpectation(element, name)
    if (expectation !== undefined) {
      validateLiteralPropValue(scope, `${path}.props.${name}`, element, name, value, expectation)
      validateBoundValue(scope, `${path}.props.${name}`, `UI ${element}.${name}`, value, expectation, context)
    }
  }
}

function validateLiteralPropValue(
  scope: Scope,
  path: string,
  element: string,
  prop: string,
  value: unknown,
  expectation: ValueExpectation,
): void {
  if (expectation !== "address") return

  const literal = staticString(value)
  if (literal === undefined) return
  if (isAbiAddressValue(literal)) return

  // Literal address props are concrete publication values; dynamic route data
  // is validated later when it becomes concrete.
  reportTypeflowIssue(scope, path, `UI ${element}.${prop} expects address, but literal is not an address`)
}

function validateStateBinding(
  scope: Scope,
  element: string,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
): void {
  if (element !== "TextField" || !isRecordObject(node.state)) return

  // TextField defaults have a renderer contract; this rejects only literal or
  // ABI-known non-string defaults.
  const value = node.state.defaultValue
  const valuePath = `${path}.state.defaultValue`
  if (typeof value === "string") {
    validateBoundValue(scope, valuePath, "TextField state.defaultValue", value, "string", context)
    return
  }

  const known = knownValueShape(value, (item) => valueFromExpression(item, context))
  if (known === undefined || isUnknownValue(known) || abiValueMatches(known, "string")) return

  reportTypeflowIssue(
    scope,
    valuePath,
    `TextField state.defaultValue expects string, but value is ${abiTypeName(known)}`,
  )
}

function validateCall(
  scope: Scope,
  element: string,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
  routeInputs: RouteInputs,
  stack: readonly string[],
  allowRecurse: boolean,
): void {
  if (!isRecordObject(node.call)) return
  if (isRecordObject(node.call.args)) {
    validateCallArgReferences(scope, path, node.call.args, context)
  }

  if (element === "Button") {
    validateBoundValue(scope, `${path}.call.function`, "UI Button route", node.call.function, "string", context)
    validateKnownActionRoute(scope, path, node.call.function, node.call.args, context)
    if (isRecordObject(node.call.args)) {
      validateActionStateInputs(scope, path, node.call.args, routeInputs)
    }
    return
  }

  if (element !== "Include") return

  validateBoundValue(scope, `${path}.call.function`, "UI Include target", node.call.function, "string-or-string-array", context)
  const selection = includeSelection(node.call.function, context)
  if (selection === undefined) return

  if (selection.resolved) {
    if (!validateIncludeSelection(scope, `${path}.call.function`, selection)) return
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

    if (allowRecurse) {
      walkNamedNode(
        scope,
        nodeName,
        `${path}.${nodeName}`,
        contextForArgs(node.call.args, (value) => valueFromExpression(value, context)),
        routeInputs,
        stack,
        true,
      )
    }
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

  if (isInvalidAddressLiteral(lookup.value, expectation)) {
    reportTypeflowIssue(scope, path, `${label} expects address, but literal is not an address`)
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

function validateCallArgReferences(
  scope: Scope,
  path: string,
  args: Record<string, unknown>,
  context: AbiContext,
): void {
  // Missing fields on known route-local values are deterministic author errors;
  // genuinely unknown roots stay dynamic.
  forEachString(args, "", (value, suffix) => {
    const reference = expressionReference(value)
    if (reference === undefined) return
    if (expressionSyntaxError(value) !== undefined) return

    const lookup = valueAtReference(reference.root, reference.segments, context)
    if (lookup.kind !== "missing") return

    const argPath = callArgPath(path, suffix)
    reportTypeflowIssue(scope, argPath, `UI call argument references no known value: ${value}`)
  })
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

  // This is the typeflow proof boundary: preserve known literal/ABI leaves,
  // mark true expressions unknown, and avoid a second runtime evaluator.
  if (typeof value === "string") {
    const literal = staticString(value)
    return literal === undefined ? UNKNOWN_VALUE : { type: "literal-string", value: literal }
  }

  if (typeof value === "boolean") return { type: "bool", value }
  if (typeof value === "number") return { type: Number.isSafeInteger(value) ? "uint256" : "number", value }
  if (value === null) return { type: "null", value }

  if (Array.isArray(value)) {
    const literalItems = value.map((item) => staticString(item))
    if (literalItems.every((item): item is string => item !== undefined)) {
      return {
        type: "literal-string[]",
        items: literalItems,
      }
    }

    // Preserve every child element and mark only that element unknown so
    // partially-known aggregates can still be validated at route boundaries.
    return {
      type: "array",
      items: value.map((item) => {
        const shape = knownValueShape(item, resolve)
        return shape === undefined ? UNKNOWN_VALUE : shape
      }),
    }
  }

  if (!isRecordObject(value)) return undefined

  const components = Object.entries(value).map(([name, item]) => {
    const shape = knownValueShape(item, resolve)
    const knownShape = isRecordObject(shape) ? shape : UNKNOWN_VALUE
    // Literal object field names define the UI context shape. A child may be an
    // ABI output with its own name, but that name is provenance, not this field.
    return { ...knownShape, name }
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

function routeInputNames(scope: Scope, nodeName: string, context: AbiContext): RouteInputs {
  const collector = {
    names: new Set<string>(),
    hasUnknown: false,
  }
  collectRouteInputs(scope, nodeName, `nodes.${nodeName}`, context, [], collector, true)
  return collector
}

function collectRouteInputs(
  scope: Scope,
  nodeName: string,
  path: string,
  context: AbiContext,
  stack: readonly string[],
  inputs: RouteInputCollector,
  allowRecurse: boolean,
): void {
  visitNamedUiNode(scope, nodeName, path, stack, allowRecurse, (node, nextStack, nextAllowRecurse) => {
    collectNodeInputs(scope, node, path, context, nextStack, inputs, nextAllowRecurse)
  })
}

function visitNamedUiNode(
  scope: Scope,
  nodeName: string,
  path: string,
  stack: readonly string[],
  allowRecurse: boolean,
  visit: (
    node: Record<string, unknown>,
    nextStack: readonly string[],
    nextAllowRecurse: boolean,
  ) => void,
): void {
  const node = scope.nodes[nodeName]
  if (!isRecordObject(node)) return

  // The typewalk and input collector must share this cycle contract: validate
  // the revisited node's local surface, but stop deeper Include recursion.
  const inCycle = stack.includes(nodeName)
  if (inCycle) {
    reportTypeflowIssue(scope, path, `UI Include cycle detected: ${[...stack, nodeName].join(" -> ")}`)
  }

  visit(node, inCycle ? stack : [...stack, nodeName], allowRecurse && !inCycle)
}

function collectNodeInputs(
  scope: Scope,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
  stack: readonly string[],
  inputs: RouteInputCollector,
  allowRecurse: boolean,
): void {
  if (node.element === "Button") return

  const inputName = resolvedInputName(scope, node, `${path}.state.key`, context)
  if (inputName !== undefined) {
    if (inputs.names.has(inputName)) {
      reportTypeflowIssue(scope, `${path}.state.key`, `duplicate rendered TextField state key: ${inputName}`)
    }
    inputs.names.add(inputName)
  }

  if (node.element === "Include" && allowRecurse && isRecordObject(node.call) && isRecordObject(node.call.args)) {
    const selection = includeSelection(node.call.function, context)
    if (selection !== undefined) {
      if (selection.hasUnknown) inputs.hasUnknown = true
      const nextContext = contextForArgs(node.call.args, (value) => valueFromExpression(value, context))
      for (const nodeName of selection.names) {
        collectRouteInputs(scope, nodeName, `${path}.${nodeName}`, nextContext, stack, inputs, allowRecurse)
      }
    } else {
      // An unresolved Include selector may render a TextField. State-reference
      // checks must not claim absence once the route-local input set is open.
      inputs.hasUnknown = true
    }
  }

  if (Array.isArray(node.children)) {
    for (const [index, child] of node.children.entries()) {
      if (isRecordObject(child)) {
        collectNodeInputs(scope, child, `${path}.children.${index}`, context, stack, inputs, allowRecurse)
      }
    }
  }
}

function includeSelection(value: unknown, context: AbiContext): IncludeSelection | undefined {
  const staticNames = staticStringList(value)
  if (staticNames !== undefined) {
    return {
      names: staticNames,
      hasUnknown: false,
      resolved: false,
    }
  }

  const selectorNames = knownSelectorNames(value, context)
  if (selectorNames === undefined) return undefined
  if (!selectorNames.hasUnknown && selectorNames.names.length === 0) return undefined

  return {
    names: selectorNames.names,
    hasUnknown: selectorNames.hasUnknown,
    resolved: true,
  }
}

function validateRouteRootCardinality(scope: Scope, nodeName: string, context: AbiContext): void {
  const node = scope.nodes[nodeName]
  if (!isRecordObject(node) || node.element !== "Include" || !isRecordObject(node.call)) return

  const selection = includeSelection(node.call.function, context)
  if (selection === undefined || selection.hasUnknown || selection.names.length === 1) return
  if (hasInvalidSelectionNames(selection.names)) return
  if (selection.names.some((name) => !isRecordObject(scope.nodes[name]))) return

  // A route render must resolve to one UI root. This only fires when Include
  // selection is deterministic and all selected nodes exist.
  reportTypeflowIssue(scope, `nodes.${nodeName}.call.function`, "route root UI node must resolve to exactly one node")
}

function hasInvalidSelectionNames(names: readonly string[]): boolean {
  return nameListShapeIssues(names).length > 0
}

function validateIncludeSelection(
  scope: Scope,
  path: string,
  selection: IncludeSelection,
): boolean {
  return validateKnownCallTargets({
    resource: scope.resource,
    path,
    label: "UI Include",
    names: selection.names,
    issues: scope.issues,
    rule: UI_CALL_RULES.CAM_UI_TYPEFLOW_MISMATCH,
  })
}

function validateKnownActionRoute(
  scope: Scope,
  path: string,
  value: unknown,
  args: unknown,
  context: AbiContext,
): void {
  // Static or ABI-known Button routes must name declared routes with the target
  // route's inputs. Unknown dynamic selectors are skipped.
  const staticRouteName = staticString(value)
  if (staticRouteName !== undefined && staticRouteName.length === 0) {
    reportTypeflowIssue(scope, `${path}.call.function`, "UI Button route target must not be empty")
    return
  }

  const routeName = staticRouteName === undefined ? knownActionRouteName(scope, path, value, context) : staticRouteName
  if (routeName === undefined || !isRecordObject(args)) return

  const route = scope.routesByName.get(routeName)
  if (route === undefined) {
    reportTypeflowIssue(scope, `${path}.call.function`, `UI Button calls unknown route: ${routeName}`)
    return
  }

  validateExpectedArgumentNames({
    resource: scope.resource,
    path: `${path}.call.args`,
    expectedNames: route.inputs,
    actualNames: Object.keys(args),
    destination: `route ${route.name}`,
    issues: scope.issues,
    rule: UI_CALL_RULES.CAM_UI_TYPEFLOW_MISMATCH,
    filterEmptyActualNames: true,
  })
  validateActionRouteAbi(scope, path, route, args, context)
}

function knownActionRouteName(
  scope: Scope,
  path: string,
  value: unknown,
  context: AbiContext,
): string | undefined {
  const names = knownSelectorNames(value, context)
  if (names === undefined || names.hasUnknown || names.names.length !== 1) return undefined
  if (names.names[0].length === 0) {
    reportTypeflowIssue(scope, `${path}.call.function`, "UI Button route target must not be empty")
    return undefined
  }
  return names.names[0]
}

function validateActionRouteAbi(
  scope: Scope,
  path: string,
  route: DeclaredRoute,
  actionArgs: Record<string, unknown>,
  context: AbiContext,
): void {
  // Known Button action args are joined to the target route ABI; concrete
  // state/account values remain for simulation or send-time validation.
  const functions = scope.functionsByNamespace.get(route.call.namespace)
  if (functions === undefined) return

  const fn = resolvedAbiFunction(route.call.function, functions)
  if (fn === undefined) return

  for (const input of fn.inputs) {
    if (!Object.hasOwn(route.call.args, input.name)) continue

    const resolved = actionValueForRouteCall(route.call.args[input.name], actionArgs, context)
    if (resolved === undefined) continue

    for (const mismatch of abiArgValueMismatches(input.name, resolved.value, input.abi)) {
      const inputPath = actionPathForMismatch(resolved, mismatch.pathSuffix)
      if (inputPath === undefined) continue
      reportTypeflowIssue(
        scope,
        `${path}.call.args${inputPath}`,
        mismatch.message,
      )
    }
  }
}

function actionPathForMismatch(value: KnownRouteCallValue, pathSuffix: string): string | undefined {
  const source = knownRouteCallSource(value, pathSuffix)
  return source.owner === "input" ? source.pathSuffix : undefined
}

function actionValueForRouteCall(
  routeArg: unknown,
  actionArgs: Record<string, unknown>,
  context: AbiContext,
): KnownRouteCallValue | undefined {
  return knownRouteCallValue(routeArg, (segments) => {
    const actionValue = rawValueAtSegments(actionArgs, segments)
    if (actionValue === undefined) return undefined

    const literal = knownActionLiteral(actionValue, context)
    return literal === undefined
      ? undefined
      : {
        value: literal,
        pathSuffix: knownRouteCallPathSuffix(segments),
      }
  })
}

function knownActionLiteral(value: unknown, context: AbiContext): unknown | undefined {
  if (typeof value === "string") {
    const reference = expressionReference(value)
    if (reference === undefined) return knownStaticStringValue(value)

    const lookup = valueAtReference(reference.root, reference.segments, context)
    if (lookup.kind !== "value") return UNKNOWN_ROUTE_CALL_VALUE
    return literalFromKnownValue(lookup.value)
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") return value
  if (Array.isArray(value)) {
    return value.map((item) => knownOrUnknown(knownActionLiteral(item, context)))
  }
  if (!isRecordObject(value)) return undefined

  const record: Record<string, unknown> = {}
  for (const [name, item] of Object.entries(value)) {
    record[name] = knownOrUnknown(knownActionLiteral(item, context))
  }
  return record
}

function literalFromKnownValue(value: unknown): unknown | undefined {
  if (isUnknownValue(value)) return UNKNOWN_ROUTE_CALL_VALUE
  if (!isRecordObject(value)) return undefined
  const literalString = literalStringValue(value)
  if (literalString !== undefined) return knownStaticStringValue(literalString)
  if (
    (value.type === "bool" || value.type === "uint256" || value.type === "number" || value.type === "null")
    && Object.hasOwn(value, "value")
  ) {
    return value.value
  }
  const literalStrings = literalStringArrayValue(value)
  if (literalStrings !== undefined) return literalStrings
  if (value.type === "array" && Array.isArray(value.items)) {
    return value.items.map((item) => knownOrUnknown(literalFromKnownValue(item)))
  }
  if (value.type === "tuple" && Array.isArray(value.components)) {
    const record: Record<string, unknown> = {}
    for (const component of value.components) {
      if (!isRecordObject(component) || typeof component.name !== "string") return undefined
      record[component.name] = knownOrUnknown(literalFromKnownValue(component))
    }
    return record
  }

  return undefined
}

function knownOrUnknown(value: unknown | undefined): unknown {
  return value === undefined ? UNKNOWN_ROUTE_CALL_VALUE : value
}

function knownSelectorNames(value: unknown, context: AbiContext): KnownSelectorInfo | undefined {
  if (Array.isArray(value)) {
    return knownSelectorArrayNames(value, context)
  }
  if (typeof value !== "string") return undefined

  const reference = expressionReference(value)
  if (reference === undefined) return undefined

  const lookup = valueAtReference(reference.root, reference.segments, context)
  if (lookup.kind !== "value" || !isRecordObject(lookup.value)) return undefined

  const literalString = literalStringValue(lookup.value)
  if (literalString !== undefined) {
    return {
      names: [literalString],
      hasUnknown: false,
    }
  }
  const literalStrings = literalStringArrayValue(lookup.value)
  if (literalStrings !== undefined) {
    return {
      names: literalStrings,
      hasUnknown: false,
    }
  }
  if (lookup.value.type === "array" && Array.isArray(lookup.value.items)) {
    const names: string[] = []
    let hasUnknown = false
    for (const item of lookup.value.items) {
      if (isUnknownValue(item)) {
        hasUnknown = true
      } else if (isRecordObject(item)) {
        const literalString = literalStringValue(item)
        if (literalString === undefined) {
          hasUnknown = true
        } else {
          names.push(literalString)
        }
      } else if (typeof item === "string") {
        names.push(item)
      } else {
        hasUnknown = true
      }
    }

    return {
      names,
      hasUnknown,
    }
  }

  return undefined
}

function knownSelectorArrayNames(
  values: readonly unknown[],
  context: AbiContext,
): KnownSelectorInfo {
  const names: string[] = []
  let hasUnknown = false
  for (const item of values) {
    const staticItem = staticString(item)
    if (staticItem !== undefined) {
      names.push(staticItem)
      continue
    }

    if (typeof item === "string") {
      const reference = expressionReference(item)
      if (reference !== undefined) {
        const lookup = valueAtReference(reference.root, reference.segments, context)
        if (lookup.kind === "value") {
          const child = valueToSelectorNames(lookup.value)
          names.push(...child.names)
          hasUnknown = hasUnknown || child.hasUnknown
          continue
        }
      }
    }
    hasUnknown = true
  }
  return { names, hasUnknown }
}

function valueToSelectorNames(value: unknown): KnownSelectorInfo {
  if (isUnknownValue(value)) return { names: [], hasUnknown: true }
  if (typeof value === "string") return { names: [value], hasUnknown: false }
  if (isRecordObject(value)) {
    const literalString = literalStringValue(value)
    if (literalString !== undefined) return { names: [literalString], hasUnknown: false }

    const literalStrings = literalStringArrayValue(value)
    if (literalStrings !== undefined) return { names: literalStrings, hasUnknown: false }

    if (value.type === "array" && Array.isArray(value.items)) {
      const names: string[] = []
      let hasUnknown = false
      for (const item of value.items) {
        const child = valueToSelectorNames(item)
        names.push(...child.names)
        hasUnknown = hasUnknown || child.hasUnknown
      }
      return { names, hasUnknown }
    }
  }

  return { names: [], hasUnknown: true }
}

function validateNodeArgs(
  scope: Scope,
  path: string,
  node: Record<string, unknown>,
  nodeName: string,
  actualNames: readonly string[],
): void {
  if (!Array.isArray(node.requires) || !node.requires.every((item) => typeof item === "string")) return

  validateExpectedArgumentNames({
    resource: scope.resource,
    path,
    expectedNames: node.requires,
    actualNames,
    destination: `UI node ${nodeName}`,
    issues: scope.issues,
    rule: UI_CALL_RULES.CAM_UI_TYPEFLOW_MISMATCH,
    filterEmptyActualNames: true,
  })
}

function validateActionStateInputs(
  scope: Scope,
  path: string,
  args: Record<string, unknown>,
  routeInputs: RouteInputs,
): void {
  // A Button that references $state.foo needs a rendered route-local TextField
  // for foo.
  forEachString(args, "", (value, suffix) => {
    const stateInput = referencedStateInput(value)
    if (stateInput === undefined) return

    const argPath = callArgPath(path, suffix)
    if (stateInput.length === 0) {
      reportTypeflowIssue(scope, argPath, "UI Button state expression must name an input")
      return
    }
    if (!routeInputs.names.has(stateInput)) {
      if (routeInputs.hasUnknown) return
      reportTypeflowIssue(
        scope,
        argPath,
        `UI Button references state without a matching route-local TextField state key: ${stateInput}`,
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

function callArgPath(nodePath: string, suffix: string): string {
  return `${nodePath}.call.args${suffix.length === 0 ? "" : `.${suffix}`}`
}

function resolvedInputName(
  scope: Scope,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
): string | undefined {
  if (node.element !== "TextField" || !isRecordObject(node.state)) return undefined

  const staticName = staticString(node.state.key)
  const name = staticName === undefined ? knownLiteralString(node.state.key, context) : staticName
  if (name === undefined) return undefined
  if (name.length === 0) {
    reportTypeflowIssue(scope, path, "TextField state key must not be empty")
    return undefined
  }
  if (!isExpressionIdentifier(name)) {
    reportTypeflowIssue(scope, path, `TextField state key must be an expression identifier: ${name}`)
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
  return literalStringValue(lookup.value)
}

function literalStringValue(value: Record<string, unknown>): string | undefined {
  // These are typeflow-local facts produced by knownValueShape, not UI schema
  // fields. Keep decoding narrow to avoid a second schema.
  return value.type === "literal-string" && typeof value.value === "string" ? value.value : undefined
}

function literalStringArrayValue(value: Record<string, unknown>): readonly string[] | undefined {
  return value.type === "literal-string[]"
    && Array.isArray(value.items)
    && value.items.every((item) => typeof item === "string")
    ? value.items
    : undefined
}

function valueAtSegments(value: unknown, segments: readonly string[]): unknown | undefined {
  const [segment, ...rest] = segments
  if (segment === undefined || isUnknownValue(value)) return value

  const nextValue = abiOutputAtSegments(value, [segment])
  return nextValue === undefined ? undefined : valueAtSegments(nextValue, rest)
}

function propExpectation(element: UiPropElement, prop: string): ValueExpectation | undefined {
  if ((UI_PROP_SCHEMAS[element].address as readonly string[]).includes(prop)) return "address"
  if (element === "Nft" && prop === "tokenId") return "integer-or-string"
  if ((UI_PROP_SCHEMAS[element].string as readonly string[]).includes(prop)) return "string"
  return undefined
}

function isInvalidAddressLiteral(value: unknown, expectation: ValueExpectation): boolean {
  if (expectation !== "address") return false

  const literal = isKnownStaticStringValue(value)
    ? value.value
    : isRecordObject(value)
      ? literalStringValue(value)
      : undefined
  if (literal === undefined) return false

  // Literal strings are concrete publication values. Once one flows into an
  // address prop, conformance should reject invalid addresses.
  return !isAbiAddressValue(literal)
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
  if (isKnownStaticStringValue(value)) return "literal-string"
  if (!isRecordObject(value) || typeof value.type !== "string") return "unknown"

  const type = value.type
  if (type === "literal-string") return type
  if (type === "literal-string[]") return "literal-string-array"
  if (type === "address" || type === "string" || type === "bool" || type === "bytes" || type === "tuple") return type
  const scalarKind = abiScalarKind(type)
  if (scalarKind === "integer") return "integer"
  if (scalarKind === "fixed-bytes") return "bytes"
  if (type === "string[]") return "string-array"
  if (abiDynamicArrayElementType(type) !== undefined) return "array"
  return type
}

function abiTypeName(value: unknown): string {
  if (isKnownStaticStringValue(value)) return "literal-string"
  if (isRecordObject(value) && typeof value.type === "string") return value.type
  return "unknown"
}

function isUnknownValue(value: unknown): boolean {
  return value === UNKNOWN_ROUTE_CALL_VALUE
    || (isRecordObject(value) && value.type === UNKNOWN_VALUE.type && value.value === UNKNOWN_ROUTE_CALL_VALUE)
}

function reportTypeflowIssue(scope: Scope, path: string, message: string): void {
  const key = `${scope.routeName}\0${path}\0${message}`
  if (scope.reported.has(key)) return

  scope.reported.add(key)
  scope.issues.push(typeflowIssue(scope.resource, path, `route ${scope.routeName}: ${message}`))
}

function typeflowIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: UI_CALL_RULES.CAM_UI_TYPEFLOW_MISMATCH,
    resource,
    path,
    message,
  })
}
