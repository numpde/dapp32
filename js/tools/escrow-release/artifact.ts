import { lstat, readFile } from "node:fs/promises"
import { resolve } from "node:path"

import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem"
import type {
  Address,
  Hex,
} from "viem"

import {
  deploymentContractsFromBroadcast,
  ownershipState,
} from "./artifact-model.ts"
import {
  DEPLOYMENT_SCHEMA,
  deploymentArguments,
  parseJsonRecord,
  parseReleasePlan,
  requiredEnv,
  writeNewJson,
  writeNewText,
} from "./shared.ts"
import type {
  DeploymentArtifact,
} from "./shared.ts"

const MAX_BROADCAST_BYTES = 16 * 1024 * 1024
const CAM_ROOT_ABI = parseAbi([
  "function camURI() view returns (string)",
  "function camHash() view returns (bytes32)",
  "function contractAddress(string contractName) view returns (address)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
])
const CAM_ESCROW_UI_ABI = parseAbi([
  "function escrow() view returns (address)",
])

async function main(): Promise<void> {
  const planPath = requiredEnv(process.env, "ESCROW_RELEASE_PLAN_PATH")
  const broadcastDir = requiredEnv(process.env, "ESCROW_RELEASE_BROADCAST_DIR")
  const artifactPath = requiredEnv(process.env, "ESCROW_DEPLOYMENT_ARTIFACT_PATH")
  const artifactArgumentsPath = requiredEnv(process.env, "ESCROW_DEPLOYMENT_ARGUMENTS_PATH")
  const rpcURL = requiredEnv(process.env, "ESCROW_RELEASE_RPC_URL")

  const plan = parseReleasePlan(await readRegularFile(planPath, "release plan", MAX_BROADCAST_BYTES))
  const broadcastPath = resolve(
    broadcastDir,
    "DeployEscrowRelease.s.sol",
    String(plan.expectedChainId),
    "run-latest.json",
  )
  const broadcast = parseJsonRecord(
    await readRegularFile(broadcastPath, "Forge broadcast", MAX_BROADCAST_BYTES),
    "Forge broadcast",
  )
  const contracts = deploymentContractsFromBroadcast(broadcast)
  const client = createPublicClient({ transport: http(rpcURL) })
  const chainId = await client.getChainId()
  if (chainId !== plan.expectedChainId) {
    throw new Error(`release RPC chain mismatch: expected ${plan.expectedChainId}, got ${chainId}`)
  }

  const receipts = await Promise.all([
    client.getTransactionReceipt({ hash: contracts.camRoot.transactionHash }),
    client.getTransactionReceipt({ hash: contracts.camEscrow.transactionHash }),
    client.getTransactionReceipt({ hash: contracts.camEscrowUI.transactionHash }),
  ])
  for (const [index, receipt] of receipts.entries()) {
    if (receipt.status !== "success") {
      throw new Error(`release creation transaction ${index} did not succeed: ${receipt.transactionHash}`)
    }
  }
  const deployers = new Set(receipts.map((receipt) => getAddress(receipt.from)))
  if (deployers.size !== 1) {
    throw new Error("release creation transactions do not share one deployer")
  }
  const deployer = [...deployers][0]
  if (deployer === undefined) {
    throw new Error("release deployment receipt has no deployer")
  }

  const [rootCode, escrowCode, uiCode] = await Promise.all([
    requiredCode(client.getCode({ address: contracts.camRoot.address }), "CamRoot"),
    requiredCode(client.getCode({ address: contracts.camEscrow.address }), "CamEscrow"),
    requiredCode(client.getCode({ address: contracts.camEscrowUI.address }), "CamEscrowUI"),
  ])

  const [camURI, camHash, escrowBinding, uiBinding, owner, pendingOwner, projectionEscrow] = await Promise.all([
    client.readContract({ address: contracts.camRoot.address, abi: CAM_ROOT_ABI, functionName: "camURI" }),
    client.readContract({ address: contracts.camRoot.address, abi: CAM_ROOT_ABI, functionName: "camHash" }),
    client.readContract({
      address: contracts.camRoot.address,
      abi: CAM_ROOT_ABI,
      functionName: "contractAddress",
      args: ["CamEscrow"],
    }),
    client.readContract({
      address: contracts.camRoot.address,
      abi: CAM_ROOT_ABI,
      functionName: "contractAddress",
      args: ["CamEscrowUI"],
    }),
    client.readContract({ address: contracts.camRoot.address, abi: CAM_ROOT_ABI, functionName: "owner" }),
    client.readContract({ address: contracts.camRoot.address, abi: CAM_ROOT_ABI, functionName: "pendingOwner" }),
    client.readContract({ address: contracts.camEscrowUI.address, abi: CAM_ESCROW_UI_ABI, functionName: "escrow" }),
  ])

  assertEqual(camURI, plan.camURI, "CamRoot CAM URI")
  assertEqual(camHash.toLowerCase(), plan.camHash.toLowerCase(), "CamRoot CAM hash")
  assertAddress(escrowBinding, contracts.camEscrow.address, "CamRoot CamEscrow binding")
  assertAddress(uiBinding, contracts.camEscrowUI.address, "CamRoot CamEscrowUI binding")
  assertAddress(projectionEscrow, contracts.camEscrow.address, "CamEscrowUI backing escrow")

  const ownership = ownershipState({
    deployer,
    intendedOwner: plan.intendedCamRootOwner,
    owner: getAddress(owner),
    pendingOwner: getAddress(pendingOwner),
  })

  const artifact: DeploymentArtifact = {
    schema: DEPLOYMENT_SCHEMA,
    sourceCommit: plan.sourceCommit,
    chainId,
    deployer,
    camURI: plan.camURI,
    camHash: plan.camHash,
    intendedCamRootOwner: getAddress(plan.intendedCamRootOwner),
    ownershipTransferRequired: ownership.ownershipTransferRequired,
    ownershipAccepted: ownership.ownershipAccepted,
    camRoot: contracts.camRoot.address,
    camEscrow: contracts.camEscrow.address,
    camEscrowUI: contracts.camEscrowUI.address,
    camRootCodeHash: keccak256(rootCode),
    camEscrowCodeHash: keccak256(escrowCode),
    camEscrowUICodeHash: keccak256(uiCode),
    camRootCreationTransaction: contracts.camRoot.transactionHash,
    camEscrowCreationTransaction: contracts.camEscrow.transactionHash,
    camEscrowUICreationTransaction: contracts.camEscrowUI.transactionHash,
  }
  await writeNewJson(artifactPath, artifact, "deployment artifact")
  await writeNewText(
    artifactArgumentsPath,
    deploymentArguments(artifact),
    "deployment arguments",
  )

  process.stdout.write(`${JSON.stringify({
    event: "escrow_deployment_artifact",
    artifactPath,
    artifactArgumentsPath,
    chainId,
    sourceCommit: artifact.sourceCommit,
    camRoot: artifact.camRoot,
    camEscrow: artifact.camEscrow,
    camEscrowUI: artifact.camEscrowUI,
    intendedCamRootOwner: artifact.intendedCamRootOwner,
    ownershipAccepted: artifact.ownershipAccepted,
  })}\n`)
}

async function requiredCode(codePromise: Promise<Hex | undefined>, label: string): Promise<Hex> {
  const code = await codePromise
  if (code === undefined || code === "0x") {
    throw new Error(`${label} has no deployed code`)
  }
  return code
}

function assertAddress(actual: Address, expected: Address, label: string): void {
  assertEqual(actual.toLowerCase(), expected.toLowerCase(), label)
}

function assertEqual(actual: string, expected: string, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, got ${actual}`)
  }
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
