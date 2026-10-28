import type {
  CamHost,
} from "../../packages/cam-evm-viem/dist/index.js"
import {
  checkedReleaseChainId,
  parseJsonRecord,
  requireDistinctHexValues,
  requireExactKeys,
  requiredBoolean,
  requiredNonemptyString,
  requiredNonzeroAddress,
  requiredNonzeroBytes32,
  requiredBytes32,
  requiredSafeInteger,
  requiredSourceCommit,
  requiredTransactionHash,
} from "../release-values.ts"

export const DEPLOYMENT_SCHEMA = "escrow.deployment.v2"

const DEPLOYMENT_KEYS = [
  "schema",
  "sourceCommit",
  "chainId",
  "deployer",
  "camURI",
  "camHash",
  "intendedCamRootOwner",
  "ownershipTransferRequired",
  "ownershipAccepted",
  "camRoot",
  "camEscrow",
  "camEscrowUI",
  "camRootCodeHash",
  "camEscrowCodeHash",
  "camEscrowUICodeHash",
  "camRootCreationTransaction",
  "camEscrowCreationTransaction",
  "camEscrowUICreationTransaction",
] as const

export type DeploymentArtifact = {
  readonly schema: typeof DEPLOYMENT_SCHEMA
  readonly sourceCommit: string
  readonly chainId: number
  readonly deployer: CamHost["address"]
  readonly camURI: string
  readonly camHash: `0x${string}`
  readonly intendedCamRootOwner: CamHost["address"]
  readonly ownershipTransferRequired: boolean
  readonly ownershipAccepted: boolean
  readonly camRoot: CamHost["address"]
  readonly camEscrow: CamHost["address"]
  readonly camEscrowUI: CamHost["address"]
  readonly camRootCodeHash: `0x${string}`
  readonly camEscrowCodeHash: `0x${string}`
  readonly camEscrowUICodeHash: `0x${string}`
  readonly camRootCreationTransaction: `0x${string}`
  readonly camEscrowCreationTransaction: `0x${string}`
  readonly camEscrowUICreationTransaction: `0x${string}`
}

export function parseDeploymentArtifact(bytes: Uint8Array): DeploymentArtifact {
  const value = parseJsonRecord(bytes, "deployment artifact")
  requireExactKeys(value, DEPLOYMENT_KEYS, "escrow deployment artifact")
  if (value.schema !== DEPLOYMENT_SCHEMA) {
    throw new Error(`unsupported deployment artifact schema: ${String(value.schema)}`)
  }

  const artifact: DeploymentArtifact = {
    schema: DEPLOYMENT_SCHEMA,
    sourceCommit: requiredSourceCommit(value.sourceCommit),
    chainId: checkedReleaseChainId(requiredSafeInteger(value.chainId, "deployment chainId")),
    deployer: requiredNonzeroAddress(value.deployer, "deployment deployer"),
    camURI: requiredNonemptyString(value.camURI, "deployment camURI"),
    camHash: requiredBytes32(value.camHash, "deployment camHash"),
    intendedCamRootOwner: requiredNonzeroAddress(
      value.intendedCamRootOwner,
      "deployment intendedCamRootOwner",
    ),
    ownershipTransferRequired: requiredBoolean(
      value.ownershipTransferRequired,
      "deployment ownershipTransferRequired",
    ),
    ownershipAccepted: requiredBoolean(value.ownershipAccepted, "deployment ownershipAccepted"),
    camRoot: requiredNonzeroAddress(value.camRoot, "deployment camRoot"),
    camEscrow: requiredNonzeroAddress(
      value.camEscrow,
      "deployment camEscrow",
    ),
    camEscrowUI: requiredNonzeroAddress(
      value.camEscrowUI,
      "deployment camEscrowUI",
    ),
    camRootCodeHash: requiredNonzeroBytes32(value.camRootCodeHash, "deployment camRootCodeHash"),
    camEscrowCodeHash: requiredNonzeroBytes32(value.camEscrowCodeHash, "deployment camEscrowCodeHash"),
    camEscrowUICodeHash: requiredNonzeroBytes32(value.camEscrowUICodeHash, "deployment camEscrowUICodeHash"),
    camRootCreationTransaction: requiredTransactionHash(
      value.camRootCreationTransaction,
      "deployment camRootCreationTransaction",
    ),
    camEscrowCreationTransaction: requiredTransactionHash(
      value.camEscrowCreationTransaction,
      "deployment camEscrowCreationTransaction",
    ),
    camEscrowUICreationTransaction: requiredTransactionHash(
      value.camEscrowUICreationTransaction,
      "deployment camEscrowUICreationTransaction",
    ),
  }

  const transferRequired = artifact.deployer.toLowerCase() !== artifact.intendedCamRootOwner.toLowerCase()
  if (artifact.ownershipTransferRequired !== transferRequired) {
    throw new Error("deployment ownershipTransferRequired disagrees with deployer and intended owner")
  }
  if (!transferRequired && !artifact.ownershipAccepted) {
    throw new Error("deployment ownershipAccepted must be true when no ownership transfer is required")
  }

  const creationTransactions = [
    artifact.camRootCreationTransaction,
    artifact.camEscrowCreationTransaction,
    artifact.camEscrowUICreationTransaction,
  ]
  requireDistinctHexValues(creationTransactions, "deployment creation transaction hashes")

  return artifact
}
