import { ScreenError } from "./errors.ts"
import { resolveValueAtPath } from "./expressions.ts"
import {
  createStringMap,
  hasOwn,
  isRecordObject,
} from "@cam/protocol"
import type { InertRecord, InertValue } from "@cam/protocol"
import type {
  ActionNode,
  IncludeNode,
  ResolvedActionNode,
  ResolvedElementNode,
  ResolvedUiCall,
  ResolvedUiNode,
  UiCall,
  UiDocument,
  UiNode,
  UiRuntimeContext,
} from "./types.ts"

export function resolveUiNode(
  ui: UiDocument,
  nodeName: string,
  args: InertRecord,
  context: UiRuntimeContext,
): ResolvedUiNode {
  const resolved = resolveNamedNode(ui, nodeName, args, context, nodeName, { includeActions: true })
  if (resolved.length !== 1) {
    throw new ScreenError("SCREEN_INVALID_FIELD", `UI node did not resolve to one root node: ${nodeName}`, nodeName)
  }

  return resolved[0]
}

export function resolveInitialUiNode(
  ui: UiDocument,
  nodeName: string,
  args: InertRecord,
  context: UiRuntimeContext,
): {
  readonly form: InertRecord
  readonly resolvedUi: ResolvedUiNode
} {
  const emptyForm = createStringMap<InertValue>()
  const initialContext = {
    ...context,
    form: emptyForm,
  }
  const initialNodes = resolveNamedNode(ui, nodeName, args, initialContext, nodeName, { includeActions: false })
  const form = createInitialForm(initialNodes)
  const resolvedUi = resolveUiNode(ui, nodeName, argsWithInitialForm(args, form), { ...context, form })

  return {
    form,
    resolvedUi,
  }
}

function argsWithInitialForm(args: InertRecord, form: InertRecord): InertRecord {
  if (!hasOwn(args, "form")) {
    return args
  }

  return {
    ...args,
    form,
  }
}

function resolveNamedNode(
  ui: UiDocument,
  nodeName: string,
  args: InertRecord,
  context: UiRuntimeContext,
  path: string,
  options: ResolveOptions,
): readonly ResolvedUiNode[] {
  if (!hasOwn(ui.nodes, nodeName)) {
    throw new ScreenError("SCREEN_UNRESOLVED_VALUE", `UI node does not exist: ${nodeName}`, path)
  }

  const node = ui.nodes[nodeName]
  const nodeContext = contextForNode(node, args, context, path)
  return resolveNode(ui, node, nodeContext, path, options)
}

type ResolveOptions = {
  readonly includeActions: boolean
}

function contextForNode(
  node: UiNode,
  args: InertRecord,
  context: UiRuntimeContext,
  path: string,
): UiRuntimeContext {
  const requires = requireNamedNodeArgs(node, path)
  const nodeContext = {
    ...context,
    ...args,
  }

  for (const name of requires) {
    if (!hasOwn(args, name)) {
      throw new ScreenError("SCREEN_UNRESOLVED_VALUE", `UI node argument is missing: ${name}`, `${path}.requires`)
    }
  }

  return nodeContext
}

function requireNamedNodeArgs(node: UiNode, path: string): readonly string[] {
  if (node.requires === undefined) {
    throw new ScreenError("SCREEN_INVALID_FIELD", "named UI nodes must declare requires", `${path}.requires`)
  }

  return node.requires
}

function resolveNode(
  ui: UiDocument,
  node: UiNode,
  context: UiRuntimeContext,
  path: string,
  options: ResolveOptions,
): readonly ResolvedUiNode[] {
  switch (node.tag) {
    case "Include":
      return resolveInclude(ui, node, context, path, options)
    case "Action":
      return options.includeActions ? [resolveAction(node, context, path)] : []
    case "Screen":
    case "Fragment":
      return [resolveElementNode(ui, node, context, path, options)]
    case "Text":
    case "Input":
    case "Address":
    case "Status":
    case "Nft":
      return [{
        tag: node.tag,
        props: resolveRecord(node.props, context, `${path}.props`),
        children: [],
      }]
  }
}

function resolveElementNode(
  ui: UiDocument,
  node: Extract<UiNode, { readonly tag: "Screen" | "Fragment" }>,
  context: UiRuntimeContext,
  path: string,
  options: ResolveOptions,
): ResolvedElementNode {
  const children: ResolvedUiNode[] = []

  for (const [index, child] of node.children.entries()) {
    children.push(...resolveNode(ui, child, context, `${path}.children.${index}`, options))
  }

  return {
    tag: node.tag,
    props: node.tag === "Screen" ? resolveRecord(node.props, context, `${path}.props`) : createStringMap<InertValue>(),
    children,
  }
}

function resolveInclude(
  ui: UiDocument,
  node: IncludeNode,
  context: UiRuntimeContext,
  path: string,
  options: ResolveOptions,
): readonly ResolvedUiNode[] {
  if (node.call.namespace !== "ui") {
    throw new ScreenError("SCREEN_INVALID_FIELD", `Include must call the ui namespace: ${node.call.namespace}`, `${path}.call.namespace`)
  }

  const selected = resolveValueAtPath(node.call.function, context, `${path}.call.function`)
  const nodeNames = selectedNodeNames(selected, `${path}.call.function`)
  const children: ResolvedUiNode[] = []

  for (const nodeName of nodeNames) {
    if (!options.includeActions && ui.nodes[nodeName]?.tag === "Action") {
      continue
    }

    const args = resolveRecord(node.call.args, context, `${path}.call.args`)
    children.push(...resolveNamedNode(ui, nodeName, args, context, `${path}.${nodeName}`, options))
  }

  return children
}

function createInitialForm(nodes: readonly ResolvedUiNode[]): InertRecord {
  const form = createStringMap<InertValue>()
  appendInitialForm(nodes, form)
  return form
}

function appendInitialForm(nodes: readonly ResolvedUiNode[], form: Record<string, InertValue>): void {
  for (const node of nodes) {
    if (node.tag === "Input") {
      const name = node.props.name
      const value = node.props.value
      if (typeof name !== "string" || name.length === 0) {
        throw new ScreenError("SCREEN_INVALID_FIELD", "Input props.name must resolve to a non-empty string")
      }
      if (typeof value !== "string") {
        throw new ScreenError("SCREEN_INVALID_FIELD", `Input props.value must resolve to a string: ${name}`)
      }
      if (hasOwn(form, name)) {
        throw new ScreenError("SCREEN_INVALID_FIELD", `duplicate input name: ${name}`)
      }
      form[name] = value
    }

    if ("children" in node) {
      appendInitialForm(node.children, form)
    }
  }
}

function selectedNodeNames(value: InertValue, path: string): readonly string[] {
  if (typeof value === "string") {
    return [value]
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value
  }

  throw new ScreenError("SCREEN_INVALID_FIELD", "Include selection must resolve to a string or string array", path)
}

function resolveAction(node: ActionNode, context: UiRuntimeContext, path: string): ResolvedActionNode {
  return {
    tag: "Action",
    props: resolveRecord(node.props, context, `${path}.props`),
    call: resolveCall(node.call, context, `${path}.call`),
  }
}

function resolveCall(call: UiCall, context: UiRuntimeContext, path: string): ResolvedUiCall {
  const functionName = resolveValueAtPath(call.function, context, `${path}.function`)
  if (typeof functionName !== "string") {
    throw new ScreenError("SCREEN_INVALID_FIELD", "call function must resolve to a string", `${path}.function`)
  }

  return {
    namespace: call.namespace,
    function: functionName,
    args: resolveRecord(call.args, context, `${path}.args`),
  }
}

function resolveRecord(record: InertRecord, context: UiRuntimeContext, path: string): InertRecord {
  const resolved = resolveValueAtPath(record, context, path)
  if (!isRecordObject(resolved)) {
    throw new ScreenError("SCREEN_INVALID_FIELD", "expected resolved object", path)
  }

  return resolved as InertRecord
}
