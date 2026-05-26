import { resolveResourceURI } from "@cam/core"
import type { CamDocument } from "@cam/core"

import { CAM_ROOT_FUNCTIONS, camRootAbi, parseAbiBytes } from "./abi.ts"
import { ZERO_ADDRESS } from "./constants.ts"
import { CamEvmError } from "./errors.ts"
import { loadResourceBytes } from "./resources.ts"
import type { CamHost, CamPublicClient, ResolvedCamContract, ResourceLoader } from "./types.ts"

export async function resolveCamContracts({
  publicClient,
  host,
  camURI,
  cam,
  loadResource,
}: ResolveCamContractsOptions): Promise<Record<string, ResolvedCamContract>> {
  const entries = await Promise.all(
    Object.entries(cam.contracts).map(async ([name, contract]) => {
      let address: ResolvedCamContract["address"]
      try {
        address = await publicClient.readContract({
          address: host.address,
          abi: camRootAbi,
          functionName: CAM_ROOT_FUNCTIONS.contractAddress,
          args: [name],
        })
      } catch (cause) {
        throw new CamEvmError("CAM_HOST_READ_FAILED", `failed to resolve CAM contract address: ${name}`, cause)
      }

      if (address.toLowerCase() === ZERO_ADDRESS) {
        throw new CamEvmError("CAM_CONTRACT_UNBOUND", `CAM contract is unbound: ${name}`)
      }

      const abiURI = resolveResourceURI(camURI, contract.abiURI)
      const abiBytes = await loadResourceBytes(
        loadResource,
        abiURI,
        `failed to load CAM ABI resource: ${abiURI}`,
      )

      return [
        name,
        {
          address,
          abi: parseAbiBytes(abiBytes, abiURI),
        },
      ] as const
    }),
  )

  return Object.fromEntries(entries)
}

type ResolveCamContractsOptions = {
  readonly publicClient: CamPublicClient
  readonly host: CamHost
  readonly camURI: string
  readonly cam: CamDocument
  readonly loadResource: ResourceLoader
}
