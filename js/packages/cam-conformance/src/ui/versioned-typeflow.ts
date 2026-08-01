import {
  camVersionSupportsWriteValue,
  isRecordObject,
  parseAbiIntegerType,
} from "@cam/protocol"

import {
  abiArgValueMismatches,
  abiFunctionOutputForExpression,
  abiOutputAtSegments,
  resolvedAbiFunction,
  type AbiFunction,
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
  rawValueAtSegments,
} from "../walk.ts"
import {
  UI_CALL_RULES,
} from "./calls.ts"
import type {
  DeclaredUiDocument,
} from "./resources.ts"
import {
  validateUiTypeflow,
} from "./typeflow.ts"

const TRANSACTION_VALUE_ABI = {
  name: "transactionValue",
  type: "uint256",
} as const

const UNKNOWN_VALUE = { kind: "unknown" } as const

type KnownValue =
  | typeof UNKNOWN_VALUE
  | {
      readonly kind: "abi"
      readonly abi: unknown
    }
  | {
      readonly kind: "literal"
      readonly value: unknown
    }

type TypeflowScope = {
  readonly resource: string
  readonly uiDocument: DeclaredUiDocument
  readonly routesByName: ReadonlyMap<string, DeclaredRoute>
  readonly functionsByNamespace: ContractFunctionsByNamespace
  readonly readRoute: DeclaredRoute
  readonly issues: CamConformanceIssue[]
  readonly reported: Set<string>
}

export function validateVersionedUiTypeflow({
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
  validateUiTypeflow({
    uiDocument,
    routes,
    functionsByNamespace,
    issues,
  })
  validateTransactionValueTypeflow({
    uiDocument,
    routes,
    functionsByNamespace,
    issues,
  })
}

function validateTransactionValueTypeflow({
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
  for (const readRoute of routes) {
    if (readRoute.kind !== "read") continue

    const functions = functionsByNamespace.get(readRoute.call.namespace)
    if (functions === undefined) continue
    const fn = resolvedAbiFunction(readRoute.call.function, functions)
    const rootNode = staticString(readRoute.then.function)
    if (fn === undefined || rootNode === undefined) continue

    const scope = {
      resource: uiDocument.resource,
      uiDocument,
      routesByName,
      functionsByNamespace,
      readRoute,
      issues,
      reported: new Set<string>(),
    } satisfies TypeflowScope
    const context = readRouteContext(readRoute, fn)
    walkNamedNode(scope, rootNode, `nodes.${rootNode}`, context, [])
  }
}

function readRouteContext(route: DeclaredRoute, fn: AbiFunction): ReadonlyMap<string, KnownValue> {
  const context = new Map<string, KnownValue>()
  for (const [name, value] of Object.entries(route.then.args)) {
    const abi = abiFunctionOutputForExpression(fn, value)
    context.set(name, abi === undefined ? knownUiValue(value, context) : knownAbiValue(abi))
  }
  return context
}

function walkNamedNode(
  scope: TypeflowScope,
  nodeName: string,
  path: string,
  context: ReadonlyMap<string, KnownValue>,
  stack: readonly string[],
): void {
  if (stack.includes(nodeName)) return

  const node = scope.uiDocument.document.nodes[nodeName]
  if (!isRecordObject(node)) return
  walkNode(scope, node, path, context, [...stack, nodeName])
}

function walkNode(
  scope: TypeflowScope,
  node: Record<string, unknown>,
  path: string,
  context: ReadonlyMap<string, KnownValue>,
  stack: readonly string[],
): void {
  if (node.element === "Button") {
    validateButtonValue(scope, node, path, context)
  } else if (node.element === "Include") {
    walkInclude(scope, node, path, context, stack)
  }

  if (!Array.isArray(node.children)) return
  for (const [index, child] of node.children.entries()) {
    if (isRecordObject(child)) {
      walkNode(scope, child, `${path}.children.${index}`, context, stack)
    }
  }
}

function walkInclude(
  scope: TypeflowScope,
  node: Record<string, unknown>,
  path: string,
  context: ReadonlyMap<string, KnownValue>,
  stack: readonly string[],
): void {
  if (!isRecordObject(node.call) || !isRecordObject(node.call.args)) return

  const targetNames = includeTargetNames(node.call.function)
  if (targetNames === undefined) return

  const nextContext = new Map<string, KnownValue>()
  for (const [name, value] of Object.entries(node.call.args)) {
    nextContext.set(name, knownUiValue(value, context))
  }
  for (const targetName of targetNames) {
    walkNamedNode(scope, targetName, `${path}.${targetName}`, nextContext, stack)
  }
}

function includeTargetNames(value: unknown): readonly string[] | undefined {
  const targetNames = staticStringList(value)
  if (targetNames !== undefined) return targetNames

  const targetName = staticString(value)
  if (targetName === undefined) return undefined
  return [targetName]
}

function validateButtonValue(
  scope: TypeflowScope,
  node: Record<string, unknown>,
  path: string,
  context: ReadonlyMap<string, KnownValue>,
): void {
  if (!isRecordObject(node.call) || !isRecordObject(node.call.args)) return

  const routeName = staticString(node.call.function)
  if (routeName === undefined) return
  const route = scope.routesByName.get(routeName)
  if (
    route === undefined
    || route.kind !== "write"
    || !camVersionSupportsWriteValue(route.version)
    || !Object.hasOwn(route, "value")
  ) {
    return
  }

  const reference = typeof route.value === "string" ? expressionReference(route.value) : undefined
  if (reference === undefined || reference.root !== "inputs") return
  const [inputName, ...segments] = reference.segments
  if (inputName === undefined || !Object.hasOwn(node.call.args, inputName)) return

  const actionValue = knownUiValue(node.call.args[inputName], context)
  const resolvedValue = knownValueAtSegments(actionValue, segments)
  const mismatch = transactionValueMismatch(resolvedValue)
  if (mismatch === undefined) return

  reportTypeflowIssue(
    scope,
    `${path}.call.args.${inputName}`,
    mismatch,
  )
}

function knownUiValue(value: unknown, context: ReadonlyMap<string, KnownValue>): KnownValue {
  if (typeof value === "string") {
    const reference = expressionReference(value)
    if (reference !== undefined) {
      const protocolValue = knownProtocolValue(reference.root, reference.segments)
      if (protocolValue !== undefined) return protocolValue
      const rootValue = context.get(reference.root)
      return rootValue === undefined ? UNKNOWN_VALUE : knownValueAtSegments(rootValue, reference.segments)
    }

    const literal = staticString(value)
    return literal === undefined ? UNKNOWN_VALUE : knownLiteralValue(literal)
  }

  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return knownLiteralValue(value)
  }
  if (Array.isArray(value) || isRecordObject(value)) {
    return knownLiteralValue(value)
  }
  return UNKNOWN_VALUE
}

function knownProtocolValue(root: string, segments: readonly string[]): KnownValue | undefined {
  const path = segments.join(".")
  if ((root === "account" || root === "host") && path === "address") {
    return knownAbiValue({ type: "address" })
  }
  if (root === "host" && path === "chainId") {
    return knownAbiValue({ type: "string" })
  }
  return undefined
}

function knownValueAtSegments(value: KnownValue, segments: readonly string[]): KnownValue {
  if (segments.length === 0 || value.kind === "unknown") return value

  if (value.kind === "abi") {
    const abi = abiOutputAtSegments(value.abi, segments)
    return abi === undefined ? UNKNOWN_VALUE : knownAbiValue(abi)
  }

  const literal = rawValueAtSegments(value.value, segments)
  return literal === undefined ? UNKNOWN_VALUE : knownLiteralValue(literal)
}

function knownAbiValue(abi: unknown): KnownValue {
  return {
    kind: "abi",
    abi,
  }
}

function knownLiteralValue(value: unknown): KnownValue {
  return {
    kind: "literal",
    value,
  }
}

function transactionValueMismatch(value: KnownValue): string | undefined {
  if (value.kind === "unknown") return undefined

  if (value.kind === "literal") {
    return abiArgValueMismatches("transaction value", value.value, TRANSACTION_VALUE_ABI)[0]?.message
  }

  if (!isRecordObject(value.abi) || typeof value.abi.type !== "string") return undefined
  const integerType = parseAbiIntegerType(value.abi.type)
  if (integerType !== undefined && !integerType.signed) return undefined
  return `transaction value expects ABI uint256, but ABI provides ${value.abi.type}`
}

function reportTypeflowIssue(scope: TypeflowScope, path: string, message: string): void {
  const key = `${scope.readRoute.name}\0${path}\0${message}`
  if (scope.reported.has(key)) return

  scope.reported.add(key)
  scope.issues.push(conformanceIssue({
    rule: UI_CALL_RULES.CAM_UI_TYPEFLOW_MISMATCH,
    resource: scope.resource,
    path,
    message: `route ${scope.readRoute.name}: ${message}`,
  }))
}
