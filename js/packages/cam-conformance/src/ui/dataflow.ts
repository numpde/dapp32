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

type UiAction = {
  readonly path: string
  readonly function: unknown
  readonly args: Record<string, unknown>
}

type UiDataflow = {
  readonly inputNames: ReadonlySet<string>
  readonly actions: readonly UiAction[]
}

const EXPRESSION_IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9_]*$/

export function validateUiDataflow({
  resources,
  declarations,
  routes,
  issues,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly routes: readonly DeclaredRoute[]
  readonly issues: CamConformanceIssue[]
}): void {
  const routesByName = new Map(routes.map((route) => [route.name, route]))
  for (const declaration of declarations) {
    if (declaration.namespaceType !== "ui") continue
    const dataflow = readUiDataflow(resources.get(declaration.uri))
    if (dataflow === undefined) continue

    for (const action of dataflow.actions) {
      validateActionRouteArgs(declaration.uri, action, routesByName, issues)
      validateActionStateInputs(declaration.uri, action, dataflow.inputNames, issues)
    }
  }
}

function readUiDataflow(bytes: Uint8Array | undefined): UiDataflow | undefined {
  if (bytes === undefined) return undefined

  let ui: unknown
  let parseFailed = false
  try {
    ui = parseJsonBytes(bytes)
  } catch {
    parseFailed = true
  }
  if (parseFailed) {
    return undefined
  }
  if (!isRecordObject(ui) || !isRecordObject(ui.nodes)) return undefined

  const inputNames = new Set<string>()
  const actions: UiAction[] = []
  for (const [nodeName, node] of Object.entries(ui.nodes)) {
    collectUiNodeDataflow(node, `nodes.${nodeName}`, inputNames, actions)
  }

  return {
    inputNames,
    actions,
  }
}

function collectUiNodeDataflow(
  value: unknown,
  path: string,
  inputNames: Set<string>,
  actions: UiAction[],
): void {
  if (!isRecordObject(value)) return

  if (value.tag === "Input") {
    collectInputName(value, inputNames)
  }
  if (value.tag === "Action") {
    collectAction(value, path, actions)
  }
  if (Array.isArray(value.children)) {
    value.children.forEach((child, index) => collectUiNodeDataflow(child, `${path}.children.${index}`, inputNames, actions))
  }
}

function collectInputName(node: Record<string, unknown>, inputNames: Set<string>): void {
  if (!isRecordObject(node.props)) return

  const name = node.props.name
  // Only literal Input names can statically prove a $state.<name> reference.
  // Dynamic names remain runtime-valid, but they cannot satisfy this authoring
  // conformance check.
  if (typeof name === "string" && name.length > 0 && !name.startsWith("$")) {
    inputNames.add(name)
  }
}

function collectAction(value: Record<string, unknown>, path: string, actions: UiAction[]): void {
  if (!isRecordObject(value.call)) return
  if (value.call.namespace !== "routes") return
  if (!isRecordObject(value.call.args)) return

  actions.push({
    path,
    function: value.call.function,
    args: value.call.args,
  })
}

function validateActionRouteArgs(
  resource: string,
  action: UiAction,
  routesByName: ReadonlyMap<string, DeclaredRoute>,
  issues: CamConformanceIssue[],
): void {
  if (typeof action.function !== "string") return
  if (action.function.startsWith("$")) return

  const route = routesByName.get(action.function)
  if (route === undefined) {
    issues.push(dataflowIssue(
      resource,
      `${action.path}.call.function`,
      `UI action calls unknown route: ${action.function}`,
    ))
    return
  }

  validateExactNames({
    resource,
    path: `${action.path}.call.args`,
    expectedNames: route.inputs,
    actualNames: Object.keys(action.args),
    destination: `route ${route.name}`,
    issues,
  })
}

function validateActionStateInputs(
  resource: string,
  action: UiAction,
  inputNames: ReadonlySet<string>,
  issues: CamConformanceIssue[],
): void {
  forEachExpressionString(action.args, `${action.path}.call.args`, (value, path) => {
    const stateInput = referencedStateInput(value)
    if (stateInput === undefined) return

    if (stateInput.length === 0) {
      issues.push(dataflowIssue(
        resource,
        path,
        "UI action state expression must name an input",
      ))
      return
    }

    if (!inputNames.has(stateInput)) {
      issues.push(dataflowIssue(
        resource,
        path,
        `UI action references state without a matching Input name: ${stateInput}`,
      ))
    }
  })
}

function referencedStateInput(value: string): string | undefined {
  if (!value.startsWith("$") || value.startsWith("$$")) return undefined

  const [root, firstSegment] = value.slice(1).split(".")
  if (root !== "state") return undefined
  if (firstSegment === undefined || !EXPRESSION_IDENTIFIER_RE.test(firstSegment)) return ""
  return firstSegment
}

function validateExactNames({
  resource,
  path,
  expectedNames,
  actualNames,
  destination,
  issues,
}: {
  readonly resource: string
  readonly path: string
  readonly expectedNames: readonly string[]
  readonly actualNames: readonly string[]
  readonly destination: string
  readonly issues: CamConformanceIssue[]
}): void {
  const expected = new Set(expectedNames)
  const actual = new Set(actualNames)

  for (const name of actual) {
    if (!expected.has(name)) {
      issues.push(dataflowIssue(resource, `${path}.${name}`, `unexpected UI action argument for ${destination}: ${name}`))
    }
  }

  for (const name of expected) {
    if (!actual.has(name)) {
      issues.push(dataflowIssue(resource, `${path}.${name}`, `missing UI action argument for ${destination}: ${name}`))
    }
  }
}

function forEachExpressionString(
  value: unknown,
  path: string,
  visit: (value: string, path: string) => void,
): void {
  if (typeof value === "string") {
    visit(value, path)
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => forEachExpressionString(item, `${path}.${index}`, visit))
    return
  }
  if (isRecordObject(value)) {
    for (const [name, item] of Object.entries(value)) {
      forEachExpressionString(item, `${path}.${name}`, visit)
    }
  }
}

function dataflowIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return {
    rule: "CAM_UI_DATAFLOW_MISMATCH",
    severity: "error",
    resource,
    path,
    message,
  }
}
