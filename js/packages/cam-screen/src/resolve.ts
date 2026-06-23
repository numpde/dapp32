import { UiError } from "./errors.ts"
import { resolveValueAtPath } from "./expressions.ts"
import {
  createStringMap,
  hasOwn,
  isAbiAddressValue,
  isExpressionIdentifier,
  isRecordObject,
  nameListShapeIssues,
  UI_CALL_NAMESPACE_BY_ELEMENT,
  UI_PROP_SCHEMAS,
  UI_RUNTIME_ROOTS,
} from "@cam/protocol"
import type { InertRecord, InertValue } from "@cam/protocol"
import type {
  ButtonNode,
  IncludeNode,
  ResolvedButtonNode,
  ResolvedContainerNode,
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
  const resolved = resolveNamedNode(ui, nodeName, args, context, nodeName, [])
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
  const state = createInitialState(ui, nodeName, args, initialContext)
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
  return resolveNode(ui, node, nodeContext, path, [...stack, nodeName])
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
  stack: readonly string[],
): readonly ResolvedUiNode[] {
  switch (node.element) {
    case "Include":
      return resolveInclude(ui, node, context, path, stack)
    case "Button":
      return [resolveAction(node, context, path)]
    case "Screen":
    case "Fragment":
      return [resolveElementNode(ui, node, context, path, stack)]
    case "Text":
    case "Address":
    case "Status":
    case "Nft":
      return [{
        element: node.element,
        props: resolveProps(node.element, node.props, context, `${path}.props`),
        children: [] as const,
      }]
    case "TextField":
      return [{
        element: node.element,
        props: resolveProps(node.element, node.props, context, `${path}.props`),
        state: resolveStateBinding(node.state, context, `${path}.state`, false),
        children: [] as const,
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
  stack: readonly string[],
): ResolvedContainerNode {
  const children: ResolvedUiNode[] = []

  for (const [index, child] of node.children.entries()) {
    children.push(...resolveNode(ui, child, context, `${path}.children.${index}`, stack))
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
  stack: readonly string[],
): readonly ResolvedUiNode[] {
  if (node.call.namespace !== UI_CALL_NAMESPACE_BY_ELEMENT.Include) {
    throw new UiError("UI_INVALID_FIELD", `Include must call the ui namespace: ${node.call.namespace}`, `${path}.call.namespace`)
  }

  const selected = resolveValueAtPath(node.call.function, context, `${path}.call.function`)
  const nodeNames = selectedNodeNames(selected, `${path}.call.function`)
  const args = resolveRecord(node.call.args, context, `${path}.call.args`)
  const children: ResolvedUiNode[] = []

  for (const nodeName of nodeNames) {
    children.push(...resolveNamedNode(ui, nodeName, args, context, `${path}.${nodeName}`, stack))
  }

  return children
}

function createInitialState(
  ui: UiDocument,
  nodeName: string,
  args: InertRecord,
  context: UiRuntimeContext,
): InertRecord {
  const state = createStringMap<InertValue>()
  collectInitialStateForNamedNode(ui, nodeName, args, context, nodeName, state, [])
  return state
}

function collectInitialStateForNamedNode(
  ui: UiDocument,
  nodeName: string,
  args: InertRecord,
  context: UiRuntimeContext,
  path: string,
  state: Record<string, InertValue>,
  stack: readonly string[],
): void {
  if (stack.includes(nodeName)) {
    throw new UiError("UI_INVALID_FIELD", `UI Include cycle detected: ${[...stack, nodeName].join(" -> ")}`, path)
  }
  if (!hasOwn(ui.nodes, nodeName)) {
    throw new UiError("UI_UNRESOLVED_VALUE", `UI node does not exist: ${nodeName}`, path)
  }

  const node = ui.nodes[nodeName]
  const nodeContext = contextForNode(node, args, context, path)
  collectInitialStateFromNode(ui, node, nodeContext, path, state, [...stack, nodeName])
}

function collectInitialStateFromNode(
  ui: UiDocument,
  node: UiNode,
  context: UiRuntimeContext,
  path: string,
  state: Record<string, InertValue>,
  stack: readonly string[],
): void {
  switch (node.element) {
    case "TextField": {
      const binding = resolveStateBinding(node.state, context, `${path}.state`, true)
      if (binding.defaultValue === undefined) {
        throw new UiError("UI_INVALID_FIELD", "TextField state.defaultValue was not resolved")
      }
      if (hasOwn(state, binding.key)) {
        throw new UiError("UI_INVALID_FIELD", `duplicate TextField state key: ${binding.key}`)
      }
      state[binding.key] = binding.defaultValue
      return
    }
    case "Screen":
    case "Fragment":
      for (const [index, child] of node.children.entries()) {
        collectInitialStateFromNode(ui, child, context, `${path}.children.${index}`, state, stack)
      }
      return
    case "Include":
      collectInitialStateFromInclude(ui, node, context, path, state, stack)
      return
    case "Button":
    case "Text":
    case "Address":
    case "Status":
    case "Nft":
      return
  }

  return unreachableUiNode(node)
}

function collectInitialStateFromInclude(
  ui: UiDocument,
  node: IncludeNode,
  context: UiRuntimeContext,
  path: string,
  state: Record<string, InertValue>,
  stack: readonly string[],
): void {
  if (node.call.namespace !== UI_CALL_NAMESPACE_BY_ELEMENT.Include) {
    throw new UiError("UI_INVALID_FIELD", `Include must call the ui namespace: ${node.call.namespace}`, `${path}.call.namespace`)
  }

  const selected = resolveValueAtPath(node.call.function, context, `${path}.call.function`)
  const nodeNames = selectedNodeNames(selected, `${path}.call.function`)
  // Initial-state collection only needs TextField state bindings. Skip args
  // for statically action-only targets so Buttons may read $state after the
  // defaults have been collected.
  let args: InertRecord | undefined
  for (const nodeName of nodeNames) {
    if (!nodeCanExposeInitialState(ui, nodeName, stack)) continue

    if (args === undefined) {
      args = resolveRecord(node.call.args, context, `${path}.call.args`)
    }
    collectInitialStateForNamedNode(ui, nodeName, args, context, `${path}.${nodeName}`, state, stack)
  }
}

function nodeCanExposeInitialState(ui: UiDocument, nodeName: string, stack: readonly string[]): boolean {
  if (stack.includes(nodeName)) return true

  const node = ui.nodes[nodeName]
  if (node === undefined) return true

  switch (node.element) {
    case "TextField":
      return true
    case "Screen":
    case "Fragment":
      return node.children.some((child) => nodeBodyCanExposeInitialState(child, [...stack, nodeName]))
    case "Include":
      // Dynamic Include targets may expose TextFields; collect through them so
      // initial state is complete when the selector is known at runtime.
      return true
    case "Button":
    case "Text":
    case "Address":
    case "Status":
    case "Nft":
      return false
  }
}

function nodeBodyCanExposeInitialState(node: UiNode, stack: readonly string[]): boolean {
  switch (node.element) {
    case "TextField":
      return true
    case "Screen":
    case "Fragment":
      return node.children.some((child) => nodeBodyCanExposeInitialState(child, stack))
    case "Include":
      return true
    case "Button":
    case "Text":
    case "Address":
    case "Status":
    case "Nft":
      return false
  }
}

function resolveStateBinding(
  state: {
    readonly key: InertValue
    readonly defaultValue: InertValue
  },
  context: UiRuntimeContext,
  path: string,
  includeDefault: boolean,
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

  if (!includeDefault) {
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
  for (const issue of nameListShapeIssues(names)) {
    if (issue.kind === "empty") {
      throw new UiError("UI_INVALID_FIELD", "Include selection must not contain an empty node name", path)
    }
    if (issue.kind === "duplicate") {
      throw new UiError("UI_INVALID_FIELD", `Include selection must not duplicate node names: ${issue.name}`, path)
    }
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
  for (const name of UI_PROP_SCHEMAS[element].address) {
    requireAddressProp(resolved, name, path)
  }

  return resolved
}

function requireStringProp(props: InertRecord, name: string, path: string): void {
  if (typeof props[name] !== "string") {
    throw new UiError("UI_INVALID_FIELD", `UI prop must resolve to a string: ${name}`, `${path}.${name}`)
  }
}

function requireAddressProp(props: InertRecord, name: string, path: string): void {
  const value = props[name]
  if (typeof value === "string" && isAbiAddressValue(value)) {
    return
  }

  throw new UiError("UI_INVALID_FIELD", `UI prop must resolve to an address: ${name}`, `${path}.${name}`)
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
