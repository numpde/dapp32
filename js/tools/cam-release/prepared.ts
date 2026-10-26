import { resolve } from "node:path"
import { isDeepStrictEqual } from "node:util"
import { sha256 } from "viem"
import { validateCamBundle } from "../../packages/cam-conformance/dist/index.js"
import { isRecordObject, parseJsonBytes } from "../../packages/cam-protocol/dist/index.js"
import { businessFromDeployment } from "../contract-release/shared.ts"
import { parseUIDeploymentArtifact } from "../ui-release/shared.ts"
import { declaredLocalResources } from "../release-cam-bundle.ts"
import { readBoundedRegularFile } from "../release-files.ts"
import type { ReleaseApp } from "../release-approval/reference-read.ts"
import { parseJsonRecord, requiredBytes32, requiredSourceCommit } from "../release-values.ts"
import { bundleCompilationSources, readBusinessCompilations, readRootCompilation, readUICompilation, selectBundleCompilations } from "./compilations.ts"
import { serializeCamABI } from "./bundle.ts"
import { rootFromArtifact } from "./publication.ts"

/** Load the operation's retained original compiler outputs and exact staged resource bytes. */
export async function readPreparedCamBundle(directory: string, app: ReleaseApp, rootURI: string) {
  const artifactBytes = await readBoundedRegularFile(resolve(directory, "artifact/cam-bundle.json"), "prepared bundle artifact", 1024 * 1024)
  const artifact = parseJsonRecord(artifactBytes, "prepared bundle artifact")
  if (artifact.schema !== "cam.bundle.v1" || artifact.app !== app) throw new Error("Prepared CAM bundle schema or app differs")
  const authoringSourceCommit = requiredSourceCommit(artifact.authoringSourceCommit)
  const businessBytes = await readBoundedRegularFile(resolve(directory, "inputs/business.json"), "prepared business input", 1024 * 1024)
  const uiBytes = await readBoundedRegularFile(resolve(directory, "inputs/ui.json"), "prepared UI input", 1024 * 1024)
  if (sha256(businessBytes).toLowerCase() !== requiredBytes32(artifact.businessArtifactSha256, "prepared business SHA-256").toLowerCase()
      || sha256(uiBytes).toLowerCase() !== requiredBytes32(artifact.uiArtifactSha256, "prepared UI SHA-256").toLowerCase()) throw new Error("Prepared CAM bundle component inputs differ from their committed hashes")
  const business = businessFromDeployment(app, businessBytes)
  const ui = parseUIDeploymentArtifact(uiBytes, app)
  const businessCompilations = await readBusinessCompilations(app, resolve(directory, "compiler/business"), resolve(directory, "sources/business/dapps"))
  const uiCompilation = await readUICompilation(app, resolve(directory, "compiler/ui"), resolve(directory, "sources/ui/dapps"))
  let rootSourceCommit = authoringSourceCommit
  let originalRoot
  try {
    const rootBytes = await readBoundedRegularFile(resolve(directory, "inputs/root.json"), "prepared root origin", 1024 * 1024)
    originalRoot = rootFromArtifact(app, rootBytes)
    rootSourceCommit = originalRoot.sourceCommit
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  const rootCompilation = app === "bike-nft" || originalRoot !== undefined
    ? await readRootCompilation(app, resolve(directory, "compiler/root"), resolve(directory, "sources/root/dapps")) : undefined
  const selected = selectBundleCompilations(app, businessCompilations, uiCompilation, rootCompilation)
  if (!isDeepStrictEqual(artifact.abiSources, bundleCompilationSources(selected, business.sourceCommit, ui.sourceCommit, rootSourceCommit))) {
    throw new Error("Prepared CAM bundle ABI provenance differs from its retained original compilations")
  }
  const rootPath = resolve(directory, "bundle/main.json")
  const rootBytes = await readBoundedRegularFile(rootPath, "prepared CAM root", 1024 * 1024)
  if (sha256(rootBytes).toLowerCase() !== requiredBytes32(artifact.rootSha256, "prepared CAM hash").toLowerCase()) throw new Error("Prepared CAM root bytes differ from the bundle artifact")
  const root = parseJsonBytes(rootBytes)
  const resources = await declaredLocalResources(rootPath, root)
  if (!isRecordObject(root) || !isRecordObject(root.namespaces)) throw new Error("Prepared CAM root must declare namespaces")
  for (const [name, original] of selected) {
    const declaration = root.namespaces[`contracts.${name}`]
    if (!isRecordObject(declaration) || typeof declaration.abiURI !== "string") throw new Error(`Prepared CAM root lacks ABI resource ${name}`)
    const bytes = resources.get(declaration.abiURI)
    if (bytes === undefined || sha256(bytes) !== sha256(serializeCamABI(original.compilation.abi))) throw new Error(`Prepared CAM ABI resource ${name} differs from its selected original source`)
  }
  const issue = validateCamBundle({ rootURI, rootBytes, resources })[0]
  if (issue !== undefined) throw new Error(`Prepared CAM bundle does not conform: ${issue.rule}: ${issue.message}`)
  return { artifactBytes, artifactSha256: sha256(artifactBytes), authoringSourceCommit, rootBytes, rootSha256: sha256(rootBytes),
    businessBytes, uiBytes, businessCompilations, uiCompilation, rootCompilation, rootSourceCommit, originalRoot }
}
