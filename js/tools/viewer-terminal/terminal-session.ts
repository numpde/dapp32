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
  ResolvedScreenElement,
} from "../../packages/cam-screen/dist/index.js"

import { createTerminalBackendFromEnv } from "./backends/index.ts"
import type {
  DebugEvent,
  TerminalBackend,
} from "./types.ts"

type TerminalButtonElement = Extract<ResolvedScreenElement, { readonly type: "button" }>

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
      case "screen":
        printScreen(context.session.snapshot())
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

  const result = await session.dispatchAction(button.action)
  if (result.type === "navigated") {
    render(result.snapshot)
    return
  }

  output.write("Contract call requested; no transaction was sent.\n")
  output.write(`contract: ${result.call.contract}\n`)
  output.write(`address: ${result.call.address}\n`)
  output.write(`function: ${result.call.function}\n`)
  output.write(`args: ${formatValue(result.call.args)}\n`)
}

function render(snapshot: CamViewerSnapshot): void {
  output.write("\n")
  output.write(`route: ${loadedText(snapshot.route)}\n`)
  output.write(`screen: ${presentText(snapshot.screenURI)}\n`)

  if (snapshot.resolvedScreen?.title !== undefined) {
    output.write(`\n${snapshot.resolvedScreen.title}\n`)
  }

  if (snapshot.resolvedScreen === undefined) {
    output.write("\n(no resolved screen)\n\n")
    return
  }

  const buttons: TerminalButtonElement[] = []
  for (const element of snapshot.resolvedScreen.elements) {
    renderElement(element, buttons)
  }

  if (buttons.length > 0) {
    output.write("\nActions\n")
    buttons.forEach((button, index) => {
      output.write(`${index + 1}. ${button.label}\n`)
    })
  }

  output.write("\n")
}

function renderElement(
  element: ResolvedScreenElement,
  buttons: TerminalButtonElement[],
): void {
  switch (element.type) {
    case "text":
      output.write(`\n${element.text}\n`)
      return
    case "input":
      output.write(`${element.label}: ${formatValue(element.value)}\n`)
      return
    case "address":
      output.write(`${element.label}: ${element.address}\n`)
      return
    case "status":
      output.write(`${element.label}: ${formatValue(element.value)}\n`)
      return
    case "nft":
      output.write(`NFT: ${element.contractAddress} #${formatValue(element.tokenId)}\n`)
      return
    case "button":
      buttons.push(element)
      return
  }
}

function buttonsOf(snapshot: CamViewerSnapshot): readonly TerminalButtonElement[] {
  if (snapshot.resolvedScreen === undefined) {
    throw new Error("viewer has no resolved screen")
  }

  return snapshot.resolvedScreen.elements.filter(
    (element): element is TerminalButtonElement => element.type === "button",
  )
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
    screenURI: snapshot.screenURI,
    account: snapshot.account,
    params: snapshot.params,
    form,
  }, jsonReplacer, 2)}\n`)
}

function printPromptContext(context: TerminalContext): void {
  const snapshot = context.session.snapshot()
  output.write("Context before command:\n")
  output.write(`  backend: ${context.backend.name}\n`)
  output.write(`  host: ${context.backend.hostLabel}\n`)
  output.write(`  account: ${accountText(snapshot.account)}\n`)
  output.write(`  params: ${formatValue(snapshot.params)}\n`)
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
    label: button.label,
    action: button.action,
  })), jsonReplacer, 2)}\n`)
}

function printScreen(snapshot: CamViewerSnapshot): void {
  let screen: unknown = null
  if (snapshot.resolvedScreen !== undefined) {
    screen = snapshot.resolvedScreen
  }

  output.write(`${JSON.stringify(screen, jsonReplacer, 2)}\n`)
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
    "  show                  Render the current resolved screen.",
    "  form                  Print route, screen URI, account, params, and screen form.",
    "  values                Print the current route return values.",
    "  actions               Print resolved button actions and their button numbers.",
    "  screen                Print the resolved screen document.",
    "  trace                 Print backend contract reads and resource loads.",
    "  trace clear           Clear the trace buffer.",
    "  restart               Reset the backend session and reload the entry route.",
    "  set <name> <value>    Update local screen form and re-resolve actions.",
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
