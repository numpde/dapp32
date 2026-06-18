import {
  isRecordObject,
  parseJsonBytes,
} from "@cam/protocol"

export type RawUiDocument = {
  readonly value: unknown
  readonly nodes: Record<string, unknown>
}

class RawUiDocumentError extends Error {
  readonly path: string | undefined

  constructor(message: string, path?: string) {
    super(message)
    this.name = "RawUiDocumentError"
    this.path = path
  }
}

// Granular conformance facets inspect the UI node inventory before the sourced
// @cam/screen parser runs. Keep this check intentionally shallow: it establishes
// a strict JSON object with a nodes map, then lets the runtime parser own the
// full UI schema.
export function parseRawUiDocument(bytes: Uint8Array): RawUiDocument {
  const value = parseJsonBytes(bytes)
  if (!isRecordObject(value)) {
    throw new RawUiDocumentError("UI resource must be a JSON object")
  }
  if (!isRecordObject(value.nodes)) {
    throw new RawUiDocumentError("UI resource nodes must be an object", "nodes")
  }
  if (Object.keys(value.nodes).length === 0) {
    throw new RawUiDocumentError("UI resource must declare at least one node", "nodes")
  }

  return {
    value,
    nodes: value.nodes,
  }
}

export function forEachUiNode(
  nodes: Record<string, unknown>,
  visit: (node: Record<string, unknown>, path: string) => void,
): void {
  for (const [nodeName, node] of Object.entries(nodes)) {
    walkUiNode(node, `nodes.${nodeName}`, visit)
  }
}

function walkUiNode(
  value: unknown,
  path: string,
  visit: (node: Record<string, unknown>, path: string) => void,
): void {
  if (!isRecordObject(value)) return

  visit(value, path)
  if (Array.isArray(value.children)) {
    value.children.forEach((child, index) => walkUiNode(child, `${path}.children.${index}`, visit))
  }
}
