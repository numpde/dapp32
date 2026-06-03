import {
  isRecordObject,
  parseJsonBytes,
} from "@cam/protocol"

export type RawUiDocument = {
  readonly value: unknown
  readonly nodes: Record<string, unknown>
}

export function readRawUiDocument(bytes: Uint8Array | undefined): RawUiDocument | undefined {
  if (bytes === undefined) return undefined

  let value: unknown
  let parseFailed = false
  try {
    value = parseJsonBytes(bytes)
  } catch {
    parseFailed = true
  }
  if (parseFailed) {
    return undefined
  }
  if (!isRecordObject(value) || !isRecordObject(value.nodes)) return undefined

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
