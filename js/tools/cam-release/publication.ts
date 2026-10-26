import { getAddress, type Address, type Hex } from "viem"
import { parseContractIdentity, type ContractIdentity, type ContractIdentityReference } from "../release-provenance.ts"
import { sha256, type ReleaseApp } from "../release-approval/reference-read.ts"
import { checkedReleaseChainId, parseJsonRecord, requireExactKeys, requiredBytes32, requiredJsonRecord,
  requiredNonemptyString, requiredNonzeroAddress, requiredNonzeroBytes32, requiredSafeInteger,
  requiredSourceCommit, requiredTransactionHash } from "../release-values.ts"
import { camBindingRecipe } from "./bindings.ts"
import type { CamManifest } from "./shared.ts"

export type CamPublicationArtifact = {
  readonly schema: "cam.publication.v1"
  readonly app: ReleaseApp
  readonly sourceCommit: string
  readonly chainId: number
  readonly signer: Address
  readonly planSha256: Hex
  readonly referenceSha256: Hex
  readonly businessArtifactSha256: Hex
  readonly uiArtifactSha256: Hex
  readonly bundleArtifactSha256: Hex
  readonly root: { readonly sourceCommit: string; readonly creator: Address; readonly contract: ContractIdentity }
  readonly bindings: Readonly<Record<string, Address>>
  readonly manifest: CamManifest
  readonly authority: { readonly owner: Address; readonly pendingOwner: Address }
  readonly transactions: readonly Hex[]
  readonly verificationBlock: { readonly number: Hex; readonly hash: Hex }
  readonly predecessor: { readonly kind: "publication" | "legacy-origin"; readonly artifactSha256: Hex } | null
}

export function parseCamPublication(bytes: Uint8Array, app: ReleaseApp): CamPublicationArtifact {
  const value = parseJsonRecord(bytes, "CAM publication artifact")
  requireExactKeys(value, ["schema", "app", "sourceCommit", "chainId", "signer", "planSha256", "referenceSha256", "businessArtifactSha256", "uiArtifactSha256", "bundleArtifactSha256", "root", "bindings", "manifest", "authority", "transactions", "verificationBlock", "predecessor"], "CAM publication artifact")
  if (value.schema !== "cam.publication.v1" || value.app !== app) throw new Error(`Cannot read ${app} CAM publication: schema or app differs`)
  const root = requiredJsonRecord(value.root, "published root provenance")
  requireExactKeys(root, ["sourceCommit", "creator", "contract"], "published root provenance")
  const bindings = requiredJsonRecord(value.bindings, "published CAM bindings")
  requireExactKeys(bindings, camBindingRecipe(app).map(step => step.args[0] as string), "published CAM bindings")
  const manifest = requiredJsonRecord(value.manifest, "published CAM manifest")
  requireExactKeys(manifest, ["uri", "hash"], "published CAM manifest")
  const authority = requiredJsonRecord(value.authority, "observed CAM authority")
  requireExactKeys(authority, ["owner", "pendingOwner"], "observed CAM authority")
  const block = requiredJsonRecord(value.verificationBlock, "CAM publication block")
  requireExactKeys(block, ["number", "hash"], "CAM publication block")
  if (typeof block.number !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(block.number)) throw new Error("CAM publication block number must be a hex quantity")
  if (!Array.isArray(value.transactions)) throw new Error("CAM publication transactions must be an array")
  let predecessor: CamPublicationArtifact["predecessor"] = null
  if (value.predecessor !== null) {
    const previous = requiredJsonRecord(value.predecessor, "preceding CAM evidence")
    requireExactKeys(previous, ["kind", "artifactSha256"], "preceding CAM evidence")
    if (previous.kind !== "publication" && previous.kind !== "legacy-origin") throw new Error("Preceding CAM evidence must be publication or legacy-origin")
    predecessor = { kind: previous.kind, artifactSha256: requiredBytes32(previous.artifactSha256, "preceding CAM artifact SHA-256") }
  }
  return { schema: "cam.publication.v1", app, sourceCommit: requiredSourceCommit(value.sourceCommit),
    chainId: checkedReleaseChainId(requiredSafeInteger(value.chainId, "CAM publication chain ID")),
    signer: requiredNonzeroAddress(value.signer, "CAM publication signer"),
    planSha256: requiredBytes32(value.planSha256, "CAM plan SHA-256"), referenceSha256: requiredBytes32(value.referenceSha256, "CAM reference SHA-256"),
    businessArtifactSha256: requiredBytes32(value.businessArtifactSha256, "business artifact SHA-256"),
    uiArtifactSha256: requiredBytes32(value.uiArtifactSha256, "UI artifact SHA-256"), bundleArtifactSha256: requiredBytes32(value.bundleArtifactSha256, "bundle artifact SHA-256"),
    root: { sourceCommit: requiredSourceCommit(root.sourceCommit), creator: requiredNonzeroAddress(root.creator, "original CAM creator"),
      contract: parseContractIdentity(root.contract, "published CAM identity") },
    bindings: Object.fromEntries(Object.entries(bindings).map(([name, target]) => [name, requiredNonzeroAddress(target, `published ${name} binding`)])),
    manifest: { uri: requiredNonemptyString(manifest.uri, "published CAM URI"), hash: requiredBytes32(manifest.hash, "published CAM hash") },
    authority: { owner: address(authority.owner, "observed CAM owner"), pendingOwner: address(authority.pendingOwner, "observed pending CAM owner") },
    transactions: value.transactions.map(hash => requiredTransactionHash(hash, "CAM publication transaction")),
    verificationBlock: { number: block.number as Hex, hash: requiredNonzeroBytes32(block.hash, "CAM publication block hash") }, predecessor }
}

export type CamRootSelection = {
  readonly app: ReleaseApp; readonly chainId: number; readonly artifactSha256: Hex; readonly sourceCommit: string
  readonly creator: Address; readonly contract: ContractIdentityReference
} & ({ readonly kind: "publication"; readonly bindings: Readonly<Record<string, Address>>; readonly manifest: CamManifest }
  | { readonly kind: "legacy-origin" })

/** Legacy full artifacts attest creation, never the current bindings or manifest. */
export function rootFromArtifact(app: ReleaseApp, bytes: Uint8Array): CamRootSelection {
  const value = parseJsonRecord(bytes, "selected CAM root evidence")
  if (value.schema === "cam.publication.v1") {
    const publication = parseCamPublication(bytes, app)
    return { kind: "publication", app, chainId: publication.chainId, artifactSha256: sha256(bytes),
      sourceCommit: publication.root.sourceCommit, creator: publication.root.creator, contract: publication.root.contract,
      bindings: publication.bindings, manifest: publication.manifest }
  }
  if (value.schema !== `${app}.deployment.v1` && value.schema !== `${app}.deployment.v2`) throw new Error("Selected root evidence is not a known CAM publication or full deployment format")
  return { kind: "legacy-origin", app, chainId: checkedReleaseChainId(requiredSafeInteger(value.chainId, "root origin chain ID")),
    artifactSha256: sha256(bytes), sourceCommit: requiredSourceCommit(value.sourceCommit), creator: requiredNonzeroAddress(value.deployer, "original root creator"),
    contract: { address: requiredNonzeroAddress(value.camRoot, "original CAM root address"),
      codeHash: requiredNonzeroBytes32(value.camRootCodeHash, "original CAM runtime hash"),
      creationTransaction: requiredTransactionHash(value.camRootCreationTransaction, "original CAM creation transaction") } }
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string") throw new Error(`${label} must be an EVM address`)
  return getAddress(value)
}
