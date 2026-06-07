import {
  CAM_ROUTES_NAMESPACE,
  CAM_UI_NAMESPACE,
  UI_NODE_ARGUMENT_KEYS,
  UI_PROP_SCHEMAS,
  UI_VERSION,
} from "./constants.ts"
import { UiError } from "./errors.ts"
import { parseExpressionPayload } from "./expressions.ts"
import {
  requiredArray,
  requiredNonEmptyString,
  requiredRecord,
  rejectUnknownFields,
} from "./guards.ts"
import { createStringMap } from "@cam/protocol"
import type { InertRecord, InertValue } from "@cam/protocol"
import type { UiCall, UiDocument, UiNode } from "./types.ts"

const UI_TOP_LEVEL_KEYS = new Set(["ui", "nodes"])
const NAMED_NODE_KEYS = new Set(["requires", "tag", "props", "children", "call"])
const INLINE_NODE_KEYS = new Set(["tag", "props", "children", "call"])
const CALL_KEYS = new Set(["namespace", "function", "args"])
const SCREEN_NODE_KEYS = new Set(["tag", "props", "children"])
const FRAGMENT_KEYS = new Set(["tag", "children"])
const PROPS_ONLY_KEYS = new Set(["tag", "props"])
const INCLUDE_KEYS = new Set(["tag", "call"])
const ACTION_KEYS = new Set(["tag", "props", "call"])

export function parseUi(input: unknown): UiDocument {
  const source = requiredRecord(input, "")
  const ui = parseUiVersion(source.ui)
  rejectUnknownUiFields(source, UI_TOP_LEVEL_KEYS, "")

  const sourceNodes = requiredRecord(source.nodes, "nodes")
  const nodes = createStringMap<UiNode>()

  for (const [name, value] of Object.entries(sourceNodes)) {
    if (name.length === 0) {
      throw new UiError("UI_INVALID_FIELD", "UI node name must not be empty", "nodes")
    }

    nodes[name] = parseNamedNode(value, `nodes.${name}`)
  }

  if (Object.keys(nodes).length === 0) {
    throw new UiError("UI_INVALID_FIELD", "UI resource must declare at least one node", "")
  }

  return { ui, nodes }
}

function parseUiVersion(value: unknown): string {
  const version = requiredNonEmptyString(value, "ui")
  if (version !== UI_VERSION) {
    throw new UiError("UI_INVALID_FIELD", `unsupported UI version: ${version}`, "ui")
  }

  return version
}

function parseNamedNode(input: unknown, name: string): UiNode {
  const path = name
  const source = requiredRecord(input, path)
  rejectUnknownUiFields(source, NAMED_NODE_KEYS, path)

  return {
    ...parseNodeBody(source, path),
    requires: parseRequires(source.requires, `${path}.requires`),
  } as UiNode
}

function parseInlineNode(input: unknown, path: string): UiNode {
  const source = requiredRecord(input, path)
  rejectUnknownUiFields(source, INLINE_NODE_KEYS, path)

  return parseNodeBody(source, path)
}

function parseNodeBody(source: Record<string, unknown>, path: string): UiNode {
  const tag = requiredNonEmptyString(source.tag, `${path}.tag`)

  switch (tag) {
    case "Screen":
      rejectUnexpectedNodeShape(source, SCREEN_NODE_KEYS, path)
      return {
        tag,
        props: parseProps(source.props, `${path}.props`, UI_PROP_SCHEMAS.Screen.required),
        children: parseChildren(source.children, `${path}.children`),
      }
    case "Fragment":
      rejectUnexpectedNodeShape(source, FRAGMENT_KEYS, path)
      return {
        tag,
        children: parseChildren(source.children, `${path}.children`),
      }
    case "Text":
      rejectUnexpectedNodeShape(source, PROPS_ONLY_KEYS, path)
      return {
        tag,
        props: parseProps(source.props, `${path}.props`, UI_PROP_SCHEMAS.Text.required),
      }
    case "Input":
      rejectUnexpectedNodeShape(source, PROPS_ONLY_KEYS, path)
      return {
        tag,
        props: parseProps(source.props, `${path}.props`, UI_PROP_SCHEMAS.Input.required),
      }
    case "Address":
      rejectUnexpectedNodeShape(source, PROPS_ONLY_KEYS, path)
      return {
        tag,
        props: parseProps(source.props, `${path}.props`, UI_PROP_SCHEMAS.Address.required),
      }
    case "Status":
      rejectUnexpectedNodeShape(source, PROPS_ONLY_KEYS, path)
      return {
        tag,
        props: parseProps(source.props, `${path}.props`, UI_PROP_SCHEMAS.Status.required),
      }
    case "Nft":
      rejectUnexpectedNodeShape(source, PROPS_ONLY_KEYS, path)
      return {
        tag,
        props: parseProps(source.props, `${path}.props`, UI_PROP_SCHEMAS.Nft.required),
      }
    case "Include":
      rejectUnexpectedNodeShape(source, INCLUDE_KEYS, path)
      return {
        tag,
        call: parseCall(source.call, `${path}.call`, CAM_UI_NAMESPACE),
      }
    case "Action":
      rejectUnexpectedNodeShape(source, ACTION_KEYS, path)
      return {
        tag,
        props: parseProps(source.props, `${path}.props`, UI_PROP_SCHEMAS.Action.required),
        call: parseCall(source.call, `${path}.call`, CAM_ROUTES_NAMESPACE),
      }
    default:
      throw new UiError("UI_INVALID_FIELD", `unknown UI node tag: ${tag}`, `${path}.tag`)
  }
}

function rejectUnexpectedNodeShape(
  source: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
): void {
  const effectiveKeys = source.requires === undefined ? allowedKeys : new Set([...allowedKeys, "requires"])
  rejectUnknownUiFields(source, effectiveKeys, path)
}

function parseRequires(value: unknown, path: string): readonly string[] {
  const source = requiredArray(value, path)
  const requires: string[] = []
  const seen = new Set<string>()

  for (const [index, item] of source.entries()) {
    const itemPath = `${path}.${index}`
    const name = requiredNonEmptyString(item, itemPath)
    if (seen.has(name)) {
      throw new UiError("UI_INVALID_FIELD", `duplicate required argument: ${name}`, itemPath)
    }
    if (!UI_NODE_ARGUMENT_KEYS.has(name)) {
      throw new UiError("UI_INVALID_FIELD", `unsupported required argument: ${name}`, itemPath)
    }

    seen.add(name)
    requires.push(name)
  }

  return requires
}

function parseChildren(value: unknown, path: string): readonly UiNode[] {
  return requiredArray(value, path).map((child, index) => parseInlineNode(child, `${path}.${index}`))
}

function parseProps(value: unknown, path: string, allowedKeys: readonly string[]): InertRecord {
  const source = requiredRecord(value, path)
  rejectUnknownUiFields(source, new Set(allowedKeys), path)

  for (const key of allowedKeys) {
    if (!Object.hasOwn(source, key)) {
      throw new UiError("UI_INVALID_FIELD", `missing required UI prop: ${key}`, path)
    }
  }

  return parseInertRecord(source, path)
}

function parseCall(value: unknown, path: string, expectedNamespace: string): UiCall {
  const source = requiredRecord(value, path)
  rejectUnknownUiFields(source, CALL_KEYS, path)
  const namespace = requiredNonEmptyString(source.namespace, `${path}.namespace`)
  if (namespace !== expectedNamespace) {
    throw new UiError("UI_INVALID_FIELD", `UI ${path} must call ${expectedNamespace} namespace`, `${path}.namespace`)
  }

  return {
    namespace,
    function: parseCallFunction(source.function, `${path}.function`, expectedNamespace),
    args: parseInertRecord(requiredRecord(source.args, `${path}.args`), `${path}.args`),
  }
}

function parseCallFunction(value: unknown, path: string, expectedNamespace: string): InertValue {
  if (typeof value === "string") {
    return parseExpressionPayload(value, path)
  }

  if (expectedNamespace === CAM_UI_NAMESPACE && Array.isArray(value)) {
    return value.map((item, index) => {
      if (typeof item !== "string") {
        throw new UiError("UI_INVALID_FIELD", "Include function array items must be strings", `${path}.${index}`)
      }

      return parseExpressionPayload(item, `${path}.${index}`)
    })
  }

  throw new UiError(
    "UI_INVALID_FIELD",
    expectedNamespace === CAM_UI_NAMESPACE
      ? "Include function must be a string or string array"
      : "Action function must be a string",
    path,
  )
}

function parseInertRecord(source: Record<string, unknown>, path: string): InertRecord {
  const record = createStringMap<InertValue>()

  for (const [name, value] of Object.entries(source)) {
    if (name.length === 0) {
      throw new UiError("UI_INVALID_FIELD", "field name must not be empty", path)
    }

    record[name] = parseExpressionPayload(value, `${path}.${name}`)
  }

  return record
}

function rejectUnknownUiFields(
  source: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
): void {
  rejectUnknownFields(source, allowedKeys, path, (key) => `field is not allowed in UI ${UI_VERSION}: ${key}`)
}
