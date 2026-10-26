import { getAddress, zeroAddress, zeroHash, type Address, type Hex } from "viem"
import type { ReleaseApp } from "../release-approval/reference-read.ts"
import { camBindingRecipe } from "./bindings.ts"
import { parseContractIdentity, type ContractIdentity } from "../release-provenance.ts"
import {
  checkedReleaseChainId, parseJsonRecord, requireExactKeys, requiredBytes32,
  requiredJsonRecord, requiredNonemptyString, requiredNonzeroAddress,
  requiredSafeInteger, requiredSourceCommit,
} from "../release-values.ts"

export type CamManifest = { readonly uri: string; readonly hash: Hex }
export type CamRootBaseline = {
  readonly contract: ContractIdentity
  readonly creator: Address
  readonly sourceCommit: string
  readonly origin: { readonly kind: "publication" | "legacy-origin" | "attempt"; readonly artifactSha256: Hex }
  readonly bindings: Readonly<Record<string, Address>>
  readonly manifest: CamManifest
}

export type ExistingCamRoot = CamRootBaseline & {
  readonly kind: "existing"
  readonly owner: Address
  readonly pendingOwner: Address
}

export type CamReleasePlan = {
  readonly schema: "cam.publication-plan.v1"
  readonly app: ReleaseApp
  readonly sourceCommit: string
  readonly expectedChainId: number
  readonly businessArtifactSha256: Hex
  readonly uiArtifactSha256: Hex
  readonly bundleArtifactSha256: Hex
  readonly observationBlock: { readonly number: Hex; readonly hash: Hex }
  readonly bindings: readonly { readonly name: string; readonly address: Address | { readonly createdContract: "camRoot" } }[]
  readonly manifest: CamManifest
  readonly nomination: "preserve" | "nominate"
  readonly intendedOwner: Address
  readonly root: { readonly kind: "new" } | ExistingCamRoot
}

export function parseCamReleasePlan(bytes: Uint8Array): CamReleasePlan {
  const value = parseJsonRecord(bytes, "CAM publication plan")
  requireExactKeys(value, ["schema", "app", "sourceCommit", "expectedChainId", "businessArtifactSha256", "uiArtifactSha256", "bundleArtifactSha256", "observationBlock", "bindings", "manifest", "nomination", "intendedOwner", "root"], "CAM publication plan")
  if (value.schema !== "cam.publication-plan.v1") throw new Error("Unsupported CAM publication plan schema")
  const app = value.app
  if (app !== "bike-nft" && app !== "escrow" && app !== "pay-to-play") throw new Error("CAM publication must select bike-nft, escrow or pay-to-play")
  if (!Array.isArray(value.bindings)) throw new Error("CAM binding intent must be an array")
  const recipe = camBindingRecipe(app)
  if (value.bindings.length !== recipe.length) throw new Error("CAM binding intent differs from the app binding inventory")
  const bindings = value.bindings.map((raw, index) => {
    const binding = requiredJsonRecord(raw, "CAM binding intent")
    requireExactKeys(binding, ["name", "address"], "CAM binding intent")
    if (binding.name !== recipe[index]!.args[0]) throw new Error("CAM binding intent differs from the app binding inventory")
    const recipeTarget = recipe[index]!.args[1]
    if (typeof recipeTarget === "object" && recipeTarget.createdContract === "camRoot"
        && requiredJsonRecord(value.root, "CAM root selection").kind === "new") {
      const target = requiredJsonRecord(binding.address, "new CAM self binding")
      requireExactKeys(target, ["createdContract"], "new CAM self binding")
      if (target.createdContract !== "camRoot") throw new Error("New CAM ownership binding must name its own creation")
      return { name: binding.name as string, address: { createdContract: "camRoot" as const } }
    }
    return { name: binding.name as string, address: requiredNonzeroAddress(binding.address, `CAM ${binding.name} binding`) }
  })
  const observationBlock = requiredJsonRecord(value.observationBlock, "CAM admission block")
  requireExactKeys(observationBlock, ["number", "hash"], "CAM admission block")
  if (typeof observationBlock.number !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(observationBlock.number)) {
    throw new Error("CAM admission block number must be a hex quantity")
  }
  const root = requiredJsonRecord(value.root, "CAM root selection")
  let selection: CamReleasePlan["root"]
  if (root.kind === "new") {
    requireExactKeys(root, ["kind"], "new CAM root")
    selection = { kind: "new" }
  } else if (root.kind === "existing") {
    requireExactKeys(root, ["kind", "contract", "creator", "sourceCommit", "origin", "owner", "pendingOwner", "bindings", "manifest"], "existing CAM root")
    const bindings = requiredJsonRecord(root.bindings, "existing CAM bindings")
    requireExactKeys(bindings, recipe.map(step => step.args[0] as string), "existing CAM bindings")
    const origin = requiredJsonRecord(root.origin, "CAM root origin")
    requireExactKeys(origin, ["kind", "artifactSha256"], "CAM root origin")
    if (origin.kind !== "publication" && origin.kind !== "legacy-origin" && origin.kind !== "attempt") throw new Error("CAM root origin must select publication, attempt or legacy-origin")
    selection = { kind: "existing", contract: parseContractIdentity(root.contract, "existing CAM root identity"),
      creator: requiredNonzeroAddress(root.creator, "original CAM root creator"), sourceCommit: requiredSourceCommit(root.sourceCommit),
      origin: { kind: origin.kind, artifactSha256: requiredBytes32(origin.artifactSha256, "CAM root origin artifact SHA-256") },
      owner: requiredNonzeroAddress(root.owner, "current CAM owner"), pendingOwner: address(root.pendingOwner, "pending CAM owner"),
      bindings: Object.fromEntries(Object.entries(bindings).map(([name, target]) => [name, address(target, `CAM binding ${name}`)])),
      manifest: manifest(root.manifest, "existing CAM manifest"),
    }
  } else throw new Error("CAM root selection must explicitly choose new or existing")
  if (value.nomination !== "preserve" && value.nomination !== "nominate") throw new Error("CAM nomination must explicitly preserve or nominate")
  return { schema: "cam.publication-plan.v1", app, sourceCommit: requiredSourceCommit(value.sourceCommit),
    expectedChainId: checkedReleaseChainId(requiredSafeInteger(value.expectedChainId, "CAM chain ID")),
    businessArtifactSha256: requiredBytes32(value.businessArtifactSha256, "business artifact SHA-256"),
    uiArtifactSha256: requiredBytes32(value.uiArtifactSha256, "UI artifact SHA-256"),
    bundleArtifactSha256: requiredBytes32(value.bundleArtifactSha256, "bundle artifact SHA-256"),
    observationBlock: { number: observationBlock.number as Hex, hash: requiredBytes32(observationBlock.hash, "CAM admission block hash") }, bindings,
    manifest: manifest(value.manifest, "desired CAM manifest"),
    nomination: value.nomination, intendedOwner: address(value.intendedOwner, "intended CAM owner"), root: selection }
}

function manifest(value: unknown, label: string): CamManifest {
  const fields = requiredJsonRecord(value, label)
  requireExactKeys(fields, ["uri", "hash"], label)
  return { uri: requiredNonemptyString(fields.uri, `${label} URI`), hash: requiredBytes32(fields.hash, `${label} SHA-256`) }
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string") throw new Error(`${label} must be an EVM address`)
  return getAddress(value)
}

export function sameAddress(left: Address, right: Address): boolean { return left.toLowerCase() === right.toLowerCase() }
export function sameManifest(left: CamManifest, right: CamManifest): boolean {
  return left.uri === right.uri && left.hash.toLowerCase() === right.hash.toLowerCase()
}

/** Zero explicitly leaves remote manifest integrity unverified; the bundle record still commits local bytes. */
export function camManifestHash(requested: unknown, rootSha256: Hex): Hex {
  if (requested === "auto") return rootSha256
  const selected = requiredBytes32(requested, "requested CAM hash")
  if (selected.toLowerCase() !== zeroHash && selected.toLowerCase() !== rootSha256.toLowerCase()) {
    throw new Error(`Requested CAM hash ${selected} differs from prepared root SHA-256 ${rootSha256}`)
  }
  return selected
}

export function camNominationIntent(intendedOwner: Address, owner: Address): CamReleasePlan["nomination"] {
  return sameAddress(intendedOwner, zeroAddress) || sameAddress(intendedOwner, owner) ? "preserve" : "nominate"
}
export function camNominationOwner(plan: Pick<CamReleasePlan, "nomination" | "intendedOwner">): Address {
  return plan.nomination === "preserve" ? zeroAddress : plan.intendedOwner
}
