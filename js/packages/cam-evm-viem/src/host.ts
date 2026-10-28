import { parseCam } from "@cam/core"
import { assertLoadableCamRootURI, isAbiBytesValue, parseJsonBytes, resolveCamResourceURI } from "@cam/protocol"
import type { Hex } from "viem"

import { CAM_ROOT_FUNCTIONS, ICAM_APP_INTERFACE_ID, camRootAbi } from "./abi.ts"
import { assertClientChain } from "./chain.ts"
import { CamEvmError } from "./errors.ts"
import { verifyCamHash, verifyCamResourceIntegrity } from "./hash.ts"
import { loadResourceBytes } from "./resources.ts"
import type { CamIntegrityCheck, CamIntegrityWarning, LoadedCam, LoadCamFromHostOptions } from "./types.ts"

async function readManifestResource({
  publicClient,
  host,
  loadResource,
}: LoadCamFromHostOptions) {
  await assertClientChain(publicClient, host)
  await assertCamHostInterface(publicClient, host.address)

  let reference: unknown
  try {
    reference = await publicClient.readContract({
      address: host.address,
      abi: camRootAbi,
      functionName: CAM_ROOT_FUNCTIONS.camManifest,
    })
  } catch (cause) {
    throw new CamEvmError("CAM_HOST_READ_FAILED", `failed to read CAM manifest reference: ${host.address}`, cause)
  }
  if (typeof reference !== "object" || reference === null || Array.isArray(reference)) {
    throw new CamEvmError("CAM_HOST_READ_FAILED", "CAM host camManifest returned a non-struct reference")
  }
  const fields = reference as Record<string, unknown>
  const camURI = requireStringRootValue(fields.uri, "camManifest.uri")
  const camHash = requireBytes32RootValue(fields.sha256Digest, "camManifest.sha256Digest")
  try {
    assertLoadableCamRootURI(camURI, "CAM host camManifest.uri")
  } catch (cause) {
    throw new CamEvmError("CAM_DOCUMENT_INVALID", "CAM host camManifest.uri is not loadable", cause)
  }

  const camBytes = await loadResourceBytes(
    loadResource,
    camURI,
    `failed to load CAM resource: ${camURI}`,
  )
  return { camURI, camHash, camBytes }
}

export async function loadCamFromHost(options: LoadCamFromHostOptions): Promise<LoadedCam> {
  const { loadResource, onIntegrityWarning } = options
  const { camURI, camHash, camBytes } = await readManifestResource(options)
  verifyCamHash({
    bytes: camBytes,
    expectedHash: camHash,
    ...(onIntegrityWarning === undefined ? {} : { onIntegrityWarning: warning => onIntegrityWarning({ ...warning, uri: camURI }) }),
  })

  const cam = parseManifest(camBytes, camURI)
  const protocolURI = resolveCamResourceURI(camURI, cam.protocol.uri)
  const protocolBytes = await loadResourceBytes(
    loadResource,
    protocolURI,
    `failed to load CAM protocol resource: ${protocolURI}`,
  )
  verifyCamResourceIntegrity({ bytes: protocolBytes, integrity: cam.protocol.integrity, uri: protocolURI, ...(onIntegrityWarning === undefined ? {} : { onIntegrityWarning }) })

  return { camURI, cam }
}

export async function checkCamResourceIntegrity(options: Omit<LoadCamFromHostOptions, "onIntegrityWarning"> & {
  readonly resource: Pick<CamIntegrityWarning, "hashSource" | "uri">
}): Promise<CamIntegrityCheck> {
  const { camURI, camHash, camBytes } = await readManifestResource(options)
  let warning: CamIntegrityWarning | undefined
  if (options.resource.hashSource === "contract") {
    verifyCamHash({ bytes: camBytes, expectedHash: camHash, onIntegrityWarning: result => { warning = { ...result, uri: camURI } } })
    return warning ?? { hashSource: "contract", status: "verified", uri: camURI, expectedHash: camHash, actualHash: camHash.toLowerCase() }
  }

  // A secondary check compares fresh declarations; it does not authenticate their manifest.
  const cam = parseManifest(camBytes, camURI)
  const declarations = [cam.protocol, ...Object.values(cam.namespaces).flatMap(namespace =>
    namespace.type === "contract" ? [{ uri: namespace.abiURI, integrity: namespace.integrity }]
      : namespace.type === "ui" ? [{ uri: namespace.uri, integrity: namespace.integrity }] : [])]
  const declaration = declarations.find(resource => resolveCamResourceURI(camURI, resource.uri) === options.resource.uri)
  if (declaration === undefined) {
    throw new CamEvmError("CAM_DOCUMENT_INVALID", `Cannot refresh these hashes: the current app manifest no longer declares this resource: ${options.resource.uri}`)
  }
  const bytes = await loadResourceBytes(options.loadResource, options.resource.uri, `failed to load CAM resource: ${options.resource.uri}`)
  verifyCamResourceIntegrity({ bytes, integrity: declaration.integrity, uri: options.resource.uri, onIntegrityWarning: result => { warning = result } })
  const expectedHash = declaration.integrity.slice("sha256:".length)
  return warning ?? { hashSource: "manifest", status: "verified", uri: options.resource.uri, expectedHash, actualHash: expectedHash.toLowerCase() }
}

function parseManifest(bytes: Uint8Array, uri: string) {
  let camJson: unknown
  try {
    camJson = parseJsonBytes(bytes)
  } catch (cause) {
    throw new CamEvmError("CAM_DOCUMENT_INVALID", `CAM document is not valid JSON: ${uri}`, cause)
  }
  return parseCam(camJson)
}

async function assertCamHostInterface(
  publicClient: LoadCamFromHostOptions["publicClient"],
  hostAddress: LoadCamFromHostOptions["host"]["address"],
): Promise<void> {
  let supported: unknown
  try {
    supported = await publicClient.readContract({
      address: hostAddress,
      abi: camRootAbi,
      functionName: CAM_ROOT_FUNCTIONS.supportsInterface,
      args: [ICAM_APP_INTERFACE_ID],
    })
  } catch (cause) {
    throw new CamEvmError("CAM_HOST_READ_FAILED", `failed to check CAM host interface: ${hostAddress}`, cause)
  }

  if (supported !== true) {
    throw new CamEvmError("CAM_HOST_UNSUPPORTED", `CAM host does not support ICamApp: ${hostAddress}`)
  }
}

function requireStringRootValue(value: unknown, functionName: string): string {
  if (typeof value !== "string") {
    throw new CamEvmError("CAM_HOST_READ_FAILED", `CAM host ${functionName} returned a non-string value`)
  }

  return value
}

function requireBytes32RootValue(value: unknown, functionName: string): Hex {
  if (!isAbiBytesValue(value, 32)) {
    throw new CamEvmError("CAM_HOST_READ_FAILED", `CAM host ${functionName} returned a non-bytes32 value`)
  }

  // The shared predicate proves viem's Hex template shape; TypeScript cannot infer that.
  return value as Hex
}
