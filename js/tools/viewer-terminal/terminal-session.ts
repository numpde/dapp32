import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

import type {
  CamViewerSession,
  CamViewerSnapshot,
} from "../../packages/cam-viewer/dist/index.js"
import { viewerErrorMessage } from "../../packages/cam-viewer/dist/index.js"
import {
  toInertValue,
} from "../../packages/cam-protocol/dist/index.js"
import {
  resolvedUiButtons,
  DURATION_PARTS,
} from "../../packages/cam-screen/dist/index.js"
import type {
  ResolvedButtonNode,
  ResolvedUiNode,
} from "../../packages/cam-screen/dist/index.js"

import { parsePositiveIntegerText } from "../input.ts"
import { parseTerminalAccount } from "./account-command.ts"
import { createTerminalBackendFromEnv } from "./backends/index.ts"
import { formatError, formatValue } from "./format.ts"
import type {
  DebugEvent,
  TerminalBackend,
} from "./types.ts"

type TerminalContext = {
  readonly backend: TerminalBackend
  session: CamViewerSession
  readonly events: DebugEvent[]
}

async function main(): Promise<void> {
  const backend = await createTerminalBackendFromEnv(process.env)
  const events: DebugEvent[] = []
  const context = {
    backend,
    session: backend.createSession(events),
    events,
  }

  await context.session.load()
  printHelp()
  output.write(`Backend: ${formatValue(backend.name)} (${formatValue(backend.description)})\n`)
  render(context.session.snapshot())

  const terminal = createInterface({
    input,
    output,
    prompt: "> ",
  })
  const interactive = input.isTTY

  if (interactive) {
    printPromptContext(context)
    terminal.prompt()
  }
  for await (const line of terminal) {
    const shouldContinue = await handleCommand(context, line)
    if (!shouldContinue) {
      break
    }

    if (interactive) {
      printPromptContext(context)
      terminal.prompt()
    }
  }

  terminal.close()
}

async function handleCommand(context: TerminalContext, rawLine: string): Promise<boolean> {
  const line = rawLine.trim()
  if (line.length === 0) {
    return true
  }

  const [command, ...args] = line.split(/\s+/)
  let keepRunning = true

  try {
    switch (command) {
      case "help":
        printHelp()
        break
      case "show":
        render(context.session.snapshot())
        break
      case "state":
        printState(context.session.snapshot())
        break
      case "values":
        printValues(context.session.snapshot())
        break
      case "actions":
        printActions(context.session.snapshot())
        break
      case "ui":
        printUi(context.session.snapshot())
        break
      case "trace":
        handleTrace(context, args)
        break
      case "account":
        await handleAccount(context.session, args)
        break
      case "restart":
        await handleRestart(context)
        break
      case "set":
        handleSet(context.session, args)
        render(context.session.snapshot())
        break
      case "amount": {
        const [name, representation, ...parts] = args
        if (name === undefined || representation !== "base" && representation !== "display") throw new Error("usage: amount <name> <base|display> [value]; omit value to clear")
        context.session.editAmount(name, representation, parts.join(" "))
        render(context.session.snapshot())
        break
      }
      case "duration": {
        const [name, part, ...parts] = args
        if (name === undefined || !(DURATION_PARTS as readonly unknown[]).includes(part)) throw new Error("usage: duration <name> <days|hours|minutes|seconds> [value]; omit value to clear that part")
        context.session.editDuration(name, part as typeof DURATION_PARTS[number], parts.join(" "))
        render(context.session.snapshot())
        break
      }
      case "integer": {
        const [name, ...parts] = args
        if (name === undefined) throw new Error("usage: integer <name> [value]; omit value to clear")
        context.session.editInteger(name, parts.join(" "))
        render(context.session.snapshot())
        break
      }
      case "press":
        await handlePress(context.session, args)
        break
      case "quit":
      case "exit":
        keepRunning = false
        break
      default:
        output.write(`Unknown command: ${formatValue(command)}\n`)
        output.write("Type help for available commands.\n")
        break
    }
  } catch (error) {
    output.write(formatError(error))
  }

  return keepRunning
}

function handleSet(session: CamViewerSession, args: readonly string[]): void {
  const [name, ...valueParts] = args
  if (name === undefined || valueParts.length === 0) {
    throw new Error("usage: set <name> <value>")
  }

  session.updateState({
    [name]: toInertValue(valueParts.join(" ")),
  })
}

async function handleAccount(session: CamViewerSession, args: readonly string[]): Promise<void> {
  const selection = parseTerminalAccount(args)
  await session.setAccount(selection.kind === "none"
    ? undefined
    : { address: selection.address })
  render(session.snapshot())
}

async function handleRestart(context: TerminalContext): Promise<void> {
  context.events.length = 0
  context.session = context.backend.createSession(context.events)
  await context.session.load()
  render(context.session.snapshot())
}

async function handlePress(session: CamViewerSession, args: readonly string[]): Promise<void> {
  const rawIndex = args[0]
  if (rawIndex === undefined) {
    throw new Error("usage: press <button-number>")
  }
  const index = parsePositiveIntegerText(rawIndex, "usage: press <button-number>")

  const button = buttonsOf(session.snapshot())[index - 1]
  if (button === undefined) {
    throw new Error(`button does not exist: ${index}`)
  }
  if (button.disabled === true) {
    throw new Error(`button is disabled in the current view: ${index}`)
  }

  const result = await session.dispatchAction(button)
  if (result.type === "navigated") {
    render(result.snapshot)
    return
  }

  output.write("Contract call requested; no transaction was sent.\n")
  output.write(`route: ${formatValue(result.call.route)}\n`)
  output.write(`address: ${formatValue(result.call.address)}\n`)
  output.write(`function: ${formatValue(result.call.function)}\n`)
  output.write(`args: ${formatValue(result.call.args)}\n`)
  if (result.call.value !== undefined) {
    output.write(`native amount (wei): ${formatValue(result.call.value)}\n`)
  }
  output.write(`then: ${formatValue(result.call.then.namespace)}.${formatValue(result.call.then.function)} ${formatValue(result.call.then.args)}\n`)
}

function render(snapshot: CamViewerSnapshot): void {
  output.write("\n")
  if (snapshot.integrityWarnings !== undefined) {
    for (const warning of snapshot.integrityWarnings) {
      output.write(`${warning.status === "mismatch" ? "WARNING: file hash mismatch" : "Notice: no verification hash (zero)"}: ${formatValue(viewerErrorMessage(warning.uri))}\n`)
      output.write(`expected (${warning.hashSource === "contract" ? "contract" : "app manifest"}): ${formatValue(warning.expectedHash)}\ndownloaded: ${formatValue(warning.actualHash)}\n`)
    }
  }
  if (snapshot.integrityWarnings !== undefined && snapshot.integrityWarnings.length > 0) output.write("UI displayed without confirmed integrity. Matching other file hashes does not authenticate an unverified CAM manifest.\n")
  output.write(`route: ${formatValue(loadedText(snapshot.route))}\n`)
  output.write(`ui: ${formatValue(presentText(snapshot.uiURI))}\n`)

  const root = snapshot.resolvedUi
  const title = root?.element === "Screen" ? root.props.title : undefined
  if (typeof title === "string") {
    output.write(`\n${formatValue(title)}\n`)
  }

  if (snapshot.resolvedUi === undefined) {
    output.write("\n(no resolved UI)\n\n")
    return
  }
  if (snapshot.state === undefined) {
    throw new Error("viewer snapshot has resolved UI but no state")
  }

  const buttons: ResolvedButtonNode[] = []
  renderNode(snapshot.resolvedUi, snapshot.state, buttons)

  if (buttons.length > 0) {
    output.write("\nActions\n")
    buttons.forEach((button, index) => {
      const label = button.props.label
      const text = typeof label === "string" ? label : formatValue(button.props)
      const disabled = button.disabled === true ? " (disabled)" : ""
      output.write(`${index + 1}. ${formatValue(text)}${disabled}\n`)
    })
  }

  output.write("\n")
}

function renderNode(
  node: ResolvedUiNode,
  state: Record<string, unknown>,
  buttons: ResolvedButtonNode[],
): void {
  switch (node.element) {
    case "Screen":
    case "Fragment":
      for (const child of node.children) {
        renderNode(child, state, buttons)
      }
      return
    case "Text":
      output.write(`\n${formatValue(node.props.text)}\n`)
      return
    case "TextField":
    case "NftMetadataField":
      output.write(`${formatValue(node.props.label)}${node.disabled === true ? " (disabled)" : ""}: ${formatValue(textFieldValue(node, state))}\n`)
      return
    case "ChoiceField":
      output.write(`${formatValue(node.props.label)}${node.disabled === true ? " (disabled)" : ""}: ${formatValue(state[node.state.key])}\n`)
      for (const option of node.options) output.write(`  ${formatValue(option.value)}: ${formatValue(option.label)}\n`)
      output.write(`  Choose with set ${formatValue(node.state.key)} <value>.\n`)
      return
    case "AmountField":
      output.write(`${formatValue(node.props.label)}${node.disabled === true ? " (disabled)" : ""}\n`)
      output.write(`  ${formatValue(node.unit.baseLabel)}: ${formatValue(node.draft.baseText)}\n`)
      output.write(`  ${formatValue(node.unit.displayLabel)}: ${formatValue(node.draft.displayText)}\n`)
      output.write(`  Edit with amount ${formatValue(node.state.key)} <base|display> [value].\n`)
      if (node.draft.status !== "valid") output.write(`  Amount ${node.draft.status}${node.draft.issue === undefined ? "" : `: ${node.draft.issue}`}; no amount is available to prepare.\n`)
      return
    case "DurationField":
      output.write(`${formatValue(node.props.label)}${node.disabled === true ? " (disabled)" : ""}\n`)
      for (const part of DURATION_PARTS) output.write(`  ${part}: ${formatValue(node.draft.parts[part].text)}\n`)
      output.write(`  Edit with duration ${formatValue(node.state.key)} <days|hours|minutes|seconds> [value]. Blank parts count as 0 once a value is entered.\n`)
      if (node.props.min !== undefined) output.write(`  Minimum seconds: ${formatValue(node.props.min)}\n`)
      if (node.props.max !== undefined) output.write(`  Maximum seconds: ${formatValue(node.props.max)}\n`)
      if (node.formattedValue !== undefined) output.write(`  Total: ${formatValue(node.formattedValue)}\n`)
      else output.write(`  Duration ${node.draft.status}${node.draft.issue === undefined ? "" : `: ${node.draft.issue}`}; no duration is available.\n`)
      return
    case "NonNegativeIntegerField":
      output.write(`${formatValue(node.props.label)}${node.disabled === true ? " (disabled)" : ""}: ${formatValue(node.draft.text)}\n`)
      if (node.props.min !== undefined) output.write(`  Minimum: ${formatValue(node.props.min)}\n`)
      if (node.props.max !== undefined) output.write(`  Maximum: ${formatValue(node.props.max)}\n`)
      if (node.draft.status !== "valid" && node.draft.status !== "empty") output.write(`  Integer ${node.draft.status}${node.draft.issue === undefined ? "" : `: ${node.draft.issue}`}; no value is available to prepare.\n`)
      return
    case "Address":
      output.write(`${formatValue(node.props.label)}: ${formatValue(node.props.address)}\n`)
      return
    case "Status":
      output.write(`${formatValue(node.props.label)}: ${formatValue(node.formattedValue === undefined ? node.props.value : node.formattedValue)}\n`)
      return
    case "Nft":
      output.write(`NFT: ${formatValue(node.props.contractAddress)} #${formatValue(node.props.tokenId)}\n`)
      if (node.props.metadataURI !== undefined) output.write(`Metadata URI: ${formatValue(node.props.metadataURI)}\n`)
      return
    case "Button":
      buttons.push(node)
      return
  }
}

function textFieldValue(node: ResolvedUiNode, state: Record<string, unknown>): unknown {
  if (node.element !== "TextField" && node.element !== "NftMetadataField") {
    throw new Error(`expected URI or text field node, got ${node.element}`)
  }

  return state[node.state.key]
}

function buttonsOf(snapshot: CamViewerSnapshot): readonly ResolvedButtonNode[] {
  if (snapshot.resolvedUi === undefined) {
    throw new Error("viewer has no resolved UI")
  }

  return resolvedUiButtons(snapshot.resolvedUi)
}

function labelForAction(action: ResolvedButtonNode): string {
  const label = action.props.label
  const text = typeof label === "string" ? label : formatValue(action.props)
  return `${text}${action.disabled === true ? " (disabled)" : ""}`
}

function printState(snapshot: CamViewerSnapshot): void {
  let state: unknown = null
  if (snapshot.state !== undefined) {
    state = snapshot.state
  }

  output.write(`${JSON.stringify({
    route: snapshot.route,
    uiURI: snapshot.uiURI,
    account: snapshot.account,
    inputs: snapshot.inputs,
    integrityWarnings: snapshot.integrityWarnings?.map(warning => ({ ...warning, uri: viewerErrorMessage(warning.uri) })),
    state,
  }, jsonReplacer, 2)}\n`)
}

function printPromptContext(context: TerminalContext): void {
  const snapshot = context.session.snapshot()
  output.write("Context before command:\n")
  output.write(`  backend: ${formatValue(context.backend.name)}\n`)
  output.write(`  host: ${formatValue(context.backend.hostLabel)}\n`)
  output.write(`  account: ${formatValue(accountText(snapshot.account))}\n`)
  output.write(`  inputs: ${formatValue(snapshot.inputs)}\n`)
  output.write(`  state: ${snapshot.state === undefined ? "(not loaded)" : formatValue(snapshot.state)}\n`)
  output.write(`  values: ${snapshot.values === undefined ? "(not loaded)" : formatValue(snapshot.values)}\n`)
}

function printValues(snapshot: CamViewerSnapshot): void {
  if (snapshot.values === undefined) {
    output.write("(not loaded)\n")
    return
  }

  output.write(`${JSON.stringify(snapshot.values, jsonReplacer, 2)}\n`)
}

function printActions(snapshot: CamViewerSnapshot): void {
  output.write(`${JSON.stringify(buttonsOf(snapshot).map((button, index) => ({
    index: index + 1,
    label: labelForAction(button),
    disabled: button.disabled === true,
    call: button.call,
  })), jsonReplacer, 2)}\n`)
}

function printUi(snapshot: CamViewerSnapshot): void {
  let ui: unknown = null
  if (snapshot.resolvedUi !== undefined) {
    ui = snapshot.resolvedUi
  }

  output.write(`${JSON.stringify(ui, jsonReplacer, 2)}\n`)
}

function loadedText(value: string | undefined): string {
  if (value === undefined) {
    return "(not loaded)"
  }

  return value
}

function presentText(value: string | undefined): string {
  if (value === undefined) {
    return "(none)"
  }

  return value
}

function accountText(account: CamViewerSnapshot["account"]): string {
  if (account === undefined) {
    return "(none)"
  }

  return account.address
}

function handleTrace(context: TerminalContext, args: readonly string[]): void {
  if (args[0] === "clear") {
    context.events.length = 0
    output.write("Trace cleared.\n")
    return
  }

  output.write(`${JSON.stringify(context.events, jsonReplacer, 2)}\n`)
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value
}

function printHelp(): void {
  output.write([
    "Commands:",
    "  show                  Render the current resolved UI.",
    "  state                  Print route, UI URI, account, inputs, and state.",
    "  values                Print the current route return values.",
    "  actions               Print resolved actions and their button numbers.",
    "  ui                    Print the resolved UI tree.",
    "  trace                 Print backend contract reads and resource loads.",
    "  trace clear           Clear the trace buffer.",
    "  account <address|none> Switch the viewer account and refresh the current route.",
    "  restart               Reset the backend session and reload the entry route.",
    "  set <name> <value>    Update local UI state and re-resolve actions.",
    "  amount <name> <base|display> [value]  Edit either amount unit; omit value to clear.",
    "  duration <name> <days|hours|minutes|seconds> [value]  Edit one duration part; omit value to clear it.",
    "  integer <name> [value]              Edit a whole number; omit value to clear.",
    "  press <n>             Dispatch a resolved button action.",
    "  help                  Print this help.",
    "  quit                  Exit.",
    "",
  ].join("\n"))
}

main().catch((error: unknown) => {
  output.write(formatError(error))
  process.exitCode = 1
})
