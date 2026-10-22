import { parseCam } from "@cam/core"
import { assertLoadableCamRootURI, isAbiBytesValue, parseJsonBytes, resolveCamResourceURI } from "@cam/protocol"
import type { Hex } from "viem"

import { CAM_ROOT_FUNCTIONS, ICAM_APP_INTERFACE_ID, camRootAbi } from "./abi.ts"
import { assertClientChain } from "./chain.ts"
import { CamEvmError } from "./errors.ts"
import { verifyCamHash, verifyCamResourceIntegrity } from "./hash.ts"
import { loadResourceBytes } from "./resources.ts"
import type { LoadedCam, LoadCamFromHostOptions } from "./types.ts"

export async function loadCamFromHost({
  publicClient,
  host,
  loadResource,
  onIntegrityWarning,
}: LoadCamFromHostOptions): Promise<LoadedCam> {
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

  verifyCamHash({
    bytes: camBytes,
    expectedHash: camHash,
    ...(onIntegrityWarning === undefined ? {} : { onIntegrityWarning: warning => onIntegrityWarning({ ...warning, uri: camURI }) }),
  })

  let camJson: unknown
  try {
    camJson = parseJsonBytes(camBytes)
  } catch (cause) {
    throw new CamEvmError("CAM_DOCUMENT_INVALID", `CAM document is not valid JSON: ${camURI}`, cause)
  }
  const cam = parseCam(camJson)
  const protocolURI = resolveCamResourceURI(camURI, cam.protocol.uri)
  const protocolBytes = await loadResourceBytes(
    loadResource,
    protocolURI,
    `failed to load CAM protocol resource: ${protocolURI}`,
  )
  verifyCamResourceIntegrity({ bytes: protocolBytes, integrity: cam.protocol.integrity, uri: protocolURI, ...(onIntegrityWarning === undefined ? {} : { onIntegrityWarning }) })

  return {
    camURI,
    cam,
  }
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
