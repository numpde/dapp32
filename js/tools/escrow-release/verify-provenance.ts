import { lstat, readFile } from "node:fs/promises"

import {
  createPublicClient,
  http,
} from "viem"

import {
  creationReceiptDeployer,
} from "./artifact-model.ts"
import type {
  DeploymentContracts,
} from "./artifact-model.ts"
import {
  deploymentArguments,
  parseDeploymentArtifact,
  requiredEnv,
} from "./shared.ts"

const MAX_ARTIFACT_BYTES = 1024 * 1024

async function main(): Promise<void> {
  const artifactPath = requiredEnv(process.env, "ESCROW_DEPLOYMENT_ARTIFACT_PATH")
  const argumentsPath = requiredEnv(process.env, "ESCROW_DEPLOYMENT_ARGUMENTS_PATH")
  const rpcURL = requiredEnv(process.env, "ESCROW_RELEASE_RPC_URL")
  const artifact = parseDeploymentArtifact(
    await readRegularFile(artifactPath, "deployment artifact", MAX_ARTIFACT_BYTES),
  )

  const argumentsText = new TextDecoder().decode(
    await readRegularFile(argumentsPath, "deployment arguments", MAX_ARTIFACT_BYTES),
  )
  if (argumentsText !== deploymentArguments(artifact)) {
    throw new Error("deployment arguments do not exactly match deployment.json")
  }

  const client = createPublicClient({ transport: http(rpcURL) })
  const chainId = await client.getChainId()
  if (chainId !== artifact.chainId) {
    throw new Error(`release RPC chain mismatch: expected ${artifact.chainId}, got ${chainId}`)
  }

  const contracts: DeploymentContracts = {
    camRoot: {
      address: artifact.camRoot,
      transactionHash: artifact.camRootCreationTransaction,
    },
    camEscrow: {
      address: artifact.camEscrow,
      transactionHash: artifact.camEscrowCreationTransaction,
    },
    camEscrowUI: {
      address: artifact.camEscrowUI,
      transactionHash: artifact.camEscrowUICreationTransaction,
    },
  }
  const [rootReceipt, escrowReceipt, uiReceipt] = await Promise.all([
    client.getTransactionReceipt({ hash: contracts.camRoot.transactionHash }),
    client.getTransactionReceipt({ hash: contracts.camEscrow.transactionHash }),
    client.getTransactionReceipt({ hash: contracts.camEscrowUI.transactionHash }),
  ])
  const deployers = new Set([
    creationReceiptDeployer(contracts.camRoot, rootReceipt, "CamRoot").toLowerCase(),
    creationReceiptDeployer(contracts.camEscrow, escrowReceipt, "CamEscrow").toLowerCase(),
    creationReceiptDeployer(contracts.camEscrowUI, uiReceipt, "CamEscrowUI").toLowerCase(),
  ])
  if (deployers.size !== 1 || !deployers.has(artifact.deployer.toLowerCase())) {
    throw new Error(`release creation transaction deployer mismatch: expected ${artifact.deployer}`)
  }

  process.stdout.write(`${JSON.stringify({
    event: "escrow_release_provenance_verified",
    chainId: artifact.chainId,
    deployer: artifact.deployer,
    camRootCreationTransaction: artifact.camRootCreationTransaction,
    camEscrowCreationTransaction: artifact.camEscrowCreationTransaction,
    camEscrowUICreationTransaction: artifact.camEscrowUICreationTransaction,
  })}\n`)
}

async function readRegularFile(path: string, label: string, maximum: number): Promise<Uint8Array> {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file: ${path}`)
  }
  if (stat.size > maximum) {
    throw new Error(`${label} exceeds ${maximum} bytes`)
  }
  return new Uint8Array(await readFile(path))
}

main().catch((error: unknown) => {
  let message: string
  if (error instanceof Error && error.stack !== undefined) {
    message = error.stack
  } else if (error instanceof Error) {
    message = error.message
  } else {
    message = String(error)
  }
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
