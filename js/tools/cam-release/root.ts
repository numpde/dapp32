import { getAddress, type Abi, type Address, type Hex } from "viem"
import { observeContractIdentity, type ContractIdentityReader } from "../release-provenance.ts"
import { requiredBytes32, requiredJsonRecord, requiredNonemptyString, requiredNonzeroAddress } from "../release-values.ts"
import { camBindingRecipe } from "./bindings.ts"
import type { CamRootSelection } from "./publication.ts"
import type { OriginalContractCompilation } from "./components.ts"
import { sameAddress, sameManifest, type ExistingCamRoot } from "./shared.ts"

type RootReader = ContractIdentityReader & {
  readContract(request: { readonly address: Address; readonly abi: Abi; readonly functionName: string;
    readonly args?: readonly unknown[]; readonly blockNumber: bigint }): Promise<unknown>
}

/** Admit an original root independently of component creators; require a supplied publication baseline to match live state. */
export async function admitExistingCamRoot({ selection, compilation, observationBlock, client }: {
  readonly selection: CamRootSelection
  readonly compilation: OriginalContractCompilation
  readonly observationBlock: { readonly number: bigint; readonly hash: Hex }
  readonly client: RootReader
}): Promise<ExistingCamRoot> {
  const address = selection.contract.address
  const blockNumber = observationBlock.number
  const before = await client.getBlock({ blockNumber })
  if (before.hash !== observationBlock.hash) throw new Error(`Cannot admit CAM root ${address}: component observation block changed before root admission`)
  const observed = await observeContractIdentity(client, selection.contract, selection.creator, blockNumber, "CAM root")
  if (!observed.creationInput.toLowerCase().startsWith(compilation.creationBytecode.toLowerCase())) {
    throw new Error(`Cannot admit CAM root ${address}: original creation does not match its selected source compilation`)
  }
  const read = (functionName: string, args?: readonly unknown[]) => client.readContract({
    address, abi: compilation.abi, functionName, ...(args === undefined ? {} : { args }), blockNumber,
  })
  const names = camBindingRecipe(selection.app).map(step => step.args[0] as string)
  const [owner, pendingOwner, rawManifest, ...targets] = await Promise.all([
    read("owner"), read("pendingOwner"), read("camManifest"), ...names.map(name => read("contractAddress", [name])),
  ])
  const manifestFields = requiredJsonRecord(rawManifest, "observed CAM manifest")
  const manifest = { uri: requiredNonemptyString(manifestFields.uri, "observed CAM manifest URI"),
    hash: requiredBytes32(manifestFields.sha256Digest, "observed CAM manifest SHA-256") }
  if (selection.kind === "publication" && !sameManifest(manifest, selection.manifest)) {
    throw new Error(`Cannot admit CAM root ${address}: current manifest ${JSON.stringify(manifest.uri)} ${manifest.hash} differs from latest publication ${JSON.stringify(selection.manifest.uri)} ${selection.manifest.hash}`)
  }
  const bindings: Record<string, Address> = {}
  for (const [index, name] of names.entries()) {
    const target = getAddress(targets[index] as string)
    bindings[name] = target
    if (selection.kind === "publication" && !sameAddress(target, selection.bindings[name]!)) {
      throw new Error(`Cannot admit CAM root ${address}: current binding ${name}=${target} differs from latest publication ${selection.bindings[name]}`)
    }
  }
  const after = await client.getBlock({ blockNumber })
  if (after.hash !== observationBlock.hash) throw new Error(`Cannot admit CAM root ${address}: observation block changed during root admission`)
  return { kind: "existing", contract: observed.identity, sourceCommit: selection.sourceCommit, creator: selection.creator,
    origin: { kind: selection.kind, artifactSha256: selection.artifactSha256 }, bindings, manifest,
    owner: requiredNonzeroAddress(owner, "current CAM owner"), pendingOwner: getAddress(pendingOwner as string) }
}
