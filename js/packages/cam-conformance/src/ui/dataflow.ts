import {
  isExpressionIdentifier,
  isRecordObject,
} from "@cam/protocol"

import {
  conformanceIssue,
  type CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredUiNode,
} from "./nodes.ts"
import {
  forEachUiNode,
} from "./document.ts"
import type { RawUiDocuments } from "./resources.ts"
import {
  staticString,
  staticStringList,
} from "../expressions/reference.ts"
import {
  validateExpectedArgumentNames,
  validateStaticCallTargets,
  validateUiCallArgNames,
  validateUiCallFunctionShape,
  type UiCallNamespace,
} from "./calls.ts"

type UiCall = {
  readonly path: string
  readonly namespace: UiCallNamespace
  readonly function: unknown
  readonly args: Record<string, unknown>
}

export function validateUiDataflow({
  uiDocuments,
  uiNodes,
  issues,
}: {
  readonly uiDocuments: RawUiDocuments
  readonly uiNodes: ReadonlyMap<string, DeclaredUiNode> | undefined
  readonly issues: CamConformanceIssue[]
}): void {
  for (const [resource, ui] of uiDocuments) {
    const calls = uiCalls(resource, ui.nodes, issues)

    for (const call of calls) {
      if (!validateUiCallArgNames({
        resource,
        path: call.path,
        namespace: call.namespace,
        args: call.args,
        issues,
        rule: "CAM_UI_DATAFLOW_MISMATCH",
      })) {
        continue
      }
      if (!validateUiCallFunctionShape({
        resource,
        path: call.path,
        namespace: call.namespace,
        value: call.function,
        issues,
        rule: "CAM_UI_DATAFLOW_MISMATCH",
      })) {
        continue
      }
      if (call.namespace === "ui") {
        if (uiNodes !== undefined) {
          validateIncludeNodeArgs(resource, call, uiNodes, issues)
        }
      }
    }
  }
}

function uiCalls(
  resource: string,
  nodes: Record<string, unknown>,
  issues: CamConformanceIssue[],
): readonly UiCall[] {
  const calls: UiCall[] = []
  forEachUiNode(nodes, (node, path) => collectUiNodeDataflow(resource, node, path, calls, issues))
  return calls
}

function collectUiNodeDataflow(
  resource: string,
  value: Record<string, unknown>,
  path: string,
  calls: UiCall[],
  issues: CamConformanceIssue[],
): void {
  validateInputName(resource, value, path, issues)
  if (value.element === "Include") {
    collectCall(value, path, "ui", calls)
  }
  if (value.element === "Button") {
    collectCall(value, path, "routes", calls)
  }
}

function validateInputName(
  resource: string,
  value: Record<string, unknown>,
  path: string,
  issues: CamConformanceIssue[],
): void {
  if (value.element !== "TextField" || !isRecordObject(value.state)) return

  const name = staticString(value.state.key)
  if (name === undefined) return
  if (name.length === 0) {
    issues.push(dataflowIssue(resource, `${path}.state.key`, "TextField state key must not be empty"))
    return
  }
  if (isExpressionIdentifier(name)) return

  issues.push(dataflowIssue(resource, `${path}.state.key`, `TextField state key must be an expression identifier: ${name}`))
}

function collectCall(
  value: Record<string, unknown>,
  path: string,
  namespace: "routes" | "ui",
  calls: UiCall[],
): void {
  if (!isRecordObject(value.call)) return
  if (value.call.namespace !== namespace) return
  if (!isRecordObject(value.call.args)) return

  calls.push({
    path,
    namespace,
    function: value.call.function,
    args: value.call.args,
  })
}

function validateIncludeNodeArgs(
  resource: string,
  include: UiCall,
  uiNodes: ReadonlyMap<string, DeclaredUiNode>,
  issues: CamConformanceIssue[],
): void {
  const functionNames = staticStringList(include.function)
  if (functionNames === undefined) return
  if (!validateStaticCallTargets({
    resource,
    path: `${include.path}.call.function`,
    label: "UI Include",
    names: functionNames,
    issues,
    rule: "CAM_UI_DATAFLOW_MISMATCH",
  })) {
    return
  }

  for (const functionName of functionNames) {
    const node = uiNodes.get(functionName)
    if (node === undefined) {
      issues.push(dataflowIssue(
        resource,
        `${include.path}.call.function`,
        `UI Include calls unknown UI node: ${functionName}`,
      ))
      continue
    }
    if (node.requires === undefined) continue

    validateExpectedArgumentNames({
      resource,
      path: `${include.path}.call.args`,
      expectedNames: node.requires,
      actualNames: Object.keys(include.args),
      destination: `UI node ${node.name}`,
      issues,
      rule: "CAM_UI_DATAFLOW_MISMATCH",
      filterEmptyActualNames: false,
    })
  }
}

function dataflowIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: "CAM_UI_DATAFLOW_MISMATCH",
    resource,
    path,
    message,
  })
}
