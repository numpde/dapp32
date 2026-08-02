import { assertPublishedCamRootURI } from "../packages/cam-protocol/dist/index.js"

import { inspectReleaseCamBundle } from "./release-cam-bundle.ts"
import { readBoundedRegularFile, writeNewJson } from "./release-files.ts"

const MAX_ARTIFACT_BYTES = 1024 * 1024

type ReleaseArtifactIdentity = {
  readonly sourceCommit: string
  readonly camURI: string
  readonly camHash: `0x${string}`
}

export async function stageVerifiedReleaseArtifact<T extends ReleaseArtifactIdentity>({
  artifactPath,
  parseArtifact,
  expectedSourceCommit,
  dappsRootPath,
  rootPath,
  snapshotPath,
  label,
}: {
  readonly artifactPath: string
  readonly parseArtifact: (bytes: Uint8Array) => T
  readonly expectedSourceCommit: string
  readonly dappsRootPath: string
  readonly rootPath: string
  readonly snapshotPath: string
  readonly label: string
}): Promise<T> {
  const artifact = parseArtifact(
    await readBoundedRegularFile(artifactPath, "deployment artifact", MAX_ARTIFACT_BYTES),
  )
  if (artifact.sourceCommit !== expectedSourceCommit) {
    throw new Error(
      `deployment source commit mismatch: expected ${expectedSourceCommit}, got ${artifact.sourceCommit}`,
    )
  }

  assertPublishedCamRootURI(artifact.camURI, "deployment camURI")
  const bundle = await inspectReleaseCamBundle({
    dappsRootPath,
    rootPath,
    camURI: artifact.camURI,
    label,
  })
  if (bundle.camHash.toLowerCase() !== artifact.camHash.toLowerCase()) {
    throw new Error(
      `deployment CAM hash does not match checked-in root bytes: expected ${bundle.camHash}, got ${artifact.camHash}`,
    )
  }

  await writeNewJson(snapshotPath, artifact, "verified deployment artifact")
  return artifact
}
