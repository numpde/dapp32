import {
  UI_PROP_SCHEMAS,
  type UiPropTag,
  isRecordObject,
} from "@cam/protocol"

import {
  abiOutputAtSegments,
  resolvedAbiFunction,
  type AbiFunction,
  type ContractFunctionsByNamespace,
} from "../abi/routes.ts"
import {
  expressionReference,
} from "../expressions/reference.ts"
import type {
  CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredRoute,
} from "../manifest/routes.ts"
import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"
import {
  forEachUiNode,
  readRawUiDocument,
} from "./document.ts"

type AbiContext = ReadonlyMap<string, readonly unknown[]>
type PropExpectation = "address" | "integer-or-string" | "string"

export function validateUiTypeflow({
  resources,
  declarations,
  routes,
  functionsByNamespace,
  issues,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly routes: readonly DeclaredRoute[]
  readonly functionsByNamespace: ContractFunctionsByNamespace
  readonly issues: CamConformanceIssue[]
}): void {
  const context = abiContextForReadRouteContinuations(routes, functionsByNamespace)
  if (context.size === 0) return

  for (const declaration of declarations) {
    if (declaration.namespaceType !== "ui") continue
    const bytes = resources.get(declaration.uri)
    if (bytes === undefined) continue

    const ui = readRawUiDocument(bytes)
    if (ui === undefined) continue

    forEachUiNode(ui.nodes, (node, path) => validateUiNodeTypeflow(declaration.uri, node, path, context, issues))
  }
}

function abiContextForReadRouteContinuations(
  routes: readonly DeclaredRoute[],
  functionsByNamespace: ContractFunctionsByNamespace,
): AbiContext {
  // Dynamic Include selections can choose different UI nodes at runtime. The
  // static check therefore records every ABI-backed argument shape passed into
  // UI and rejects only prop bindings that no known shape can satisfy.
  const context = new Map<string, unknown[]>()
  for (const route of routes) {
    if (route.kind !== "read") continue

    const functions = functionsByNamespace.get(route.call.namespace)
    if (functions === undefined) continue

    const fn = resolvedAbiFunction(route.call.function, functions)
    if (fn === undefined) continue

    for (const [name, value] of Object.entries(route.then.args)) {
      const output = routeOutputValue(fn, value)
      if (output === undefined) continue

      const values = context.get(name)
      if (values === undefined) {
        context.set(name, [output])
      } else {
        values.push(output)
      }
    }
  }

  return context
}

function routeOutputValue(fn: AbiFunction, value: unknown): unknown | undefined {
  if (typeof value !== "string") return undefined

  const reference = expressionReference(value)
  if (reference === undefined || reference.root !== "outputs") return undefined

  const [index, ...segments] = reference.segments
  if (index === undefined || !isArrayIndex(index)) return undefined

  const output = fn.outputs[Number(index)]
  if (output === undefined) return undefined

  return abiOutputAtSegments(output, segments)
}

function validateUiNodeTypeflow(
  resource: string,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
  issues: CamConformanceIssue[],
): void {
  if (typeof node.tag !== "string" || !isUiPropTag(node.tag) || !isRecordObject(node.props)) return

  for (const [name, value] of Object.entries(node.props)) {
    const expectation = propExpectation(node.tag, name)
    if (expectation === undefined || typeof value !== "string") continue

    const candidates = abiValuesForExpression(value, context)
    if (candidates === undefined || candidates.length === 0) continue

    const matching = candidates.find((candidate) => abiValueMatches(candidate, expectation))
    if (matching === undefined) {
      const [firstCandidate] = candidates
      issues.push({
        rule: "CAM_UI_TYPEFLOW_MISMATCH",
        severity: "error",
        resource,
        path: `${path}.props.${name}`,
        message: `UI ${node.tag}.${name} expects ${expectation}, but ABI provides ${abiTypeName(firstCandidate)}`,
      })
    }
  }
}

function abiValuesForExpression(value: string, context: AbiContext): readonly unknown[] | undefined {
  const reference = expressionReference(value)
  if (reference === undefined) return undefined

  const rootValues = context.get(reference.root)
  if (rootValues === undefined) return undefined

  return rootValues
    .map((rootValue) => abiOutputAtSegments(rootValue, reference.segments))
    .filter((valueAtPath) => valueAtPath !== undefined)
}

function propExpectation(tag: UiPropTag, prop: string): PropExpectation | undefined {
  if (tag === "Address" && prop === "address") return "address"
  if (tag === "Nft" && prop === "contractAddress") return "address"
  if (tag === "Nft" && prop === "tokenId") return "integer-or-string"
  if ((UI_PROP_SCHEMAS[tag].string as readonly string[]).includes(prop)) return "string"
  return undefined
}

function abiValueMatches(value: unknown, expectation: PropExpectation): boolean {
  const type = abiType(value)
  switch (expectation) {
    case "address":
      return type === "address"
    case "integer-or-string":
      return type === "integer" || type === "string"
    case "string":
      return type === "string"
  }
}

function abiType(value: unknown): string {
  if (!isRecordObject(value) || typeof value.type !== "string") return "unknown"

  const type = value.type
  if (type === "address" || type === "string" || type === "bool" || type === "bytes" || type === "tuple") return type
  if (/^u?int(?:[0-9]+)?$/.test(type)) return "integer"
  if (/^bytes[0-9]+$/.test(type)) return "bytes"
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

function isArrayIndex(value: string): boolean {
  return value === "0" || /^[1-9][0-9]*$/.test(value)
}
