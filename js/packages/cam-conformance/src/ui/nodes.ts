import {
  UI_NODE_ARGUMENT_KEYS,
  isRecordObject,
} from "@cam/protocol"

import {
  conformanceIssue,
  conformanceRules,
  type CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredUiDocument,
} from "./resources.ts"

export type DeclaredUiNode = {
  readonly name: string
  readonly requires: readonly string[] | undefined
}

const RULES = conformanceRules({
  CAM_UI_NODE_INTERFACE_INVALID: {
    class: "A",
    reason: "UI node requires lists are cross-document APIs consumed by route handoffs and Includes.",
  },
})

export function declaredUiNodes({
  uiDocument,
  issues,
}: {
  readonly uiDocument: DeclaredUiDocument | undefined
  readonly issues: CamConformanceIssue[]
}): ReadonlyMap<string, DeclaredUiNode> | undefined {
  if (uiDocument === undefined) return undefined

  const nodes = new Map<string, DeclaredUiNode>()
  const { resource, document } = uiDocument
  for (const [name, node] of Object.entries(document.nodes)) {
    if (name.length === 0) {
      issues.push(uiNodeInterfaceIssue(resource, "nodes", "UI node name must not be empty"))
      continue
    }

    const requires = nodeRequires(resource, name, node, issues)
    nodes.set(name, {
      name,
      requires,
    })
  }

  return nodes
}

function nodeRequires(
  resource: string,
  nodeName: string,
  node: unknown,
  issues: CamConformanceIssue[],
): readonly string[] | undefined {
  const path = `nodes.${nodeName}.requires`
  if (!isRecordObject(node)) {
    issues.push(uiNodeInterfaceIssue(resource, `nodes.${nodeName}`, `UI node must be an object: ${nodeName}`))
    return undefined
  }
  if (!Array.isArray(node.requires)) {
    issues.push(uiNodeInterfaceIssue(resource, path, `UI node requires must be an array: ${nodeName}`))
    return undefined
  }

  const requires: string[] = []
  const seen = new Set<string>()
  for (const [index, item] of node.requires.entries()) {
    const itemPath = `${path}.${index}`
    if (typeof item !== "string" || item.length === 0) {
      issues.push(uiNodeInterfaceIssue(resource, itemPath, `UI node required argument must be a non-empty string: ${nodeName}`))
      return undefined
    }
    if (seen.has(item)) {
      issues.push(uiNodeInterfaceIssue(resource, itemPath, `duplicate UI node required argument: ${item}`))
      return undefined
    }
    if (!UI_NODE_ARGUMENT_KEYS.has(item)) {
      issues.push(uiNodeInterfaceIssue(resource, itemPath, `unsupported UI node required argument: ${item}`))
      return undefined
    }

    seen.add(item)
    requires.push(item)
  }

  return requires
}

function uiNodeInterfaceIssue(resource: string, path: string | undefined, message: string): CamConformanceIssue {
  return conformanceIssue({
    rule: RULES.CAM_UI_NODE_INTERFACE_INVALID,
    resource,
    path,
    message,
  })
}
