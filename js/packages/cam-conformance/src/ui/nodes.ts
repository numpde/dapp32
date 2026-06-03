import {
  UI_NODE_ARGUMENT_KEYS,
  isRecordObject,
} from "@cam/protocol"

import type {
  CamConformanceIssue,
} from "../issues.ts"
import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"
import {
  readRawUiDocument,
} from "./document.ts"

export type DeclaredUiNode = {
  readonly name: string
  readonly requires: readonly string[] | undefined
}

export function declaredUiNodes({
  resources,
  declarations,
  issues,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly issues: CamConformanceIssue[]
}): ReadonlyMap<string, DeclaredUiNode> | undefined {
  const declaration = declarations.find((item) => item.namespaceType === "ui")
  if (declaration === undefined) return undefined

  const ui = readRawUiDocument(resources.get(declaration.uri))
  if (ui === undefined) return undefined

  const nodes = new Map<string, DeclaredUiNode>()
  for (const [name, node] of Object.entries(ui.nodes)) {
    const requires = nodeRequires(declaration.uri, name, node, issues)
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

function uiNodeInterfaceIssue(resource: string, path: string, message: string): CamConformanceIssue {
  return {
    rule: "CAM_UI_NODE_INTERFACE_INVALID",
    severity: "error",
    resource,
    path,
    message,
  }
}
