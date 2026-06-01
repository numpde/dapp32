import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"

import type {
  CamViewerSession,
  CamViewerSnapshot,
} from "../../packages/cam-viewer/dist/index.js"
import {
  toInertValue,
} from "../../packages/cam-protocol/dist/index.js"
import type {
  ResolvedActionNode,
  ResolvedUiNode,
} from "../../packages/cam-screen/dist/index.js"

import { createTerminalBackendFromEnv } from "./backends/index.ts"
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
  output.write(`Backend: ${backend.name} (${backend.description})\n`)
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
      case "form":
        printForm(context.session.snapshot())
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
      case "restart":
        await handleRestart(context)
        break
      case "set":
        handleSet(context.session, args)
        render(context.session.snapshot())
        break
      case "press":
        await handlePress(context.session, args)
        break
      case "quit":
      case "exit":
        keepRunning = false
        break
      default:
        output.write(`Unknown command: ${command}\n`)
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

  session.updateForm({
    [name]: toInertValue(valueParts.join(" ")),
  })
}

async function handleRestart(context: TerminalContext): Promise<void> {
  context.events.length = 0
  context.session = context.backend.createSession(context.events)
  await context.session.load()
  render(context.session.snapshot())
}

async function handlePress(session: CamViewerSession, args: readonly string[]): Promise<void> {
  const index = Number(args[0])
  if (!Number.isInteger(index) || index < 1) {
    throw new Error("usage: press <button-number>")
  }

  const button = buttonsOf(session.snapshot())[index - 1]
  if (button === undefined) {
    throw new Error(`button does not exist: ${index}`)
  }

  const result = await session.dispatchAction(button)
  if (result.type === "navigated") {
    render(result.snapshot)
    return
  }

  output.write("Contract call requested; no transaction was sent.\n")
  output.write(`route: ${result.call.route}\n`)
  output.write(`address: ${result.call.address}\n`)
  output.write(`function: ${result.call.function}\n`)
  output.write(`args: ${formatValue(result.call.args)}\n`)
  output.write(`then: ${result.call.then.namespace}.${result.call.then.function} ${formatValue(result.call.then.args)}\n`)
}

function render(snapshot: CamViewerSnapshot): void {
  output.write("\n")
  output.write(`route: ${loadedText(snapshot.route)}\n`)
  output.write(`ui: ${presentText(snapshot.uiURI)}\n`)

  const title = snapshot.resolvedUi?.props.title
  if (typeof title === "string") {
    output.write(`\n${title}\n`)
  }

  if (snapshot.resolvedUi === undefined) {
    output.write("\n(no resolved UI)\n\n")
    return
  }

  const buttons: ResolvedActionNode[] = []
  renderNode(snapshot.resolvedUi, buttons)

  if (buttons.length > 0) {
    output.write("\nActions\n")
    buttons.forEach((button, index) => {
      output.write(`${index + 1}. ${labelForAction(button)}\n`)
    })
  }

  output.write("\n")
}

function renderNode(
  node: ResolvedUiNode,
  buttons: ResolvedActionNode[],
): void {
  switch (node.tag) {
    case "Screen":
    case "Fragment":
      for (const child of node.children) {
        renderNode(child, buttons)
      }
      return
    case "Text":
      output.write(`\n${formatValue(node.props.text)}\n`)
      return
    case "Input":
      output.write(`${formatValue(node.props.label)}: ${formatValue(node.props.value)}\n`)
      return
    case "Address":
      output.write(`${formatValue(node.props.label)}: ${formatValue(node.props.address)}\n`)
      return
    case "Status":
      output.write(`${formatValue(node.props.label)}: ${formatValue(node.props.value)}\n`)
      return
    case "Nft":
      output.write(`NFT: ${formatValue(node.props.contractAddress)} #${formatValue(node.props.tokenId)}\n`)
      return
    case "Action":
      buttons.push(node)
      return
  }
}

function buttonsOf(snapshot: CamViewerSnapshot): readonly ResolvedActionNode[] {
  if (snapshot.resolvedUi === undefined) {
    throw new Error("viewer has no resolved UI")
  }

  const buttons: ResolvedActionNode[] = []
  collectButtons(snapshot.resolvedUi, buttons)
  return buttons
}

function collectButtons(node: ResolvedUiNode, buttons: ResolvedActionNode[]): void {
  if (node.tag === "Action") {
    buttons.push(node)
    return
  }

  for (const child of node.children) {
    collectButtons(child, buttons)
  }
}

function labelForAction(action: ResolvedActionNode): string {
  const label = action.props.label
  return typeof label === "string" ? label : formatValue(action.props)
}

function formatValue(value: unknown): string {
  if (typeof value === "bigint") {
    return value.toString()
  }

  if (typeof value === "string") {
    return value
  }

  return JSON.stringify(value)
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `Error: ${error.message}\n`
  }

  return `Error: ${String(error)}\n`
}

function printForm(snapshot: CamViewerSnapshot): void {
  let form: unknown = null
  if (snapshot.form !== undefined) {
    form = snapshot.form
  }

  output.write(`${JSON.stringify({
    route: snapshot.route,
    uiURI: snapshot.uiURI,
    account: snapshot.account,
    inputs: snapshot.inputs,
    form,
  }, jsonReplacer, 2)}\n`)
}

function printPromptContext(context: TerminalContext): void {
  const snapshot = context.session.snapshot()
  output.write("Context before command:\n")
  output.write(`  backend: ${context.backend.name}\n`)
  output.write(`  host: ${context.backend.hostLabel}\n`)
  output.write(`  account: ${accountText(snapshot.account)}\n`)
  output.write(`  inputs: ${formatValue(snapshot.inputs)}\n`)
  output.write(`  form: ${snapshot.form === undefined ? "(not loaded)" : formatValue(snapshot.form)}\n`)
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
    "  form                  Print route, UI URI, account, inputs, and form.",
    "  values                Print the current route return values.",
    "  actions               Print resolved actions and their button numbers.",
    "  ui                    Print the resolved UI tree.",
    "  trace                 Print backend contract reads and resource loads.",
    "  trace clear           Clear the trace buffer.",
    "  restart               Reset the backend session and reload the entry route.",
    "  set <name> <value>    Update local UI form and re-resolve actions.",
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
