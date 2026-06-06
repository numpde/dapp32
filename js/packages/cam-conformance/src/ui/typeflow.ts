import {
  abiScalarKind,
  UI_PROP_SCHEMAS,
  type UiPropTag,
  isRecordObject,
} from "@cam/protocol"

import {
  abiOutputAtSegments,
  abiFunctionOutputForExpression,
  resolvedAbiFunction,
  type ContractFunctionsByNamespace,
} from "../abi/routes.ts"
import {
  expressionReference,
} from "../expressions/reference.ts"
import {
  conformanceIssue,
  type CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredRoute,
} from "../manifest/routes.ts"
import type { RawUiDocuments } from "./resources.ts"

type AbiContext = ReadonlyMap<string, unknown>
type AbiLookup =
  | { readonly kind: "missing" }
  | { readonly kind: "unknown" }
  | { readonly kind: "value", readonly value: unknown }
type Scope = {
  readonly resource: string
  readonly nodes: Record<string, unknown>
  readonly issues: CamConformanceIssue[]
}
type ValueExpectation = "address" | "integer-or-string" | "string" | "string-or-string-array"

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
  for (const [resource, ui] of uiDocuments) {
    const scope = { resource, nodes: ui.nodes, issues }
    for (const route of routes) {
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
  const nodeName = literalFunctionName(route.then.function)
  if (fn === undefined || nodeName === undefined) return

  // Typeflow follows runtime's concrete handoff: route outputs become named UI
  // args, and literal Includes pass a new typed arg set to the selected node.
  // Dynamic Include targets are checked for selector type only.
  walkNamedNode(
    scope,
    nodeName,
    `nodes.${nodeName}`,
    contextForArgs(route.then.args, (value) => abiFunctionOutputForExpression(fn, value)),
    [],
  )
}

function walkNamedNode(
  scope: Scope,
  nodeName: string,
  path: string,
  context: AbiContext,
  stack: readonly string[],
): void {
  if (stack.includes(nodeName)) return

  const node = scope.nodes[nodeName]
  if (!isRecordObject(node)) return

  walkNode(scope, node, path, context, [...stack, nodeName])
}

function walkNode(
  scope: Scope,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
  stack: readonly string[],
): void {
  const tag = node.tag
  if (typeof tag !== "string") return

  validateProps(scope, tag, node, path, context)
  validateCall(scope, tag, node, path, context, stack)

  if (!Array.isArray(node.children)) return
  node.children.forEach((child, index) => {
    if (isRecordObject(child)) {
      walkNode(scope, child, `${path}.children.${index}`, context, stack)
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
  stack: readonly string[],
): void {
  if (!isRecordObject(node.call)) return

  if (tag === "Action") {
    validateBoundValue(scope, `${path}.call.function`, "UI Action route", node.call.function, "string", context)
    return
  }

  if (tag !== "Include") return

  validateBoundValue(scope, `${path}.call.function`, "UI Include target", node.call.function, "string-or-string-array", context)

  const nodeName = literalFunctionName(node.call.function)
  if (nodeName === undefined || !isRecordObject(node.call.args)) return

  walkNamedNode(
    scope,
    nodeName,
    `${path}.${nodeName}`,
    contextForArgs(node.call.args, (value) => valueFromExpression(value, context)),
    stack,
  )
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
    scope.issues.push(typeflowIssue(scope.resource, path, `${label} references no ABI-backed value: ${value}`))
    return
  }

  if (!abiValueMatches(lookup.value, expectation)) {
    scope.issues.push(typeflowIssue(
      scope.resource,
      path,
      `${label} expects ${expectation}, but ABI provides ${abiTypeName(lookup.value)}`,
    ))
  }
}

function contextForArgs(
  args: Record<string, unknown>,
  resolve: (value: unknown) => unknown | undefined,
): AbiContext {
  const context = new Map<string, unknown>()
  for (const [name, value] of Object.entries(args)) {
    const resolved = resolve(value)
    if (resolved !== undefined) context.set(name, resolved)
  }
  return context
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

  const value = abiOutputAtSegments(rootValue, segments)
  return value === undefined ? { kind: "missing" } : { kind: "value", value }
}

function literalFunctionName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  if (expressionReference(value) !== undefined) return undefined
  return value.startsWith("$$") ? value.slice(1) : value
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
      return type === "address"
    case "integer-or-string":
      return type === "integer" || type === "string"
    case "string":
      return type === "string"
    case "string-or-string-array":
      return type === "string" || type === "string-array"
  }
}

function abiType(value: unknown): string {
  if (!isRecordObject(value) || typeof value.type !== "string") return "unknown"

  const type = value.type
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

function isUiPropTag(value: string): value is UiPropTag {
  return Object.hasOwn(UI_PROP_SCHEMAS, value)
}

function typeflowIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: "CAM_UI_TYPEFLOW_MISMATCH",
    resource,
    path,
    message,
  })
}
