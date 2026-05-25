import { readFile } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { env, stdin as input, stdout as output } from "node:process"
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

const DEFAULT_MOCK_CAM_BASE_URI = "file:///work/dapps/bike-nft/cam/"
const DEFAULT_MOCK_CAM_URI = new URL("main.json", DEFAULT_MOCK_CAM_BASE_URI).href

// This file is intentionally a mock terminal harness, not a general CAM
// viewer runner. It proves stdin/stdout driving against checked-in CAM files
// while all on-chain reads are deterministic in-process fakes.
type MockTerminalConfig = {
  readonly hostAddress: Address
  readonly chainId: string
  readonly accountAddress: Address
  readonly mockCamURI: string
  readonly mockResourceBaseURIs: readonly string[]
}

async function main(): Promise<void> {
  const config = readMockConfig()
  const publicClient = createMockPublicClient(config)
  const session = createCamViewerSession({
    publicClient,
    host: {
      chainId: config.chainId,
      address: config.hostAddress,
    },
    account: {
      address: config.accountAddress,
    },
    loadResource: createMockResourceLoader(config),
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
      case "route":
        await handleRoute(session, args)
        render(session.snapshot())
        return true
      case "account":
        await handleAccount(session, args)
        render(session.snapshot())
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

async function handleRoute(session: CamViewerSession, args: readonly string[]): Promise<void> {
  const [route, ...paramArgs] = args
  if (route === undefined) {
    throw new Error("usage: route <route> [name=value ...]")
  }

  await session.navigate(route, {
    ...session.snapshot().params,
    ...parseParams(paramArgs),
  })
}

async function handleAccount(session: CamViewerSession, args: readonly string[]): Promise<void> {
  const [address] = args
  if (address === undefined) {
    throw new Error("usage: account <address|clear>")
  }

  if (address === "clear") {
    await session.setAccount(undefined)
    return
  }

  await session.setAccount({
    address: address as Address,
  })
}

function parseParams(args: readonly string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {}
  for (const arg of args) {
    const separator = arg.indexOf("=")
    if (separator <= 0) {
      throw new Error(`route parameter must be name=value: ${arg}`)
    }

    params[arg.slice(0, separator)] = arg.slice(separator + 1)
  }

  return params
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

function createMockPublicClient(config: MockTerminalConfig): PublicClient {
  return {
    async readContract(request: {
      readonly functionName: string
      readonly args?: readonly unknown[]
    }): Promise<unknown> {
      switch (request.functionName) {
        case "camURI":
          return config.mockCamURI
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
          return componentRouteResult(config, String(request.args?.[0] ?? ""))
        case "viewRegister":
          return registerRouteResult(config, String(request.args?.[0] ?? ""))
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

function componentRouteResult(config: MockTerminalConfig, serialNumber: string): readonly unknown[] {
  const account = config.accountAddress

  return [
    "./screens/component.json",
    {
      exists: serialNumber.length > 0,
      serialHash: serialNumber.length > 0
        ? "0x1111111111111111111111111111111111111111111111111111111111111111"
        : "0x0000000000000000000000000000000000000000000000000000000000000000",
      tokenContract: COMPONENTS_ADDRESS,
      tokenId: serialNumber.length > 0 ? 42 : 0,
      owner: account,
      ownerInfo: "Mock owner account",
      registrar: account,
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
      account,
      canRegister: true,
      accountInfo: "Mock registrar account",
    },
  ]
}

function registerRouteResult(config: MockTerminalConfig, serialNumber: string): readonly unknown[] {
  const account = config.accountAddress

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
      account,
      canRegister: true,
      accountInfo: "Mock registrar account",
    },
  ]
}

function createMockResourceLoader(config: MockTerminalConfig): (uri: string) => Promise<Uint8Array> {
  return async (uri: string): Promise<Uint8Array> => {
    const resourceURI = new URL(uri)
    if (resourceURI.protocol !== "file:") {
      throw new Error(`mock terminal loads file resources only: ${resourceURI.protocol}`)
    }

    requireAllowedFileURI(resourceURI, config.mockResourceBaseURIs)
    return await readFile(fileURLToPath(resourceURI))
  }
}

function requireAllowedFileURI(uri: URL, baseURIs: readonly string[]): void {
  for (const baseURI of baseURIs) {
    if (uri.href.startsWith(ensureTrailingSlash(new URL(baseURI).href))) {
      return
    }
  }

  throw new Error(`file resource is outside configured resource bases: ${uri.href}`)
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
  output.write(`${JSON.stringify(snapshot, jsonReplacer, 2)}\n`)
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value
}

function printHelp(): void {
  output.write("Commands: show, state, set <name> <value>, press <n>, route <name> [key=value ...], account <address|clear>, help, quit\n")
}

function readMockConfig(): MockTerminalConfig {
  const mockCamURI = env.CAM_VIEWER_MOCK_CAM_URI ?? DEFAULT_MOCK_CAM_URI
  const mockResourceBaseURIs = readList(
    env.CAM_VIEWER_MOCK_RESOURCE_BASE_URIS ?? env.CAM_VIEWER_MOCK_RESOURCE_BASE_URI,
    [directoryURI(mockCamURI)],
  )

  return {
    hostAddress: readAddress("CAM_VIEWER_MOCK_HOST_ADDRESS", HOST_ADDRESS),
    chainId: env.CAM_VIEWER_CHAIN_ID ?? "eip155:31337",
    accountAddress: readAddress("CAM_VIEWER_MOCK_ACCOUNT_ADDRESS", USER_ADDRESS),
    mockCamURI,
    mockResourceBaseURIs,
  }
}

function readAddress(name: string, fallback: Address): Address {
  const value = env[name] ?? fallback
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${name} must be an EVM address`)
  }

  return value as Address
}

function readList(value: string | undefined, fallback: readonly string[]): readonly string[] {
  if (value === undefined || value.trim().length === 0) {
    return fallback
  }

  return value.split(",").map((item) => item.trim()).filter((item) => item.length > 0)
}

function directoryURI(uri: string): string {
  const parsed = new URL(uri)
  const slash = parsed.pathname.lastIndexOf("/")
  parsed.pathname = slash < 0 ? "/" : parsed.pathname.slice(0, slash + 1)
  parsed.search = ""
  parsed.hash = ""
  return parsed.href
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`
}

main().catch((error: unknown) => {
  output.write(formatError(error))
  process.exitCode = 1
})
