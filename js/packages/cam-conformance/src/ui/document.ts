import {
  UI_DOCUMENT_TOP_LEVEL_KEYS,
  UI_VERSION,
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

// Granular conformance facets need raw UI node inventory before renderer
// parsing. Keep this intentionally shallow: strict JSON object plus nodes map
// only; explicit UI facets own static publication rules.
export function parseRawUiDocument(bytes: Uint8Array): RawUiDocument {
  const value = parseJsonBytes(bytes)
  if (!isRecordObject(value)) {
    throw new RawUiDocumentError("UI resource must be a JSON object")
  }
  validateUiVersion(value.ui)
  validateTopLevelFields(value)
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

function validateUiVersion(version: unknown): void {
  if (version === UI_VERSION) return

  throw new RawUiDocumentError(
    typeof version === "string" && version.length > 0
      ? `unsupported UI version: ${version}`
      : `UI version must be ${UI_VERSION}`,
    "ui",
  )
}

function validateTopLevelFields(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (UI_DOCUMENT_TOP_LEVEL_KEYS.has(key)) continue
    throw new RawUiDocumentError(`field is not allowed in UI ${UI_VERSION}: ${key}`, key)
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
