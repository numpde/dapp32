import { readFile } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { fileURLToPath } from "node:url"

import {
  ZERO_HASH,
} from "../../packages/cam-evm-viem/dist/index.js"
import type {
  CamHost,
  LoadCamFromHostOptions,
} from "../../packages/cam-evm-viem/dist/index.js"
import {
  createCamViewerSession,
} from "../../packages/cam-viewer/dist/index.js"
import type {
  CamViewerSession,
  CamViewerSnapshot,
} from "../../packages/cam-viewer/dist/index.js"
import { toInertValue } from "../../packages/cam-core/dist/index.js"
import type { InertValue } from "../../packages/cam-core/dist/index.js"
import type {
  ResolvedScreenElement,
} from "../../packages/cam-screen/dist/index.js"
import {
  BIKE_ACCOUNT_ADDRESS as USER_ADDRESS,
  BIKE_HOST_ADDRESS as HOST_ADDRESS,
  BIKE_HOST_CHAIN_ID as MOCK_CHAIN_ID,
  BIKE_VIEW_COMPONENT,
  BIKE_VIEW_ENTRY,
  BIKE_VIEW_REGISTER,
  bikeAddressForContract,
  bikeComponentRouteResult,
  bikeEntryRouteResult,
  bikeRegisterRouteResult,
} from "../../tests/fixtures/cam/bike.ts"

type ResolvedButtonElement = Extract<ResolvedScreenElement, { readonly type: "button" }>
type MockAddress = CamHost["address"]
type MockPublicClient = LoadCamFromHostOptions["publicClient"]

const MOCK_CAM_BASE_URI = "file:///work/dapps/bike-nft/cam/"
const MOCK_CAM_URI = new URL("main.json", MOCK_CAM_BASE_URI).href

// This is an internal mock terminal harness for debugging the headless viewer.
// It is intentionally not a general CAM runner: there is no RPC, no network,
// and no environment-based target selection. All "chain" reads below are
// deterministic in-process fakes for the checked-in bike NFT CAM files.
type DebugEvent =
  | {
    readonly step: number
    readonly kind: "contract-read"
    readonly functionName: string
    readonly args: readonly InertValue[]
    readonly result: InertValue
  }
  | {
    readonly step: number
    readonly kind: "resource-load"
    readonly uri: string
    readonly bytes: number
  }

type TerminalContext = {
  session: CamViewerSession
  readonly events: DebugEvent[]
}

async function main(): Promise<void> {
  const events: DebugEvent[] = []
  const context = {
    session: createMockSession(events),
    events,
  }

  await context.session.load()
  printHelp()
  render(context.session.snapshot())

  const terminal = createInterface({
    input,
    output,
    prompt: "> ",
  })
  const interactive = input.isTTY

  if (interactive) {
    printPromptContext(context.session.snapshot())
    terminal.prompt()
  }
  for await (const line of terminal) {
    const shouldContinue = await handleCommand(context, line)
    if (!shouldContinue) {
      break
    }

    if (interactive) {
      printPromptContext(context.session.snapshot())
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

  try {
    switch (command) {
      case "help":
        printHelp()
        return true
      case "show":
        render(context.session.snapshot())
        return true
      case "state":
        printState(context.session.snapshot())
        return true
      case "values":
        printValues(context.session.snapshot())
        return true
      case "actions":
        printActions(context.session.snapshot())
        return true
      case "screen":
        printScreen(context.session.snapshot())
        return true
      case "trace":
        handleTrace(context, args)
        return true
      case "restart":
        await handleRestart(context)
        return true
      case "set":
        handleSet(context.session, args)
        render(context.session.snapshot())
        return true
      case "press":
        await handlePress(context.session, args)
        return true
      case "quit":
      case "exit":
        return false
      default:
        output.write(`Unknown command: ${command}\n`)
        output.write("Type help for available commands.\n")
        return true
    }
  } catch (error) {
    output.write(formatError(error))
    return true
  }
}

function createMockSession(events: DebugEvent[]): CamViewerSession {
  return createCamViewerSession({
    publicClient: createMockPublicClient(events),
    host: {
      chainId: MOCK_CHAIN_ID,
      address: HOST_ADDRESS,
    },
    account: {
      address: USER_ADDRESS,
    },
    params: {},
    state: {
      serialNumber: "",
    },
    loadResource: createMockResourceLoader(events),
  })
}

function handleSet(session: CamViewerSession, args: readonly string[]): void {
  const [name, ...valueParts] = args
  if (name === undefined || valueParts.length === 0) {
    throw new Error("usage: set <name> <value>")
  }

  session.setState({
    [name]: toInertValue(valueParts.join(" ")),
  })
}

async function handleRestart(context: TerminalContext): Promise<void> {
  context.events.length = 0
  context.session = createMockSession(context.events)
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
  output.write(`contract: ${result.action.contract}\n`)
  output.write(`function: ${result.action.function}\n`)
  output.write(`args: ${formatValue(result.action.args)}\n`)
}

function render(snapshot: CamViewerSnapshot): void {
  output.write("\n")
  output.write(`route: ${snapshot.route ?? "(not loaded)"}\n`)
  output.write(`screen: ${snapshot.screenURI ?? "(none)"}\n`)

  if (snapshot.resolvedScreen?.title !== undefined) {
    output.write(`\n${snapshot.resolvedScreen.title}\n`)
  }

  if (snapshot.resolvedScreen === undefined) {
    output.write("\n(no resolved screen)\n\n")
    return
  }

  const buttons: ResolvedButtonElement[] = []
  for (const element of snapshot.resolvedScreen.elements) {
    renderElement(element, snapshot, buttons)
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
  snapshot: CamViewerSnapshot,
  buttons: ResolvedButtonElement[],
): void {
  switch (element.type) {
    case "text":
      output.write(`\n${element.text}\n`)
      return
    case "input":
      // TODO(silent-defaults): this render fallback collapses missing state,
      // missing default value, and an intentional empty string. A real renderer
      // should distinguish those states.
      output.write(`${element.label}: ${formatValue(snapshot.state[element.name] ?? element.value ?? "")}\n`)
      return
    case "address":
      output.write(`${element.label ?? "Address"}: ${element.address}\n`)
      return
    case "status":
      output.write(`${element.label ?? "Status"}: ${formatValue(element.value)}\n`)
      return
    case "nft":
      output.write(`NFT: ${element.contractAddress} #${formatValue(element.tokenId)}\n`)
      return
    case "button":
      buttons.push(element)
      return
  }
}

function buttonsOf(snapshot: CamViewerSnapshot): readonly ResolvedButtonElement[] {
  if (snapshot.resolvedScreen === undefined) {
    throw new Error("viewer has no resolved screen")
  }

  return snapshot.resolvedScreen.elements.filter(
    (element): element is ResolvedButtonElement => element.type === "button",
  )
}

function createMockPublicClient(events: DebugEvent[]): MockPublicClient {
  return {
    async readContract(request: {
      readonly functionName: string
      readonly args?: readonly unknown[]
    }): Promise<unknown> {
      // TODO(silent-defaults): optional args come from the broad viem shape, but
      // CAM route calls should know whether a function expected arguments.
      const args = (request.args ?? []).map((arg) => toInertValue(arg))
      const result = mockReadContract(request.functionName, args)
      events.push({
        step: events.length + 1,
        kind: "contract-read",
        functionName: request.functionName,
        args,
        result,
      })
      return result
    },
  } as MockPublicClient
}

function mockReadContract(functionName: string, args: readonly InertValue[]): InertValue {
  switch (functionName) {
    case "camURI":
      requireNoArgs(functionName, args)
      return MOCK_CAM_URI
    case "camHash":
      requireNoArgs(functionName, args)
      return ZERO_HASH
    case "contractAddress":
      return contractAddress(requireStringArgs(functionName, args, 1)[0])
    case BIKE_VIEW_ENTRY:
      return bikeEntryRouteResult(requireStringArgs(functionName, args, 1)[0])
    case BIKE_VIEW_COMPONENT:
      return bikeComponentRouteResult(requireStringArgs(functionName, args, 2)[0])
    case BIKE_VIEW_REGISTER:
      return bikeRegisterRouteResult(requireStringArgs(functionName, args, 2)[0])
    default:
      throw new Error(`unexpected readContract call: ${functionName}`)
  }
}

function requireNoArgs(functionName: string, args: readonly InertValue[]): void {
  if (args.length !== 0) {
    throw new Error(`${functionName} expected no arguments, got ${args.length}`)
  }
}

function requireStringArgs(
  functionName: string,
  args: readonly InertValue[],
  length: number,
): readonly string[] {
  if (args.length !== length || args.some((arg) => typeof arg !== "string")) {
    throw new Error(`${functionName} expected ${length} string argument(s), got ${formatValue(args)}`)
  }

  return args as readonly string[]
}

function contractAddress(name: string): MockAddress {
  return bikeAddressForContract(name) as MockAddress
}

function createMockResourceLoader(events: DebugEvent[]): (uri: string) => Promise<Uint8Array> {
  return async (uri: string): Promise<Uint8Array> => {
    const resourceURI = new URL(uri)
    if (resourceURI.protocol !== "file:") {
      throw new Error(`mock terminal loads file resources only: ${resourceURI.protocol}`)
    }

    requireMockCamFileURI(resourceURI)
    const bytes = await readFile(fileURLToPath(resourceURI))
    events.push({
      step: events.length + 1,
      kind: "resource-load",
      uri: resourceURI.href,
      bytes: bytes.byteLength,
    })
    return bytes
  }
}

function requireMockCamFileURI(uri: URL): void {
  if (!uri.href.startsWith(MOCK_CAM_BASE_URI)) {
    throw new Error(`mock terminal can only load checked-in bike CAM files: ${uri.href}`)
  }
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

function printState(snapshot: CamViewerSnapshot): void {
  output.write(`${JSON.stringify({
    route: snapshot.route,
    screenURI: snapshot.screenURI,
    account: snapshot.account,
    params: snapshot.params,
    state: snapshot.state,
  }, jsonReplacer, 2)}\n`)
}

function printPromptContext(snapshot: CamViewerSnapshot): void {
  output.write("Context before command:\n")
  output.write(`  host: ${MOCK_CHAIN_ID} ${HOST_ADDRESS}\n`)
  output.write(`  account: ${snapshot.account?.address ?? "(none)"}\n`)
  output.write(`  params: ${formatValue(snapshot.params)}\n`)
  output.write(`  state: ${formatValue(snapshot.state)}\n`)
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
  output.write(`${JSON.stringify(snapshot.resolvedScreen ?? null, jsonReplacer, 2)}\n`)
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
    "  state                 Print route, screen URI, account, params, and local state.",
    "  values                Print the current route return values.",
    "  actions               Print resolved button actions and their button numbers.",
    "  screen                Print the resolved screen document.",
    "  trace                 Print mocked contract reads and resource loads.",
    "  trace clear           Clear the trace buffer.",
    "  restart               Reset the mock session and reload the entry route.",
    "  set <name> <value>    Set local screen state and re-resolve actions.",
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
