import { resolve } from "node:path"
import { createPublicClient, http, type Abi } from "viem"
import { requiredEnv } from "../input.ts"
import { businessFromDeployment } from "../contract-release/shared.ts"
import { parseUIDeploymentArtifact } from "../ui-release/shared.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { requiredReleaseChainId, requiredSourceCommit, runReleaseTool } from "../release-values.ts"
import type { CompiledContractSource } from "../release-compiled-contract.ts"
import type { ReleaseApp } from "../release-approval/reference-read.ts"
import { admitCamComponents } from "./components.ts"
import { readBusinessCompilations, readRootCompilation, readUICompilation } from "./compilations.ts"
import { camBindingRecipe } from "./bindings.ts"
import { stageCamBundle } from "./bundle.ts"

async function main(): Promise<void> {
  const env = process.env
  const app = requiredEnv(env, "CAM_RELEASE_APP")
  if (app !== "bike-nft" && app !== "escrow" && app !== "pay-to-play") throw new Error("CAM bundle must select bike-nft, escrow or pay-to-play")
  const artifactPath = requiredEnv(env, "CAM_RELEASE_BUNDLE_ARTIFACT_PATH")
  const rootSourceCommit = app === "bike-nft" ? requiredSourceCommit(requiredEnv(env, "CAM_RELEASE_ROOT_SOURCE_COMMIT")) : undefined
  const authoringSourceCommit = requiredSourceCommit(requiredEnv(env, "CAM_RELEASE_SOURCE_COMMIT"))
  const businessBytes = await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_BUSINESS_ARTIFACT_PATH"), "selected business artifact", 1024 * 1024)
  const uiBytes = await readBoundedRegularFile(requiredEnv(env, "CAM_RELEASE_UI_ARTIFACT_PATH"), "selected UI artifact", 1024 * 1024)
  const business = businessFromDeployment(app, businessBytes)
  const ui = parseUIDeploymentArtifact(uiBytes, app)
  const businessCompilations = await readBusinessCompilations(app, requiredEnv(env, "CAM_RELEASE_BUSINESS_ARTIFACTS_ROOT"), requiredEnv(env, "CAM_RELEASE_BUSINESS_SOURCES_ROOT"))
  const uiCompilation = await readUICompilation(app, requiredEnv(env, "CAM_RELEASE_UI_ARTIFACTS_ROOT"), requiredEnv(env, "CAM_RELEASE_UI_SOURCES_ROOT"))
  const rootCompilation = app === "bike-nft" ? await readRootCompilation(app,
    requiredEnv(env, "CAM_RELEASE_ROOT_ARTIFACTS_ROOT"), requiredEnv(env, "CAM_RELEASE_ROOT_SOURCES_ROOT")) : undefined
  const client = createPublicClient({ transport: http(requiredEnv(env, "CAM_RELEASE_RPC_URL")) })
  const expectedChainId = requiredReleaseChainId(requiredEnv(env, "CAM_RELEASE_EXPECTED_CHAIN_ID"))
  const admitted = await admitCamComponents({ app, businessBytes, uiBytes, businessCompilations, uiCompilation, client })
  if (admitted.chainId !== expectedChainId) throw new Error(`Cannot prepare CAM bundle: selected deployment chain ${admitted.chainId} differs from configured chain ${expectedChainId}`)
  const selected = selectBundleCompilations(app, businessCompilations, uiCompilation, rootCompilation)
  const contractABIs = new Map<string, Abi>([...selected].map(([name, original]) => [name, original.compilation.abi]))
  const dappsRootPath = requiredEnv(env, "CAM_RELEASE_AUTHORING_DAPPS_ROOT")
  const outputDir = requiredEnv(env, "CAM_RELEASE_BUNDLE_DIR")
  const staged = await stageCamBundle({ dappsRootPath, rootPath: resolve(dappsRootPath, app, "cam/main.json"), outputDir, contractABIs })
  const abiSources = Object.fromEntries([...selected].map(([name, original]) => {
    const sourceCommit = original.role === "ui" ? ui.sourceCommit : original.role === "camRoot"
      ? rootSourceCommit! : business.sourceCommit
    const { abi: _abi, creationBytecode: _program, compilerSettings: _settings, ...compilation } = original.compilation
    return [name, { role: original.role, sourceCommit, ...compilation }]
  }))
  const artifact = { schema: "cam.bundle.v1", app, authoringSourceCommit, chainId: admitted.chainId,
    authoredRootSha256: staged.authoredRootSha256, rootSha256: staged.rootSha256,
    businessArtifactSha256: admitted.business.artifactSha256, uiArtifactSha256: admitted.ui.artifactSha256, abiSources,
    preparationBlock: { number: `0x${admitted.observationBlock.number.toString(16)}`, hash: admitted.observationBlock.hash } }
  await writeNewJson(artifactPath, artifact, "prepared CAM bundle artifact")
  process.stdout.write(`${JSON.stringify({ event: "cam_bundle_prepared", app, rootSha256: staged.rootSha256,
    bundleDir: outputDir, artifactPath })}\n`)
}

function selectBundleCompilations(app: ReleaseApp, business: Readonly<Record<string, CompiledContractSource>>,
  ui: CompiledContractSource, root: CompiledContractSource | undefined) {
  const selected = new Map<string, { role: string; compilation: CompiledContractSource }>()
  for (const binding of camBindingRecipe(app)) {
    const name = binding.args[0] as string
    const role = (binding.args[1] as { readonly createdContract: string }).createdContract
    const compilation = role === "camRoot" ? root : role === "ui" ? ui : business[role]
    if (compilation === undefined) throw new Error(`Cannot prepare CAM bundle: no selected original compilation for ${name} (${role})`)
    // ICamRootOwnership is a logical alias of the actual root, so it uses that root's ABI.
    selected.set(name, { role, compilation })
  }
  return selected
}

runReleaseTool(main)
