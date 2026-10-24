import { pathToFileURL } from "node:url"
import { createInterface } from "node:readline/promises"
import { assertPublishedCamRootURI, isRecordObject, parseJsonBytes, requireHttpOrigin, requireHttpURL } from "../packages/cam-protocol/dist/index.js"
import { DEPLOYMENT_SCHEMA as BIKE_SCHEMA, parseDeploymentArtifact as parseBike } from "./bike-nft-release/shared.ts"
import { DEPLOYMENT_SCHEMA as ESCROW_SCHEMA, parseDeploymentArtifact as parseEscrow } from "./escrow-release/shared.ts"
import { DEPLOYMENT_SCHEMA as PAYMENTS_SCHEMA, parseDeploymentArtifact as parsePayments } from "./pay-to-play-release/shared.ts"
import { readBoundedRegularFile } from "./release-files.ts"
import { runReleaseTool } from "./release-values.ts"
import { requiredEnv } from "./input.ts"

const artifactReaders = [
  { app: "bike-nft", schema: BIKE_SCHEMA, parse: parseBike },
  { app: "escrow", schema: ESCROW_SCHEMA, parse: parseEscrow },
  { app: "pay-to-play", schema: PAYMENTS_SCHEMA, parse: parsePayments },
] as const

function readDeployment(bytes: Uint8Array, app?: string) {
  if (app !== undefined && !artifactReaders.some(reader => reader.app === app)) {
    throw new Error("Release viewer app must be bike-nft, escrow or pay-to-play")
  }
  const document = parseJsonBytes(bytes)
  const reader = artifactReaders.find(candidate => isRecordObject(document) && candidate.schema === document.schema)
  if (reader === undefined) throw new Error("Select a deployment.json artifact with a supported deployment schema, not a signing configuration")
  if (app !== undefined && reader.app !== app) throw new Error("APP does not match the selected deployment artifact")
  return { app: reader.app, deployment: reader.parse(bytes) }
}

function resourceOrigin(camURI: string, supplied?: string): string | undefined {
  assertPublishedCamRootURI(camURI, "deployment CAM URI")
  const explicit = supplied === undefined ? undefined : requireHttpOrigin(supplied, "release viewer resource origin")
  if (camURI.startsWith("ipfs://")) return explicit
  const origin = requireHttpURL(camURI, "deployment CAM URI").origin
  if (explicit !== undefined && explicit !== origin) throw new Error("HTTPS deployment CAM must use the explicit viewer resource origin")
  return origin
}

function viewerURL(deployment: ReturnType<typeof readDeployment>["deployment"], viewerOrigin: string, rpcUrl: string): string {
  const url = new URL(requireHttpOrigin(viewerOrigin, "release viewer origin"))
  url.search = new URLSearchParams({
    chainId: `eip155:${deployment.chainId}`, host: deployment.camRoot, account: deployment.deployer,
    rpcUrl: requireHttpURL(rpcUrl, "public browser RPC URL").href,
  }).toString()
  return url.href
}

export function releaseViewerURL(app: string, bytes: Uint8Array, viewerOrigin: string, suppliedOrigin: string | undefined, rpcUrl: string): string {
  const { deployment } = readDeployment(bytes, app)
  resourceOrigin(deployment.camURI, suppliedOrigin)
  return viewerURL(deployment, viewerOrigin, rpcUrl)
}

function publicEndpoint(catalog: unknown, chainId: number): { name: string; url: string } | undefined {
  if (catalog === undefined) return undefined
  if (!isRecordObject(catalog)) throw new Error("RPC catalog must be an object keyed by network name")
  const entry = Object.values(catalog).find(value => isRecordObject(value) && value.chainId === chainId)
  if (!isRecordObject(entry)) return undefined
  if (!isRecordObject(entry.services)) throw new Error("Matched RPC catalog entry must declare services")
  const endpoint = entry.services.public
  if (endpoint === undefined) return undefined
  if (typeof endpoint !== "string" || /[{}]/u.test(endpoint)) throw new Error("Public catalog RPC must be a complete keyless URL")
  return { name: typeof entry.name === "string" ? entry.name : `Chain ${chainId}`, url: requireHttpURL(endpoint, "public catalog RPC").href }
}

type Ask = (prompt: string) => Promise<string>

async function chooseRpc(chainId: number, catalog: unknown, ask: Ask): Promise<string> {
  const endpoint = publicEndpoint(catalog, chainId)
  if (endpoint !== undefined) {
    let correction = ""
    while (true) {
      const choice = (await ask(`${correction}Browser RPC for ${endpoint.name} (chain ${chainId}):\n1: Catalog public endpoint — ${endpoint.url}\n2: Enter another browser-public URL\ncancel: Stop\nChoice [1]: `)).trim()
      if (choice === "" || choice === "1") return endpoint.url
      if (choice === "2") break
      if (choice === "cancel") throw new Error("Viewer setup cancelled")
      correction = "Choose 1, 2 or cancel.\n"
    }
  }
  const question = `Browser RPC URL for chain ${chainId} (visible in the page link; no backend secrets; or cancel): `
  let prompt = question
  while (true) {
    const answer = (await ask(prompt)).trim()
    if (answer === "cancel") throw new Error("Viewer setup cancelled")
    try { return requireHttpURL(answer, "public browser RPC URL").href }
    catch (error) { prompt = `${error instanceof Error ? error.message : "Invalid browser RPC URL"}\n${question}` }
  }
}

export async function prepareReleaseViewer(options: {
  readonly bytes: Uint8Array
  readonly viewerOrigin: string
  readonly app?: string
  readonly resourceOrigin?: string
  readonly rpcUrl?: string
  readonly catalog?: unknown
  readonly ask?: Ask
}) {
  const { app, deployment } = readDeployment(options.bytes, options.app)
  const origin = resourceOrigin(deployment.camURI, options.resourceOrigin)
  let rpc = options.rpcUrl
  if (rpc === undefined) {
    if (options.ask === undefined) throw new Error("Set PUBLIC_RPC_URL to a browser-public endpoint, or run viewer setup in an interactive terminal")
    rpc = await chooseRpc(deployment.chainId, options.catalog, options.ask)
  }
  const rpcUrl = requireHttpURL(rpc, "public browser RPC URL").href
  return { app, resourceOrigin: origin, rpcUrl, url: viewerURL(deployment, options.viewerOrigin, rpcUrl) }
}

async function main(): Promise<void> {
  const env = process.env
  const bytes = await readBoundedRegularFile("/deployment/deployment.json", "deployment artifact", 1024 * 1024)
  const reader = env.RELEASE_VIEWER_INTERACTIVE === "1" && !env.RELEASE_VIEWER_RPC_URL
    ? createInterface({ input: process.stdin, output: process.stderr, terminal: false }) : undefined
  const inputClosed = new AbortController()
  reader?.once("close", () => inputClosed.abort())
  try {
    const settings = await prepareReleaseViewer({
      bytes, viewerOrigin: requiredEnv(env, "RELEASE_VIEWER_ORIGIN"),
      ...(env.RELEASE_VIEWER_APP ? { app: env.RELEASE_VIEWER_APP } : {}),
      ...(env.RELEASE_VIEWER_RESOURCE_ORIGIN ? { resourceOrigin: env.RELEASE_VIEWER_RESOURCE_ORIGIN } : {}),
      ...(env.RELEASE_VIEWER_RPC_URL ? { rpcUrl: env.RELEASE_VIEWER_RPC_URL } : {}),
      ...(reader === undefined ? {} : {
        catalog: parseJsonBytes(await readBoundedRegularFile("/catalog/rpc-catalog.json", "RPC catalog", 65536)),
        ask: async (prompt: string) => {
          try { return await reader.question(prompt, { signal: inputClosed.signal }) }
          catch (cause) {
            if (inputClosed.signal.aborted) throw new Error("Viewer setup input ended. Rerun interactively or set PUBLIC_RPC_URL.")
            throw new Error("Cannot read viewer setup input. Rerun interactively or set PUBLIC_RPC_URL.", { cause })
          }
        },
      }),
    })
    if (env.RELEASE_VIEWER_LOCAL === "1" && new URL(settings.url).searchParams.get("chainId") !== "eip155:31338") {
      throw new Error("Local release viewer requires a deployment on fixture chain 31338")
    }
    // Prompts go to stderr; stdout carries only these validated, newline-free fields.
    process.stdout.write([settings.app, settings.resourceOrigin ?? "", settings.rpcUrl, settings.url].join("\n") + "\n")
  } finally { reader?.close() }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) runReleaseTool(main)
