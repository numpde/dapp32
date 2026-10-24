import {
  createPublicClient,
  http,
} from "viem"

import { observeReleaseCreations } from "../release-provenance.ts"
import { parseDeploymentArtifact } from "./shared.ts"
import { readBoundedRegularFile } from "../release-files.ts"
import { requiredEnv } from "../input.ts"
import { assertAddress, runReleaseTool } from "../release-values.ts"

const MAX_ARTIFACT_BYTES = 1024 * 1024

async function main(): Promise<void> {
  const artifactPath = requiredEnv(process.env, "ESCROW_DEPLOYMENT_ARTIFACT_PATH")
  const rpcURL = requiredEnv(process.env, "ESCROW_RELEASE_RPC_URL")
  const artifact = parseDeploymentArtifact(
    await readBoundedRegularFile(artifactPath, "deployment artifact", MAX_ARTIFACT_BYTES),
  )

  const client = createPublicClient({ transport: http(rpcURL) })
  const { deployer } = await observeReleaseCreations({
    client, expectedChainId: artifact.chainId,
    contracts: [
      { label: "CamRoot", address: artifact.camRoot, transactionHash: artifact.camRootCreationTransaction },
      { label: "CamEscrow", address: artifact.camEscrow, transactionHash: artifact.camEscrowCreationTransaction },
      { label: "CamEscrowUI", address: artifact.camEscrowUI, transactionHash: artifact.camEscrowUICreationTransaction },
    ],
  })
  assertAddress(deployer, artifact.deployer, "release creation transaction deployer")

  process.stdout.write(`${JSON.stringify({
    event: "escrow_release_provenance_verified",
    chainId: artifact.chainId,
    deployer: artifact.deployer,
    camRootCreationTransaction: artifact.camRootCreationTransaction,
    camEscrowCreationTransaction: artifact.camEscrowCreationTransaction,
    camEscrowUICreationTransaction: artifact.camEscrowUICreationTransaction,
  })}\n`)
}

runReleaseTool(main)
