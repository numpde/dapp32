import { zeroAddress, type Abi } from "viem"
import { assertAbiMatchesSteps } from "../release-approval/reference-read.ts"
import type { AdmittedCamComponents } from "./components.ts"
import { camBindingRecipe } from "./bindings.ts"
import { camNominationOwner, sameAddress, sameManifest, type CamReleasePlan } from "./shared.ts"
import { createdContract, expectedDeployer, type ReleaseReference, type ExpectedStep } from "../release-approval/reference.ts"

export type CamPublicationReference = ReleaseReference & { readonly root: CamReleasePlan["root"] }

export function camPublicationReference(plan: CamReleasePlan, independentSigner: string, components: AdmittedCamComponents, originalRootABI?: Abi): CamPublicationReference {
  if (components.app !== plan.app || components.chainId !== plan.expectedChainId
      || components.business.artifactSha256.toLowerCase() !== plan.businessArtifactSha256.toLowerCase()
      || components.ui.artifactSha256.toLowerCase() !== plan.uiArtifactSha256.toLowerCase()) {
    throw new Error("Cannot publish CAM: selected component admission differs from the plan's app, chain, artifact hashes")
  }
  const signer = expectedDeployer(independentSigner)
  const root = plan.root
  if (root.kind === "existing" && !sameAddress(root.owner, signer)) {
    throw new Error(`Cannot publish CAM: selected signer ${signer} differs from current root owner ${root.owner}`)
  }
  const steps: ExpectedStep[] = []
  if (root.kind === "new") {
    steps.push({ kind: "create", role: "camRoot", name: "CamRoot", action: "Deploy CAM root with the composed manifest",
      argumentLabels: ["Initial CAM owner", "CAM manifest URI", "CAM manifest SHA-256"],
      constructorTypes: ["address", "string", "bytes32"], args: [signer, plan.manifest.uri, plan.manifest.hash] })
  }
  for (const [index, recipe] of camBindingRecipe(plan.app).entries()) {
    const binding = plan.bindings[index]!
    const selfBinding = typeof recipe.args[1] === "object" && recipe.args[1].createdContract === "camRoot"
    const role = recipe.args[1]
    if (typeof role !== "object") throw new Error(`CAM app recipe lacks a role reference for ${binding.name}`)
    const target = selfBinding ? root.kind === "new" ? createdContract("camRoot") : root.contract.address
      : role.createdContract === "ui" ? components.ui.contract.address : components.business.contracts[role.createdContract]!.address
    const matches = typeof target === "string" ? typeof binding.address === "string" && sameAddress(target, binding.address)
      : typeof binding.address === "object" && binding.address.createdContract === target.createdContract
    if (!matches) {
      throw new Error(`Cannot publish CAM: binding ${binding.name} differs from its admitted component target ${typeof target === "string" ? target : "new CAM root"}`)
    }
    if (root.kind === "existing" && typeof binding.address === "string" && sameAddress(root.bindings[binding.name]!, binding.address)) continue
    steps.push({ ...recipe, args: [binding.name, selfBinding && root.kind === "new" ? createdContract("camRoot") : binding.address] })
  }
  if (root.kind === "existing" && !sameManifest(root.manifest, plan.manifest)) {
    steps.push({ kind: "call", role: "camRoot", name: "setCam", action: "Publish the composed CAM manifest URI and exact-byte hash",
      argumentLabels: ["CAM manifest URI", "CAM manifest SHA-256"], signature: "setCam(string,bytes32)",
      args: [plan.manifest.uri, plan.manifest.hash] })
  }
  const pendingOwner = root.kind === "new" ? zeroAddress : root.pendingOwner
  const intendedOwner = camNominationOwner(plan)
  if (!sameAddress(intendedOwner, zeroAddress) && !sameAddress(intendedOwner, signer)
      && !sameAddress(intendedOwner, pendingOwner)) {
    steps.push({ kind: "call", role: "camRoot", name: "transferOwnership", action: "Nominate the selected CAM owner; separate acceptance is required",
      argumentLabels: ["Selected CAM owner"], signature: "transferOwnership(address)", args: [intendedOwner] })
  }
  if (root.kind === "existing") {
    if (originalRootABI === undefined) throw new Error("Cannot publish CAM: original root ABI is required for existing-root call admission")
    assertAbiMatchesSteps("camRoot", originalRootABI, steps)
  }
  return { sourceCommit: plan.sourceCommit, expectedChainId: plan.expectedChainId, expectedDeployer: signer, steps, root }
}
