import { durationDraftFromSeconds, projectDurationDraft } from "./duration.ts"
import { UiError } from "./errors.ts"
import { resolveValueAtPath } from "./expressions.ts"
import { formatStatusLabel, formatStatusValue } from "./status-format.ts"
import { editAmountDraft, projectAmountDraft, sameAmountUnit } from "./amount.ts"
import { editIntegerDraft, projectIntegerDraft, integerBound, compareUnsignedDigits } from "./numeric.ts"
import {
  createStringMap,
  collectExpressionReferences,
  hasOwn,
  isAbiAddressValue,
  isExpressionIdentifier,
  isRecordObject,
  nameListShapeIssues,
  parseExpressionReference,
  UI_CALL_NAMESPACE_BY_ELEMENT,
  UI_PROP_SCHEMAS,
  UI_RUNTIME_ROOTS,
} from "@cam/protocol"
import type { InertRecord, InertValue } from "@cam/protocol"
import type {
  NumericDraft,
  ButtonNode,
  IncludeNode,
  ResolvedButtonNode,
  ResolvedContainerNode,
  ResolvedUiCall,
  ResolvedUiNode,
  UiCall,
  UiDocument,
  UiMembership,
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
    numericDrafts: createStringMap<NumericDraft>(),
  }
  const state = createInitialState(ui, nodeName, args, initialContext)
  const resolvedUi = resolveUiNode(ui, nodeName, args, { ...context, state, numericDrafts: initialContext.numericDrafts })

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
      return [{
        element: node.element,
        props: resolveProps(node.element, node.props, context, `${path}.props`),
        children: [] as const,
      }]
    case "Nft": {
      const props = resolveProps(node.element, node.props, context, `${path}.props`)
      if (props.metadataURI !== undefined && typeof props.metadataURI !== "string") throw new UiError("UI_INVALID_FIELD", "Nft metadataURI must resolve to a string", `${path}.props.metadataURI`)
      return [{ element: node.element, props, children: [] }]
    }
    case "Status": {
      const props = resolveProps(node.element, node.props, context, `${path}.props`)
      return [{
        element: node.element,
        props,
        ...(props.valueLabels !== undefined ? { formattedValue: formatStatusLabel(props.value, props.valueLabels, `${path}.props`) }
          : props.format === undefined ? {} : { formattedValue: formatStatusValue(props.value, props.format, `${path}.props`, props.zeroText) }),
        children: [] as const,
      }]
    }
    case "DocumentHashField": {
      const props = resolveProps(node.element, node.props, context, `${path}.props`)
      if (props.sourceURI !== undefined && typeof props.sourceURI !== "string") throw new UiError("UI_INVALID_FIELD", "DocumentHashField sourceURI must resolve to a string", `${path}.props.sourceURI`)
      return [{ element: node.element, ...resolveAvailability(node.enabledWhen, context, `${path}.enabledWhen`), props: { label: props.label as string, algorithm: "sha256", ...(props.sourceURI === undefined ? {} : { sourceURI: props.sourceURI }) }, state: resolveStateBinding(node.state, context, `${path}.state`, false, node.element), children: [] }]
    }
    case "ChoiceField": {
      const state = resolveStateBinding(node.state, context, `${path}.state`, false, node.element)
      if (!node.options.some(option => option.value === context.state[state.key])) {
        throw new UiError("UI_INVALID_FIELD", "Cannot select ChoiceField value: state must match a declared option.", `${path}.state.${state.key}`)
      }
      return [{ element: node.element, props: resolveProps(node.element, node.props, context, `${path}.props`),
        options: node.options, state, ...resolveAvailability(node.enabledWhen, context, `${path}.enabledWhen`), children: [] }]
    }
    case "TextField":
    case "NftMetadataField":
      return [{
        element: node.element,
        ...resolveAvailability(node.enabledWhen, context, `${path}.enabledWhen`),
        props: resolveProps(node.element, node.props, context, `${path}.props`),
        state: resolveStateBinding(node.state, context, `${path}.state`, false, node.element),
        children: [] as const,
      }]
    case "AmountField": {
      const state = resolveStateBinding(node.state, context, `${path}.state`, false, node.element)
      const source = context.numericDrafts !== undefined && hasOwn(context.numericDrafts, state.key) ? context.numericDrafts[state.key] : undefined
      const raw = context.state[state.key]
      if (source !== undefined && (source.kind !== "amount" || !sameAmountUnit(source.unit, node.unit))) {
        throw new UiError("UI_INVALID_FIELD", "AmountField unit changed during editing", `${path}.props.unit`)
      }
      if (source === undefined && typeof raw !== "string" && raw !== null) {
        throw new UiError("UI_INVALID_FIELD", "AmountField state must contain a base-unit string or null", `${path}.state`)
      }
      const projection = projectAmountDraft(source === undefined ? editAmountDraft(node.unit, "base", raw === null ? "" : raw as string) : source)
      return [{
        element: node.element,
        ...resolveAvailability(node.enabledWhen, context, `${path}.enabledWhen`),
        props: resolveProps("TextField", node.props, context, `${path}.props`),
        state,
        unit: node.unit,
        draft: projection.draft,
        children: [],
      }]
    }
    case "DurationField": {
      const state = resolveStateBinding(node.state, context, `${path}.state`, false, node.element)
      const props = resolveIntegerProps(node.props, context, `${path}.props`)
      const source = context.numericDrafts !== undefined && hasOwn(context.numericDrafts, state.key) ? context.numericDrafts[state.key] : undefined
      if (source !== undefined && source.kind !== "duration") throw new UiError("UI_INVALID_FIELD", "Duration field draft kind changed during editing", `${path}.state`)
      const raw = context.state[state.key]
      if (source === undefined && typeof raw !== "string" && raw !== null) throw new UiError("UI_INVALID_FIELD", "Duration field state must contain whole seconds as a decimal string or null", `${path}.state`)
      const projection = projectDurationDraft(source === undefined ? durationDraftFromSeconds(raw === null ? "" : raw as string) : source, props)
      return [{ element: node.element, ...resolveAvailability(node.enabledWhen, context, `${path}.enabledWhen`), props, state,
        draft: projection.draft, ...(projection.canonical === null ? {} : { formattedValue: formatStatusValue(projection.canonical, "durationSeconds", `${path}.props`) }), children: [] }]
    }
    case "NonNegativeIntegerField": {
      const state = resolveStateBinding(node.state, context, `${path}.state`, false, node.element)
      const props = resolveIntegerProps(node.props, context, `${path}.props`)
      const source = context.numericDrafts !== undefined && hasOwn(context.numericDrafts, state.key) ? context.numericDrafts[state.key] : undefined
      if (source !== undefined && source.kind !== "integer") throw new UiError("UI_INVALID_FIELD", "Integer field draft kind changed during editing", `${path}.state`)
      const raw = context.state[state.key]
      if (source === undefined && typeof raw !== "string" && raw !== null) throw new UiError("UI_INVALID_FIELD", "Integer field state must contain a decimal string or null", `${path}.state`)
      const projection = projectIntegerDraft(source === undefined ? editIntegerDraft(raw === null ? "" : raw as string) : source, props)
      return [{ element: node.element, ...resolveAvailability(node.enabledWhen, context, `${path}.enabledWhen`), props, state, draft: projection.draft, children: [] }]
    }
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
    case "DocumentHashField":
    case "ChoiceField":
    case "TextField":
    case "NftMetadataField":
    case "AmountField": {
      const binding = resolveStateBinding(node.state, context, `${path}.state`, true, node.element)
      if (binding.defaultValue === undefined) {
        throw new UiError("UI_INVALID_FIELD", `${node.element} state.defaultValue was not resolved`)
      }
      if (hasOwn(state, binding.key)) {
        throw new UiError("UI_INVALID_FIELD", `duplicate ${node.element} state key: ${binding.key}`)
      }
      if (node.element === "AmountField") {
        const draft = editAmountDraft(node.unit, "base", binding.defaultValue)
        const projection = projectAmountDraft(draft)
        if (projection.draft.status !== "valid" && projection.draft.status !== "empty") {
          throw new UiError("UI_INVALID_FIELD", "AmountField defaultValue must be an exact bounded base-unit amount or empty string", `${path}.state.defaultValue`)
        }
        state[binding.key] = projection.canonical
        const drafts = context.numericDrafts as Record<string, NumericDraft>
        drafts[binding.key] = draft
      } else state[binding.key] = node.element === "NftMetadataField" && binding.defaultValue === "" ? null : binding.defaultValue
      return
    }
    case "DurationField": {
      const binding = resolveStateBinding(node.state, context, `${path}.state`, true, node.element)
      if (binding.defaultValue === undefined) throw new UiError("UI_INVALID_FIELD", "Duration field defaultValue was not resolved", `${path}.state.defaultValue`)
      if (hasOwn(state, binding.key)) throw new UiError("UI_INVALID_FIELD", `duplicate ${node.element} state key: ${binding.key}`, `${path}.state.key`)
      const draft = durationDraftFromSeconds(binding.defaultValue)
      const projection = projectDurationDraft(draft, resolveIntegerProps(node.props, context, `${path}.props`))
      if (projection.draft.status !== "valid" && projection.draft.status !== "empty") throw new UiError("UI_INVALID_FIELD", "Duration defaultValue must be whole seconds satisfying its bounds, or empty", `${path}.state.defaultValue`)
      state[binding.key] = projection.canonical
      const drafts = context.numericDrafts as Record<string, NumericDraft>
      drafts[binding.key] = draft
      return
    }
    case "NonNegativeIntegerField": {
      const binding = resolveStateBinding(node.state, context, `${path}.state`, true, node.element)
      if (binding.defaultValue === undefined) throw new UiError("UI_INVALID_FIELD", "Integer field defaultValue was not resolved", `${path}.state.defaultValue`)
      if (hasOwn(state, binding.key)) throw new UiError("UI_INVALID_FIELD", `duplicate ${node.element} state key: ${binding.key}`, `${path}.state.key`)
      const props = resolveIntegerProps(node.props, context, `${path}.props`)
      const draft = editIntegerDraft(binding.defaultValue)
      const projection = projectIntegerDraft(draft, props)
      if (projection.draft.status !== "valid" && projection.draft.status !== "empty") throw new UiError("UI_INVALID_FIELD", "Integer field defaultValue must satisfy its bounds or be empty", `${path}.state.defaultValue`)
      state[binding.key] = projection.canonical
      const drafts = context.numericDrafts as Record<string, NumericDraft>
      drafts[binding.key] = draft
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
    case "DocumentHashField":
    case "ChoiceField":
    case "TextField":
    case "NftMetadataField":
    case "AmountField":
    case "DurationField":
    case "NonNegativeIntegerField":
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
    case "DocumentHashField":
    case "ChoiceField":
    case "TextField":
    case "NftMetadataField":
    case "AmountField":
    case "DurationField":
    case "NonNegativeIntegerField":
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
  element: "ChoiceField" | "TextField" | "NftMetadataField" | "DocumentHashField" | "AmountField" | "NonNegativeIntegerField" | "DurationField",
): {
  readonly key: string
  readonly defaultValue?: string
} {
  const key = resolveValueAtPath(state.key, context, `${path}.key`)
  if (typeof key !== "string" || key.length === 0) {
    throw new UiError("UI_INVALID_FIELD", `${element} state.key must resolve to a non-empty string`, `${path}.key`)
  }
  if (!isExpressionIdentifier(key)) {
    throw new UiError("UI_INVALID_FIELD", `${element} state.key must resolve to an expression identifier: ${key}`, `${path}.key`)
  }

  if (!includeDefault) {
    return { key }
  }

  const defaultValue = resolveValueAtPath(state.defaultValue, context, `${path}.defaultValue`)
  if (typeof defaultValue !== "string") {
    throw new UiError("UI_INVALID_FIELD", `${element} state.defaultValue must resolve to a string: ${key}`, `${path}.defaultValue`)
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
  const directStateBindings = createStringMap<string>()
  for (const [input, value] of Object.entries(node.call.args)) {
    if (typeof value !== "string") continue
    const reference = parseExpressionReference(value, { numericSegments: true })
    if (reference?.root === "state" && reference.segments.length === 1) directStateBindings[input] = reference.segments[0]!
  }
  const stateDependencies = new Set<string>()
  for (const { reference } of collectExpressionReferences(node.call.args, { numericSegments: true })) {
    if (reference?.root === "state" && reference.segments.length === 1) stateDependencies.add(reference.segments[0]!)
  }
  return {
    element: "Button",
    ...resolveAvailability(node.enabledWhen, context, `${path}.enabledWhen`),
    props: resolveProps(node.element, node.props, context, `${path}.props`),
    call: resolveCall(node.call, context, `${path}.call`),
    ...(Object.keys(directStateBindings).length === 0 ? {} : { directStateBindings }),
    ...(stateDependencies.size === 0 ? {} : { stateDependencies: [...stateDependencies] }),
  }
}

function resolveAvailability(
  membership: UiMembership | undefined,
  context: UiRuntimeContext,
  path: string,
): { readonly disabled?: boolean } {
  if (membership === undefined) return {}
  const members = typeof membership.in === "string"
    ? resolveValueAtPath(membership.in, context, `${path}.in`)
    : membership.in
  if (!Array.isArray(members) || !members.every((member) => typeof member === "string" && member.length > 0)) {
    throw new UiError("UI_INVALID_FIELD", "enabledWhen.in must resolve to an array of non-empty strings", `${path}.in`)
  }
  return { disabled: !members.includes(membership.member) }
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

function resolveIntegerProps(props: InertRecord, context: UiRuntimeContext, path: string): { label: string; min?: string; max?: string } {
  const label = resolveValueAtPath(props.label, context, `${path}.label`)
  if (typeof label !== "string") throw new UiError("UI_INVALID_FIELD", "Integer field label must resolve to a string", `${path}.label`)
  // Bounds are declaration metadata, not editable form state. This is the same
  // read-only state context used when Include/default collection initializes a view.
  const boundContext = { ...context, state: createStringMap<InertValue>() }
  const min = hasOwn(props, "min") ? integerBound(resolveValueAtPath(props.min, boundContext, `${path}.min`), `${path}.min`) : undefined
  const max = hasOwn(props, "max") ? integerBound(resolveValueAtPath(props.max, boundContext, `${path}.max`), `${path}.max`) : undefined
  if (min !== undefined && max !== undefined && compareUnsignedDigits(min, max) > 0) throw new UiError("UI_INVALID_FIELD", "Integer field minimum must not exceed its maximum", path)
  return { label, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) }
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
