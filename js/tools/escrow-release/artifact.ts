import { resolve } from "node:path"

import {
  createPublicClient,
  getAddress,
  http,
  keccak256,
  parseAbi,
} from "viem"
import type {
  Hex,
} from "viem"

import { ownershipState } from "../release-ownership.ts"
import {
  deploymentContractsFromBroadcast,
} from "./artifact-model.ts"
import {
  observeReleaseCreations,
} from "../release-provenance.ts"
import {
  DEPLOYMENT_SCHEMA,
  parseReleasePlan,
} from "./shared.ts"
import type {
  DeploymentArtifact,
} from "./shared.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { requiredEnv } from "../input.ts"
import { assertAddress, assertEqual, parseJsonRecord, runReleaseTool } from "../release-values.ts"

const MAX_BROADCAST_BYTES = 16 * 1024 * 1024
const CAM_ROOT_ABI = parseAbi([
  "function camManifest() view returns ((string uri, bytes32 sha256Digest))",
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
  const rpcURL = requiredEnv(process.env, "ESCROW_RELEASE_RPC_URL")

  const plan = parseReleasePlan(await readBoundedRegularFile(planPath, "release plan", MAX_BROADCAST_BYTES))
  const broadcastPath = resolve(
    broadcastDir,
    "DeployEscrowRelease.s.sol",
    String(plan.expectedChainId),
    "run-latest.json",
  )
  const broadcast = parseJsonRecord(
    await readBoundedRegularFile(broadcastPath, "Forge broadcast", MAX_BROADCAST_BYTES),
    "Forge broadcast",
  )
  const contracts = deploymentContractsFromBroadcast(broadcast)
  const client = createPublicClient({ transport: http(rpcURL) })
  const { chainId, deployer } = await observeReleaseCreations({
    client, expectedChainId: plan.expectedChainId,
    contracts: [
      { label: "CamRoot", ...contracts.camRoot },
      { label: "CamEscrow", ...contracts.camEscrow },
      { label: "CamEscrowUI", ...contracts.camEscrowUI },
    ],
  })

  const observationBlockNumber = await client.getBlockNumber()
  const [rootCode, escrowCode, uiCode] = await Promise.all([
    requiredCode(
      client.getCode({ address: contracts.camRoot.address, blockNumber: observationBlockNumber }),
      "CamRoot",
    ),
    requiredCode(
      client.getCode({ address: contracts.camEscrow.address, blockNumber: observationBlockNumber }),
      "CamEscrow",
    ),
    requiredCode(
      client.getCode({ address: contracts.camEscrowUI.address, blockNumber: observationBlockNumber }),
      "CamEscrowUI",
    ),
  ])

  const [manifest, escrowBinding, uiBinding, owner, pendingOwner, projectionEscrow] = await Promise.all([
    client.readContract({
      address: contracts.camRoot.address,
      abi: CAM_ROOT_ABI,
      functionName: "camManifest",
      blockNumber: observationBlockNumber,
    }),
    client.readContract({
      address: contracts.camRoot.address,
      abi: CAM_ROOT_ABI,
      functionName: "contractAddress",
      args: ["CamEscrow"],
      blockNumber: observationBlockNumber,
    }),
    client.readContract({
      address: contracts.camRoot.address,
      abi: CAM_ROOT_ABI,
      functionName: "contractAddress",
      args: ["CamEscrowUI"],
      blockNumber: observationBlockNumber,
    }),
    client.readContract({
      address: contracts.camRoot.address,
      abi: CAM_ROOT_ABI,
      functionName: "owner",
      blockNumber: observationBlockNumber,
    }),
    client.readContract({
      address: contracts.camRoot.address,
      abi: CAM_ROOT_ABI,
      functionName: "pendingOwner",
      blockNumber: observationBlockNumber,
    }),
    client.readContract({
      address: contracts.camEscrowUI.address,
      abi: CAM_ESCROW_UI_ABI,
      functionName: "escrow",
      blockNumber: observationBlockNumber,
    }),
  ])

  assertEqual(manifest.uri, plan.camURI, "CamRoot CAM URI")
  assertEqual(manifest.sha256Digest.toLowerCase(), plan.camHash.toLowerCase(), "CamRoot CAM hash")
  assertAddress(escrowBinding, contracts.camEscrow.address, "CamRoot CamEscrow binding")
  assertAddress(uiBinding, contracts.camEscrowUI.address, "CamRoot CamEscrowUI binding")
  assertAddress(projectionEscrow, contracts.camEscrow.address, "CamEscrowUI backing escrow")

  const ownership = ownershipState({ label: "CamRoot",
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

  process.stdout.write(`${JSON.stringify({
    event: "escrow_deployment_artifact",
    artifactPath,
    chainId,
    observationBlockNumber: observationBlockNumber.toString(),
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

runReleaseTool(main)
