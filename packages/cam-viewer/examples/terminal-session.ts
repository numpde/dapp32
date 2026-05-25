import { readFile } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { fileURLToPath } from "node:url"

import type {
  Address,
  Hex,
  PublicClient,
} from "viem"

import { createCamViewerSession } from "../src/index.ts"
import type {
  CamViewerSession,
  CamViewerSnapshot,
} from "../src/index.ts"
import type {
  ResolvedButtonElement,
  ResolvedScreenElement,
} from "@cam/screen"

const ZERO_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as const
const HOST_ADDRESS = "0x0000000000000000000000000000000000000001" as const
const USER_ADDRESS = "0x0000000000000000000000000000000000000002" as const
const UI_ADDRESS = "0x0000000000000000000000000000000000000003" as const
const MANAGER_ADDRESS = "0x0000000000000000000000000000000000000004" as const
const COMPONENTS_ADDRESS = "0x0000000000000000000000000000000000000010" as const
const MOCK_CHAIN_ID = "eip155:31337"
const MOCK_CAM_BASE_URI = "file:///work/dapps/bike-nft/cam/"
const MOCK_CAM_URI = new URL("main.json", MOCK_CAM_BASE_URI).href

// This file is intentionally a mock terminal harness, not a general CAM
// viewer runner. It has no RPC, no network, and no environment-based target
// selection; all "chain" reads are deterministic in-process fakes.

async function main(): Promise<void> {
  const publicClient = createMockPublicClient()
  const session = createCamViewerSession({
    publicClient,
    host: {
      chainId: MOCK_CHAIN_ID,
      address: HOST_ADDRESS,
    },
    account: {
      address: USER_ADDRESS,
    },
    loadResource: createMockResourceLoader(),
  })

  await session.load()
  printHelp()
  render(session.snapshot())

  const terminal = createInterface({
    input,
    output,
    prompt: "> ",
  })
  const interactive = input.isTTY

  if (interactive) {
    terminal.prompt()
  }
  for await (const line of terminal) {
    const shouldContinue = await handleCommand(session, line)
    if (!shouldContinue) {
      break
    }

    if (interactive) {
      terminal.prompt()
    }
  }

  terminal.close()
}

async function handleCommand(session: CamViewerSession, rawLine: string): Promise<boolean> {
  const line = rawLine.trim()
  if (line.length === 0) {
    return true
  }

  const [command = "", ...args] = line.split(/\s+/)

  try {
    switch (command) {
      case "help":
        printHelp()
        return true
      case "show":
        render(session.snapshot())
        return true
      case "state":
        printSnapshot(session.snapshot())
        return true
      case "set":
        handleSet(session, args)
        render(session.snapshot())
        return true
      case "press":
        await handlePress(session, args)
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

function handleSet(session: CamViewerSession, args: readonly string[]): void {
  const [name, ...valueParts] = args
  if (name === undefined || valueParts.length === 0) {
    throw new Error("usage: set <name> <value>")
  }

  session.setState({
    [name]: valueParts.join(" "),
  })
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

  const buttons: ResolvedButtonElement[] = []
  for (const element of snapshot.resolvedScreen?.elements ?? []) {
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
  return (snapshot.resolvedScreen?.elements ?? []).filter(
    (element): element is ResolvedButtonElement => element.type === "button",
  )
}

function createMockPublicClient(): PublicClient {
  return {
    async readContract(request: {
      readonly functionName: string
      readonly args?: readonly unknown[]
    }): Promise<unknown> {
      switch (request.functionName) {
        case "camURI":
          return MOCK_CAM_URI
        case "camHash":
          return ZERO_HASH satisfies Hex
        case "contractAddress":
          return contractAddress(String(request.args?.[0] ?? ""))
        case "viewEntry":
          return [
            "./screens/entry.json",
            {
              account: request.args?.[0],
              canRegister: true,
              accountInfo: "Mock registrar account",
            },
          ]
        case "viewComponent":
          return componentRouteResult(String(request.args?.[0] ?? ""))
        case "viewRegister":
          return registerRouteResult(String(request.args?.[0] ?? ""))
        default:
          throw new Error(`unexpected readContract call: ${request.functionName}`)
      }
    },
  } as PublicClient
}

function contractAddress(name: string): Address {
  switch (name) {
    case "BicycleComponentManagerUI":
      return UI_ADDRESS
    case "BicycleComponentManager":
      return MANAGER_ADDRESS
    default:
      return "0x0000000000000000000000000000000000000000"
  }
}

function componentRouteResult(serialNumber: string): readonly unknown[] {
  return [
    "./screens/component.json",
    {
      exists: serialNumber.length > 0,
      serialHash: serialNumber.length > 0
        ? "0x1111111111111111111111111111111111111111111111111111111111111111"
        : "0x0000000000000000000000000000000000000000000000000000000000000000",
      tokenContract: COMPONENTS_ADDRESS,
      tokenId: serialNumber.length > 0 ? 42 : 0,
      owner: USER_ADDRESS,
      ownerInfo: "Mock owner account",
      registrar: USER_ADDRESS,
      status: serialNumber.length > 0 ? 1 : 0,
      tokenURI: serialNumber.length > 0 ? `ipfs://example/token/${serialNumber}` : "",
      registeredAt: serialNumber.length > 0 ? 1 : 0,
      updatedAt: serialNumber.length > 0 ? 2 : 0,
      serialNumber,
      permissions: 7,
      isOwner: true,
      canUpdateMetadata: serialNumber.length > 0,
      canMarkMissing: serialNumber.length > 0,
      canClearMissing: false,
      canRetire: serialNumber.length > 0,
    },
    {
      account: USER_ADDRESS,
      canRegister: true,
      accountInfo: "Mock registrar account",
    },
  ]
}

function registerRouteResult(serialNumber: string): readonly unknown[] {
  return [
    "./screens/register.json",
    {
      canRegister: true,
      exists: false,
      serialHash: serialNumber.length > 0
        ? "0x2222222222222222222222222222222222222222222222222222222222222222"
        : "0x0000000000000000000000000000000000000000000000000000000000000000",
      tokenId: 0,
      defaultComponents: COMPONENTS_ADDRESS,
      serialNumber,
      accountInfo: "Mock registrar account",
    },
    {
      account: USER_ADDRESS,
      canRegister: true,
      accountInfo: "Mock registrar account",
    },
  ]
}

function createMockResourceLoader(): (uri: string) => Promise<Uint8Array> {
  return async (uri: string): Promise<Uint8Array> => {
    const resourceURI = new URL(uri)
    if (resourceURI.protocol !== "file:") {
      throw new Error(`mock terminal loads file resources only: ${resourceURI.protocol}`)
    }

    requireMockCamFileURI(resourceURI)
    return await readFile(fileURLToPath(resourceURI))
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

function printSnapshot(snapshot: CamViewerSnapshot): void {
  output.write(`${JSON.stringify({
    route: snapshot.route,
    params: snapshot.params,
    state: snapshot.state,
    values: snapshot.values,
  }, jsonReplacer, 2)}\n`)
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value
}

function printHelp(): void {
  output.write("Commands: show, state, set <name> <value>, press <n>, help, quit\n")
}

main().catch((error: unknown) => {
  output.write(formatError(error))
  process.exitCode = 1
})
