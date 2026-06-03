import {
  isRecordObject,
  parseJsonBytes,
} from "@cam/protocol"

import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"

export type DeclaredUiNode = {
  readonly name: string
  readonly requires: readonly string[]
}

export function declaredUiNodes({
  resources,
  declarations,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
}): ReadonlyMap<string, DeclaredUiNode> | undefined {
  const declaration = declarations.find((item) => item.namespaceType === "ui")
  if (declaration === undefined) return undefined

  const bytes = resources.get(declaration.uri)
  if (bytes === undefined) return undefined

  const ui = parseUiInventory(bytes)
  if (ui === undefined) return undefined

  const nodes = new Map<string, DeclaredUiNode>()
  for (const [name, node] of Object.entries(ui.nodes)) {
    const requires = nodeRequires(node)
    if (requires === undefined) {
      return undefined
    }

    nodes.set(name, {
      name,
      requires,
    })
  }

  return nodes
}

function parseUiInventory(bytes: Uint8Array): { readonly nodes: Record<string, unknown> } | undefined {
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

  if (!isRecordObject(ui) || !isRecordObject(ui.nodes)) {
    return undefined
  }

  return {
    nodes: ui.nodes,
  }
}

function nodeRequires(node: unknown): readonly string[] | undefined {
  if (!isRecordObject(node) || !Array.isArray(node.requires)) {
    return undefined
  }

  const requires: string[] = []
  for (const item of node.requires) {
    if (typeof item !== "string" || item.length === 0) {
      return undefined
    }
    requires.push(item)
  }

  return requires
}
