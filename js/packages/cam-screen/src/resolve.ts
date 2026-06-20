import { UiError } from "./errors.ts"
import { CAM_UI_NAMESPACE, UI_PROP_SCHEMAS, UI_RUNTIME_ROOTS } from "./constants.ts"
import { resolveValueAtPath } from "./expressions.ts"
import {
  createStringMap,
  hasOwn,
  isExpressionIdentifier,
  isRecordObject,
} from "@cam/protocol"
import type { InertRecord, InertValue } from "@cam/protocol"
import type {
  ButtonNode,
  IncludeNode,
  ResolvedButtonNode,
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
  const resolved = resolveNamedNode(ui, nodeName, args, context, nodeName, {
    includeActions: true,
    includeStateDefault: false,
  }, [])
  if (resolved.length !== 1) {
    throw new UiError("UI_INVALID_FIELD", `UI node did not resolve to one root node: ${nodeName}`, nodeName)
  }

  return resolved[0]
}

export function resolveInitialUiNode(
  ui: UiDocument,
  nodeName: string,
  args: InertRecord,
  context: UiRuntimeContext,
): {
  readonly state: InertRecord
  readonly resolvedUi: ResolvedUiNode
} {
  const emptyState = createStringMap<InertValue>()
  const initialContext = {
    ...context,
    state: emptyState,
  }
  const initialNodes = resolveNamedNode(ui, nodeName, args, initialContext, nodeName, {
    includeActions: false,
    includeStateDefault: true,
  }, [])
  const state = createInitialState(initialNodes)
  const resolvedUi = resolveUiNode(ui, nodeName, args, { ...context, state })

  return {
    state,
    resolvedUi,
  }
}

function resolveNamedNode(
  ui: UiDocument,
  nodeName: string,
  args: InertRecord,
  context: UiRuntimeContext,
  path: string,
  options: ResolveOptions,
  stack: readonly string[],
): readonly ResolvedUiNode[] {
  if (stack.includes(nodeName)) {
    throw new UiError("UI_INVALID_FIELD", `UI Include cycle detected: ${[...stack, nodeName].join(" -> ")}`, path)
  }
  if (!hasOwn(ui.nodes, nodeName)) {
    throw new UiError("UI_UNRESOLVED_VALUE", `UI node does not exist: ${nodeName}`, path)
  }

  const node = ui.nodes[nodeName]
  const nodeContext = contextForNode(node, args, context, path)
  return resolveNode(ui, node, nodeContext, path, options, [...stack, nodeName])
}

type ResolveOptions = {
  readonly includeActions: boolean
  readonly includeStateDefault: boolean
}

function contextForNode(
  node: UiNode,
  args: InertRecord,
  context: UiRuntimeContext,
  path: string,
): UiRuntimeContext {
  const requires = requireNamedNodeArgs(node, path)
  rejectRuntimeRootArgs(args, path)
  const nodeContext = {
    ...context,
    ...args,
  }

  for (const name of requires) {
    if (!hasOwn(args, name)) {
      throw new UiError("UI_UNRESOLVED_VALUE", `UI node argument is missing: ${name}`, `${path}.requires`)
    }
  }
  for (const name of Object.keys(args)) {
    if (!requires.includes(name)) {
      throw new UiError("UI_INVALID_FIELD", `UI node argument is not declared in requires: ${name}`, `${path}.args`)
    }
  }

  return nodeContext
}

function rejectRuntimeRootArgs(args: InertRecord, path: string): void {
  for (const name of Object.keys(args)) {
    if (UI_RUNTIME_ROOTS.has(name)) {
      throw new UiError("UI_INVALID_FIELD", `UI node args must not shadow runtime root: ${name}`, `${path}.args`)
    }
  }
}

function requireNamedNodeArgs(node: UiNode, path: string): readonly string[] {
  if (node.requires === undefined) {
    throw new UiError("UI_INVALID_FIELD", "named UI nodes must declare requires", `${path}.requires`)
  }

  return node.requires
}

function resolveNode(
  ui: UiDocument,
  node: UiNode,
  context: UiRuntimeContext,
  path: string,
  options: ResolveOptions,
  stack: readonly string[],
): readonly ResolvedUiNode[] {
  switch (node.element) {
    case "Include":
      return resolveInclude(ui, node, context, path, options, stack)
    case "Button":
      return options.includeActions ? [resolveAction(node, context, path)] : []
    case "Screen":
    case "Fragment":
      return [resolveElementNode(ui, node, context, path, options, stack)]
    case "Text":
    case "Address":
    case "Status":
    case "Nft":
      return [{
        element: node.element,
        props: resolveProps(node.element, node.props, context, `${path}.props`),
        children: [],
      }]
    case "TextField":
      return [{
        element: node.element,
        props: resolveProps(node.element, node.props, context, `${path}.props`),
        state: resolveStateBinding(node.state, context, `${path}.state`, options),
        children: [],
      }]
  }

  return unreachableUiNode(node)
}

function unreachableUiNode(_node: never): never {
  throw new UiError("UI_INVALID_FIELD", "unsupported UI node element")
}

function resolveElementNode(
  ui: UiDocument,
  node: Extract<UiNode, { readonly element: "Screen" | "Fragment" }>,
  context: UiRuntimeContext,
  path: string,
  options: ResolveOptions,
  stack: readonly string[],
): ResolvedElementNode {
  const children: ResolvedUiNode[] = []

  for (const [index, child] of node.children.entries()) {
    children.push(...resolveNode(ui, child, context, `${path}.children.${index}`, options, stack))
  }

  return {
    element: node.element,
    props: node.element === "Screen"
      ? resolveProps(node.element, node.props, context, `${path}.props`)
      : createStringMap<InertValue>(),
    children,
  }
}

function resolveInclude(
  ui: UiDocument,
  node: IncludeNode,
  context: UiRuntimeContext,
  path: string,
  options: ResolveOptions,
  stack: readonly string[],
): readonly ResolvedUiNode[] {
  if (node.call.namespace !== CAM_UI_NAMESPACE) {
    throw new UiError("UI_INVALID_FIELD", `Include must call the ui namespace: ${node.call.namespace}`, `${path}.call.namespace`)
  }

  const selected = resolveValueAtPath(node.call.function, context, `${path}.call.function`)
  const nodeNames = selectedNodeNames(selected, `${path}.call.function`)
  let args: InertRecord | undefined
  const children: ResolvedUiNode[] = []

  for (const nodeName of nodeNames) {
    if (!options.includeActions && ui.nodes[nodeName]?.element === "Button") {
      continue
    }

    args ??= resolveRecord(node.call.args, context, `${path}.call.args`)
    children.push(...resolveNamedNode(ui, nodeName, args, context, `${path}.${nodeName}`, options, stack))
  }

  return children
}

function createInitialState(nodes: readonly ResolvedUiNode[]): InertRecord {
  const state = createStringMap<InertValue>()
  appendInitialState(nodes, state)
  return state
}

function appendInitialState(nodes: readonly ResolvedUiNode[], state: Record<string, InertValue>): void {
  for (const node of nodes) {
    if (node.element === "TextField") {
      const { key, defaultValue } = requireStateDefault(node)
      if (hasOwn(state, key)) {
        throw new UiError("UI_INVALID_FIELD", `duplicate TextField state key: ${key}`)
      }
      state[key] = defaultValue
    }

    if ("children" in node) {
      appendInitialState(node.children, state)
    }
  }
}

function requireStateDefault(node: ResolvedUiNode): {
  readonly key: string
  readonly defaultValue: string
} {
  if (node.element !== "TextField" || node.state === undefined || node.state.defaultValue === undefined) {
    throw new UiError("UI_INVALID_FIELD", "TextField state.defaultValue was not resolved")
  }

  return {
    key: node.state.key,
    defaultValue: node.state.defaultValue,
  }
}

function resolveStateBinding(
  state: {
    readonly key: InertValue
    readonly defaultValue: InertValue
  },
  context: UiRuntimeContext,
  path: string,
  options: ResolveOptions,
): {
  readonly key: string
  readonly defaultValue?: string
} {
  const key = resolveValueAtPath(state.key, context, `${path}.key`)
  if (typeof key !== "string" || key.length === 0) {
    throw new UiError("UI_INVALID_FIELD", "TextField state.key must resolve to a non-empty string", `${path}.key`)
  }
  if (!isExpressionIdentifier(key)) {
    throw new UiError("UI_INVALID_FIELD", `TextField state.key must resolve to an expression identifier: ${key}`, `${path}.key`)
  }

  if (!options.includeStateDefault) {
    return { key }
  }

  const defaultValue = resolveValueAtPath(state.defaultValue, context, `${path}.defaultValue`)
  if (typeof defaultValue !== "string") {
    throw new UiError("UI_INVALID_FIELD", `TextField state.defaultValue must resolve to a string: ${key}`, `${path}.defaultValue`)
  }

  return {
    key,
    defaultValue,
  }
}

function selectedNodeNames(value: InertValue, path: string): readonly string[] {
  if (typeof value === "string") {
    return checkedSelectedNodeNames([value], path)
  }

  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return checkedSelectedNodeNames(value, path)
  }

  throw new UiError("UI_INVALID_FIELD", "Include selection must resolve to a string or string array", path)
}

function checkedSelectedNodeNames(names: readonly string[], path: string): readonly string[] {
  const seen = new Set<string>()
  for (const name of names) {
    if (name.length === 0) {
      throw new UiError("UI_INVALID_FIELD", "Include selection must not contain an empty node name", path)
    }
    if (seen.has(name)) {
      throw new UiError("UI_INVALID_FIELD", `Include selection must not duplicate node names: ${name}`, path)
    }
    seen.add(name)
  }

  return names
}

function resolveAction(node: ButtonNode, context: UiRuntimeContext, path: string): ResolvedButtonNode {
  return {
    element: "Button",
    props: resolveProps(node.element, node.props, context, `${path}.props`),
    call: resolveCall(node.call, context, `${path}.call`),
  }
}

function resolveProps(
  element: keyof typeof UI_PROP_SCHEMAS,
  props: InertRecord,
  context: UiRuntimeContext,
  path: string,
): InertRecord {
  const resolved = resolveRecord(props, context, path)
  for (const name of UI_PROP_SCHEMAS[element].string) {
    requireStringProp(resolved, name, path)
  }

  return resolved
}

function requireStringProp(props: InertRecord, name: string, path: string): void {
  if (typeof props[name] !== "string") {
    throw new UiError("UI_INVALID_FIELD", `UI prop must resolve to a string: ${name}`, `${path}.${name}`)
  }
}

function resolveCall(call: UiCall, context: UiRuntimeContext, path: string): ResolvedUiCall {
  const functionName = resolveValueAtPath(call.function, context, `${path}.function`)
  if (typeof functionName !== "string") {
    throw new UiError("UI_INVALID_FIELD", "call function must resolve to a string", `${path}.function`)
  }
  if (functionName.length === 0) {
    throw new UiError("UI_INVALID_FIELD", "call function must resolve to a non-empty string", `${path}.function`)
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
    throw new UiError("UI_INVALID_FIELD", "expected resolved object", path)
  }

  return resolved as InertRecord
}
