import {
  requireEvmAddress,
} from "../../packages/cam-evm-viem/dist/index.js"
import type {
  CamHost,
} from "../../packages/cam-evm-viem/dist/index.js"
import {
  isRecordObject,
  parseJsonBytes,
} from "../../packages/cam-protocol/dist/index.js"

export { writeNewJson, writeNewText } from "../release-files.ts"

export const RELEASE_PLAN_SCHEMA = "escrow.release-plan.v1"
export const DEPLOYMENT_SCHEMA = "escrow.deployment.v1"
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

const RELEASE_PLAN_KEYS = [
  "schema",
  "sourceCommit",
  "expectedChainId",
  "camURI",
  "camHash",
  "intendedCamRootOwner",
] as const

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

export type ReleasePlan = {
  readonly schema: typeof RELEASE_PLAN_SCHEMA
  readonly sourceCommit: string
  readonly expectedChainId: number
  readonly camURI: string
  readonly camHash: `0x${string}`
  readonly intendedCamRootOwner: CamHost["address"]
}

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

export function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required environment variable: ${name}`)
  }
  return value
}

export function requiredSourceCommit(value: string): string {
  if (!/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("source commit must be exactly 40 lowercase hexadecimal characters")
  }
  return value
}

export function requiredReleaseChainId(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error("expected chain ID must be a positive decimal integer")
  }
  const chainId = Number(value)
  return checkedReleaseChainId(chainId)
}

export function checkedReleaseChainId(chainId: number): number {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("expected chain ID must be a positive safe integer")
  }
  if (chainId === 1337 || chainId === 31337) {
    throw new Error(`release deployment rejects local fixture chain ID: ${chainId}`)
  }
  return chainId
}

export function requiredNonzeroAddress(value: string, label: string): CamHost["address"] {
  const address = requireEvmAddress(value, label)
  if (address.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label} must not be the zero address`)
  }
  return address
}

export function requiredBytes32(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a 32-byte hexadecimal value`)
  }
  return value as `0x${string}`
}

export function requiredNonzeroBytes32(value: unknown, label: string): `0x${string}` {
  const result = requiredBytes32(value, label)
  if (/^0x0{64}$/i.test(result)) {
    throw new Error(`${label} must not be zero`)
  }
  return result
}

export function requiredTransactionHash(value: unknown, label: string): `0x${string}` {
  return requiredNonzeroBytes32(value, label)
}

export function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecordObject(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

export function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`)
  }
  return value
}

export function parseJsonRecord(bytes: Uint8Array, label: string): Record<string, unknown> {
  return requiredRecord(parseJsonBytes(bytes), label)
}

export function parseReleasePlan(bytes: Uint8Array): ReleasePlan {
  const value = parseJsonRecord(bytes, "release plan")
  requireExactKeys(value, RELEASE_PLAN_KEYS, "release plan")
  if (value.schema !== RELEASE_PLAN_SCHEMA) {
    throw new Error(`unsupported release plan schema: ${String(value.schema)}`)
  }

  return {
    schema: RELEASE_PLAN_SCHEMA,
    sourceCommit: requiredSourceCommit(requiredString(value.sourceCommit, "release plan sourceCommit")),
    expectedChainId: checkedReleaseChainId(requiredSafeInteger(value.expectedChainId, "release plan expectedChainId")),
    camURI: requiredString(value.camURI, "release plan camURI"),
    camHash: requiredNonzeroBytes32(value.camHash, "release plan camHash"),
    intendedCamRootOwner: requiredNonzeroAddress(
      requiredString(value.intendedCamRootOwner, "release plan intendedCamRootOwner"),
      "release plan intendedCamRootOwner",
    ),
  }
}

export function parseDeploymentArtifact(bytes: Uint8Array): DeploymentArtifact {
  const value = parseJsonRecord(bytes, "deployment artifact")
  requireExactKeys(value, DEPLOYMENT_KEYS, "deployment artifact")
  if (value.schema !== DEPLOYMENT_SCHEMA) {
    throw new Error(`unsupported deployment artifact schema: ${String(value.schema)}`)
  }

  const artifact: DeploymentArtifact = {
    schema: DEPLOYMENT_SCHEMA,
    sourceCommit: requiredSourceCommit(requiredString(value.sourceCommit, "deployment sourceCommit")),
    chainId: checkedReleaseChainId(requiredSafeInteger(value.chainId, "deployment chainId")),
    deployer: requiredNonzeroAddress(requiredString(value.deployer, "deployment deployer"), "deployment deployer"),
    camURI: requiredString(value.camURI, "deployment camURI"),
    camHash: requiredNonzeroBytes32(value.camHash, "deployment camHash"),
    intendedCamRootOwner: requiredNonzeroAddress(
      requiredString(value.intendedCamRootOwner, "deployment intendedCamRootOwner"),
      "deployment intendedCamRootOwner",
    ),
    ownershipTransferRequired: requiredBoolean(
      value.ownershipTransferRequired,
      "deployment ownershipTransferRequired",
    ),
    ownershipAccepted: requiredBoolean(value.ownershipAccepted, "deployment ownershipAccepted"),
    camRoot: requiredNonzeroAddress(requiredString(value.camRoot, "deployment camRoot"), "deployment camRoot"),
    camEscrow: requiredNonzeroAddress(
      requiredString(value.camEscrow, "deployment camEscrow"),
      "deployment camEscrow",
    ),
    camEscrowUI: requiredNonzeroAddress(
      requiredString(value.camEscrowUI, "deployment camEscrowUI"),
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
  if (new Set(creationTransactions.map((hash) => hash.toLowerCase())).size !== creationTransactions.length) {
    throw new Error("deployment creation transaction hashes must be distinct")
  }

  return artifact
}

export function releasePlanArguments(plan: ReleasePlan): string {
  return lines([
    plan.schema,
    plan.sourceCommit,
    String(plan.expectedChainId),
    plan.camURI,
    plan.camHash,
    plan.intendedCamRootOwner,
  ])
}

export function deploymentArguments(artifact: DeploymentArtifact): string {
  return lines([
    artifact.schema,
    artifact.sourceCommit,
    String(artifact.chainId),
    artifact.deployer,
    artifact.camURI,
    artifact.camHash,
    artifact.intendedCamRootOwner,
    String(artifact.ownershipTransferRequired),
    String(artifact.ownershipAccepted),
    artifact.camRoot,
    artifact.camEscrow,
    artifact.camEscrowUI,
    artifact.camRootCodeHash,
    artifact.camEscrowCodeHash,
    artifact.camEscrowUICodeHash,
    artifact.camRootCreationTransaction,
    artifact.camEscrowCreationTransaction,
    artifact.camEscrowUICreationTransaction,
  ])
}

function requiredSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`)
  }
  return value
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const expectedSet = new Set(expected)
  const actual = Object.keys(value)
  const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(value, key))
  const unexpected = actual.filter((key) => !expectedSet.has(key))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label} fields disagree: missing=[${missing.join(",")}] unexpected=[${unexpected.join(",")}]`,
    )
  }
}

function lines(values: readonly string[]): string {
  for (const value of values) {
    if (value.includes("\n") || value.includes("\r")) {
      throw new Error("release companion arguments must not contain line breaks")
    }
  }
  return `${values.join("\n")}\n`
}
