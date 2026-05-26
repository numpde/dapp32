import { parseCam } from "@cam/core"
import type { Hex, PublicClient } from "viem"

import { CAM_ROOT_FUNCTIONS, camRootAbi } from "./abi.ts"
import { CamEvmError } from "./errors.ts"
import { verifyCamHash } from "./hash.ts"
import { parseJsonBytes } from "./json.ts"
import { loadResourceBytes } from "./resources.ts"
import type { CamHost, LoadedCam, ResourceLoader } from "./types.ts"

export async function loadCamFromHost({
  publicClient,
  host,
  loadResource,
}: LoadCamFromHostOptions): Promise<LoadedCam> {
  let camURI: string
  let camHash: Hex
  try {
    [camURI, camHash] = await Promise.all([
      publicClient.readContract({
        address: host.address,
        abi: camRootAbi,
        functionName: CAM_ROOT_FUNCTIONS.camURI,
      }),
      publicClient.readContract({
        address: host.address,
        abi: camRootAbi,
        functionName: CAM_ROOT_FUNCTIONS.camHash,
      }),
    ])
  } catch (cause) {
    throw new CamEvmError("CAM_HOST_READ_FAILED", `failed to read CAM host: ${host.address}`, cause)
  }

  const camBytes = await loadResourceBytes(
    loadResource,
    camURI,
    `failed to load CAM resource: ${camURI}`,
  )

  verifyCamHash({
    bytes: camBytes,
    expectedHash: camHash,
    allowUnsigned: true,
  })

  const camJson = parseJsonBytes(camBytes, "CAM_DOCUMENT_INVALID", `CAM document is not valid JSON: ${camURI}`)
  const cam = parseCam(camJson)

  return {
    camURI,
    cam,
  }
}

type LoadCamFromHostOptions = {
  readonly publicClient: PublicClient
  readonly host: CamHost
  readonly loadResource: ResourceLoader
}
