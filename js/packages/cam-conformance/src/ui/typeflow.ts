import {
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
import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"
import {
  forEachUiNode,
} from "./document.ts"
import {
  forEachRawUiResource,
} from "./resources.ts"

type AbiContext = ReadonlyMap<string, readonly unknown[]>
type ValueExpectation = "address" | "integer-or-string" | "string" | "string-or-string-array"

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

  forEachRawUiResource({
    resources,
    declarations,
    visit: (resource, ui) => {
      forEachUiNode(ui.nodes, (node, path) => validateUiNodeTypeflow(resource, node, path, context, issues))
    },
  })
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
      const output = abiFunctionOutputForExpression(fn, value)
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

function validateUiNodeTypeflow(
  resource: string,
  node: Record<string, unknown>,
  path: string,
  context: AbiContext,
  issues: CamConformanceIssue[],
): void {
  if (typeof node.tag !== "string") return

  if (isUiPropTag(node.tag) && isRecordObject(node.props)) {
    for (const [name, value] of Object.entries(node.props)) {
      const expectation = propExpectation(node.tag, name)
      if (expectation !== undefined) {
        validateBoundValueTypeflow({
          resource,
          path: `${path}.props.${name}`,
          label: `UI ${node.tag}.${name}`,
          value,
          expectation,
          context,
          issues,
        })
      }
    }
  }

  if (isRecordObject(node.call)) {
    if (node.tag === "Include") {
      validateBoundValueTypeflow({
        resource,
        path: `${path}.call.function`,
        label: "UI Include target",
        value: node.call.function,
        expectation: "string-or-string-array",
        context,
        issues,
      })
    }
    if (node.tag === "Action") {
      validateBoundValueTypeflow({
        resource,
        path: `${path}.call.function`,
        label: "UI Action route",
        value: node.call.function,
        expectation: "string",
        context,
        issues,
      })
    }
  }
}

function validateBoundValueTypeflow({
  resource,
  path,
  label,
  value,
  expectation,
  context,
  issues,
}: {
  readonly resource: string
  readonly path: string
  readonly label: string
  readonly value: unknown
  readonly expectation: ValueExpectation
  readonly context: AbiContext
  readonly issues: CamConformanceIssue[]
}): void {
  if (typeof value !== "string") return

  const candidates = abiValuesForExpression(value, context)
  if (candidates === undefined) return
  if (candidates.length === 0) {
    issues.push(conformanceIssue({
      rule: "CAM_UI_TYPEFLOW_MISMATCH",
      resource,
      path,
      message: `${label} references no ABI-backed value: ${value}`,
    }))
    return
  }

  const matching = candidates.find((candidate) => abiValueMatches(candidate, expectation))
  if (matching === undefined) {
    const [firstCandidate] = candidates
    issues.push(conformanceIssue({
      rule: "CAM_UI_TYPEFLOW_MISMATCH",
      resource,
      path,
      message: `${label} expects ${expectation}, but ABI provides ${abiTypeName(firstCandidate)}`,
    }))
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
  if (/^u?int(?:[0-9]+)?$/.test(type)) return "integer"
  if (/^bytes[0-9]+$/.test(type)) return "bytes"
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
