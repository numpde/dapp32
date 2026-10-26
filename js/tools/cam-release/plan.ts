import { createPublicClient, getAddress, http } from "viem"
import { requiredEnv } from "../input.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { assertReleaseCamURI } from "../release-cam-bundle.ts"
import { requiredReleaseChainId, requiredSourceCommit, runReleaseTool } from "../release-values.ts"
import { readCompiledContractSource } from "../release-compiled-contract.ts"
import { ARTIFACTS } from "../release-approval/reference-read.ts"
import { readOriginalRootCompilation } from "./compilations.ts"
import { admitCamComponents } from "./components.ts"
import { readPreparedCamBundle } from "./prepared.ts"
import { rootFromArtifact } from "./publication.ts"
import { admitExistingCamRoot, assertCamAttemptIntent } from "./root.ts"
import { camBindingRecipe } from "./bindings.ts"
import { camManifestHash, camNominationIntent, parseCamReleasePlan, type ExistingCamRoot } from "./shared.ts"
import { prepareCamReferenceSnapshot } from "./reference-snapshot.ts"
import { serializeCamABI } from "./bundle.ts"

async function main(): Promise<void> {
  const env = process.env
  const app = requiredEnv(env, "CAM_RELEASE_APP")
  if (app !== "bike-nft" && app !== "escrow" && app !== "pay-to-play") throw new Error("CAM publication must select bike-nft, escrow or pay-to-play")
  const sourceCommit = requiredSourceCommit(requiredEnv(env, "CAM_RELEASE_SOURCE_COMMIT"))
  const expectedChainId = requiredReleaseChainId(requiredEnv(env, "CAM_RELEASE_EXPECTED_CHAIN_ID"))
  const uri = requiredEnv(env, "CAM_RELEASE_URI")
  assertReleaseCamURI(uri, "composed CAM URI", env)
  const prepared = await readPreparedCamBundle(requiredEnv(env, "CAM_RELEASE_PREPARED_DIR"), app, uri)
  const manifestHash = camManifestHash(requiredEnv(env, "CAM_RELEASE_HASH"), prepared.rootSha256)
  const client = createPublicClient({ transport: http(requiredEnv(env, "CAM_RELEASE_RPC_URL")) })
  const components = await admitCamComponents({ app, businessBytes: prepared.businessBytes, uiBytes: prepared.uiBytes,
    businessCompilations: prepared.businessCompilations, uiCompilation: prepared.uiCompilation, client })
  if (components.chainId !== expectedChainId) throw new Error(`Cannot prepare CAM publication: component chain ${components.chainId} differs from configured chain ${expectedChainId}`)
  const intendedOwner = getAddress(requiredEnv(env, "CAM_RELEASE_INTENDED_OWNER"))
  let nomination: "preserve" | "nominate"
  let root: { kind: "new" } | ExistingCamRoot
  let admittedRoot: ExistingCamRoot | undefined
  let originalCompilation: Awaited<ReturnType<typeof readOriginalRootCompilation>> | undefined
  const mode = requiredEnv(env, "CAM_RELEASE_ROOT")
  if (mode === "new") {
    root = { kind: "new" }
    nomination = camNominationIntent(intendedOwner, getAddress(requiredEnv(env, "CAM_RELEASE_SIGNER_ADDRESS")))
  }
  else if (mode === "existing") {
    const origin = rootFromArtifact(app, await readBoundedRegularFile("/root-proof/root.json", "retained original root evidence", 1024 * 1024))
    if (origin.chainId !== components.chainId) throw new Error(`Cannot prepare CAM publication: root evidence chain ${origin.chainId} differs from component chain ${components.chainId}`)
    originalCompilation = await readOriginalRootCompilation(app, origin.sourceCommit)
    admittedRoot = await admitExistingCamRoot({ selection: origin, compilation: originalCompilation,
      observationBlock: components.observationBlock, client })
    nomination = origin.kind === "attempt" ? origin.attempt.plan.nomination : camNominationIntent(intendedOwner, admittedRoot.owner)
    assertCamAttemptIntent(origin, { businessArtifactSha256: components.business.artifactSha256,
      uiArtifactSha256: components.ui.artifactSha256, rootSha256: prepared.rootSha256,
      manifest: { uri, hash: manifestHash }, intendedOwner, nomination })
    root = admittedRoot
  } else throw new Error("CAM publication must explicitly select a new or existing root")
  const currentRoot = mode === "new" ? await readCompiledContractSource(ARTIFACTS[app].camRoot!,
    requiredEnv(env, "RELEASE_APPROVAL_ARTIFACTS_ROOT"), requiredEnv(env, "RELEASE_APPROVAL_SOURCES_ROOT")) : originalCompilation!
  if (app === "bike-nft" && !Buffer.from(serializeCamABI(currentRoot.abi)).equals(serializeCamABI(prepared.rootCompilation!.abi))) {
    throw new Error("Cannot prepare CAM publication: staged ownership ABI differs from the selected root's actual source ABI")
  }
  const bindings = camBindingRecipe(app).map(step => {
    const role = (step.args[1] as { readonly createdContract: string }).createdContract
    const address = role === "camRoot" ? root.kind === "new" ? { createdContract: "camRoot" as const } : root.contract.address
      : role === "ui" ? components.ui.contract.address : components.business.contracts[role]!.address
    return { name: step.args[0], address }
  })
  const plan = parseCamReleasePlan(new TextEncoder().encode(JSON.stringify({ schema: "cam.publication-plan.v1", app,
    sourceCommit, expectedChainId, businessArtifactSha256: components.business.artifactSha256,
    uiArtifactSha256: components.ui.artifactSha256, bundleArtifactSha256: prepared.artifactSha256,
    observationBlock: { number: `0x${components.observationBlock.number.toString(16)}`, hash: components.observationBlock.hash },
    bindings, manifest: { uri, hash: manifestHash }, intendedOwner, nomination, root })))
  const planBytes = new TextEncoder().encode(`${JSON.stringify(plan, null, 2)}\n`)
  const snapshot = await prepareCamReferenceSnapshot({ planBytes, components, signer: requiredEnv(env, "CAM_RELEASE_SIGNER_ADDRESS"),
    ...(admittedRoot === undefined ? {} : { admittedRoot, originalRootCompilation: currentRoot }),
    artifactsRoot: requiredEnv(env, "RELEASE_APPROVAL_ARTIFACTS_ROOT"), sourcesRoot: requiredEnv(env, "RELEASE_APPROVAL_SOURCES_ROOT") })
  if ((await client.getBlock({ blockNumber: components.observationBlock.number })).hash !== components.observationBlock.hash) {
    throw new Error("Cannot prepare CAM publication: its admission block changed before retaining approval intent")
  }
  await writeNewJson(requiredEnv(env, "CAM_RELEASE_PLAN_PATH"), plan, "CAM publication plan")
  const outputPath = requiredEnv(env, "RELEASE_APPROVAL_REFERENCE_PATH")
  await writeNewJson(outputPath, snapshot, "CAM approval reference")
  process.stdout.write(`${JSON.stringify({ event: "release_approval_reference_prepared", app, sourceCommit,
    expectedChainId, expectedDeployer: snapshot.expectedDeployer, snapshotSha256: snapshot.snapshotSha256,
    root: plan.root, observationBlock: plan.observationBlock, remainingTransactions: snapshot.steps.length, outputPath })}\n`)
}

runReleaseTool(main)
