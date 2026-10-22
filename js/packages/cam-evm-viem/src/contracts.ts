import {
  CAM_CONTRACT_NAMESPACE_PREFIX,
  createStringMap,
  isCamNamespaceNameForType,
  resolveCamResourceURI,
} from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import { isAddress, zeroAddress } from "viem"

import { CAM_ROOT_FUNCTIONS, camRootAbi, parseAbiBytes } from "./abi.ts"
import { assertClientChain } from "./chain.ts"
import { CamEvmError } from "./errors.ts"
import { verifyCamResourceIntegrity } from "./hash.ts"
import { loadResourceBytes } from "./resources.ts"
import type { CamHost, CamIntegrityWarning, CamPublicClient, ResolvedCamContract, ResourceLoader } from "./types.ts"

export async function resolveCamContracts({
  publicClient,
  host,
  camURI,
  cam,
  loadResource,
  onIntegrityWarning,
}: ResolveCamContractsOptions): Promise<Record<string, ResolvedCamContract>> {
  await assertClientChain(publicClient, host)

  const entries = await Promise.all(
    contractNamespaces(cam).map(async ([namespace, contractName, contract]) => [
      namespace,
      await resolveContract({
        publicClient,
        host,
        camURI,
        name: contractName,
        abiURI: contract.abiURI,
        integrity: contract.integrity,
        loadResource,
        ...(onIntegrityWarning === undefined ? {} : { onIntegrityWarning }),
      }),
    ] as const),
  )

  const contracts = createStringMap<ResolvedCamContract>()
  for (const [name, contract] of entries) {
    contracts[name] = contract
  }
  return contracts
}

function contractNamespaces(cam: CamDocument) {
  return Object.entries(cam.namespaces).flatMap(([namespace, declaration]) => {
    if (declaration.type !== "contract") {
      return []
    }

    if (!isCamNamespaceNameForType(namespace, "contract")) {
      throw new CamEvmError("CAM_CONTRACT_INVALID", `CAM contract namespace is invalid: ${namespace}`)
    }

    // Runtime maps resolved contracts by full namespace, but CamRoot stores the
    // bare onchain name because Solidity does not know the CAM namespace tree.
    return [[namespace, namespace.slice(CAM_CONTRACT_NAMESPACE_PREFIX.length), declaration] as const]
  })
}

async function resolveContract({
  publicClient,
  host,
  camURI,
  name,
  abiURI: relativeAbiURI,
  integrity,
  loadResource,
  onIntegrityWarning,
}: {
  readonly publicClient: CamPublicClient
  readonly host: CamHost
  readonly camURI: string
  readonly name: string
  readonly abiURI: string
  readonly integrity: string
  readonly loadResource: ResourceLoader
  readonly onIntegrityWarning?: (warning: CamIntegrityWarning) => void
}): Promise<ResolvedCamContract> {
  let address: unknown
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

  if (typeof address !== "string") {
    throw new CamEvmError("CAM_CONTRACT_INVALID", `CAM contract address is not a string for ${name}`)
  }
  if (address.toLowerCase() === zeroAddress) {
    throw new CamEvmError("CAM_CONTRACT_UNBOUND", `CAM contract is unbound: ${name}`)
  }
  if (!isAddress(address)) {
    throw new CamEvmError("CAM_CONTRACT_INVALID", `CAM contract address is invalid for ${name}: ${address}`)
  }

  const abiURI = resolveCamResourceURI(camURI, relativeAbiURI)
  const abiBytes = await loadResourceBytes(
    loadResource,
    abiURI,
    `failed to load CAM ABI resource: ${abiURI}`,
  )
  verifyCamResourceIntegrity({
    bytes: abiBytes,
    integrity,
    uri: abiURI,
    ...(onIntegrityWarning === undefined ? {} : { onIntegrityWarning }),
  })

  return {
    address,
    abi: parseAbiBytes(abiBytes, abiURI),
  }
}

type ResolveCamContractsOptions = {
  readonly publicClient: CamPublicClient
  readonly host: CamHost
  readonly camURI: string
  readonly cam: CamDocument
  readonly loadResource: ResourceLoader
  readonly onIntegrityWarning?: (warning: CamIntegrityWarning) => void
}
