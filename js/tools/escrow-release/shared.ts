import { lstat, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

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

export const RELEASE_PLAN_SCHEMA = "escrow.release-plan.v1"
export const DEPLOYMENT_SCHEMA = "escrow.deployment.v1"
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

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
  if (!Number.isSafeInteger(chainId)) {
    throw new Error("expected chain ID exceeds the JavaScript safe-integer range")
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

export function requiredTransactionHash(value: unknown, label: string): `0x${string}` {
  return requiredBytes32(value, label)
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

export function parseJsonRecord(bytes: Uint8Array, label: string): Record<string, unknown> {
  return requiredRecord(parseJsonBytes(bytes), label)
}

export function parseReleasePlan(bytes: Uint8Array): ReleasePlan {
  const value = parseJsonRecord(bytes, "release plan")
  if (value.schema !== RELEASE_PLAN_SCHEMA) {
    throw new Error(`unsupported release plan schema: ${String(value.schema)}`)
  }
  const expectedChainId = value.expectedChainId
  if (typeof expectedChainId !== "number" || !Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) {
    throw new Error("release plan expectedChainId must be a positive safe integer")
  }

  return {
    schema: RELEASE_PLAN_SCHEMA,
    sourceCommit: requiredSourceCommit(requiredString(value.sourceCommit, "release plan sourceCommit")),
    expectedChainId,
    camURI: requiredString(value.camURI, "release plan camURI"),
    camHash: requiredBytes32(value.camHash, "release plan camHash"),
    intendedCamRootOwner: requiredNonzeroAddress(
      requiredString(value.intendedCamRootOwner, "release plan intendedCamRootOwner"),
      "release plan intendedCamRootOwner",
    ),
  }
}

export async function writeNewJson(path: string, value: unknown, label: string): Promise<void> {
  const parent = dirname(path)
  const parentStat = await lstat(parent)
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory()) {
    throw new Error(`${label} parent must be a real directory: ${parent}`)
  }

  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf-8",
    flag: "wx",
    mode: 0o600,
  })
}
