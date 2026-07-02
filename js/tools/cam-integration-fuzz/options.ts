import type { Address, Hex } from "viem"

import {
  requireEvmAddress,
  requireEvmChainId,
} from "../../packages/cam-evm-viem/dist/index.js"
import {
  isRecordObject,
  parseJsonBytes,
  requireHttpOrigin,
  requireHttpURL,
} from "../../packages/cam-protocol/dist/index.js"
import {
  requiredBoolean,
  requiredEnv,
  requiredPositiveIntegerEnv,
  requiredString,
  requiredStringValue,
} from "../input.ts"
import {
  readBoundedFileSync,
} from "../local-cam-files.ts"

export type Descriptor = {
  readonly camIntegration: typeof CAM_INTEGRATION_DESCRIPTOR_VERSION
  readonly chainId: string
  readonly rpcUrl: string
  readonly camHost: Address
  readonly resourceOrigin: string
  readonly accounts: readonly Address[]
  readonly allowUnsignedCamHash: boolean
}

export type RunnerOptions = {
  readonly descriptor: Descriptor
  readonly seed: string
  readonly runs: number
  readonly steps: number
  readonly writeMode: WriteMode
}

export type WriteMode =
  | { readonly kind: "simulate" }
  | {
    readonly kind: "local-fixture"
    readonly privateKey: Hex
  }

const CAM_INTEGRATION_DESCRIPTOR_VERSION = "1.0.0"
const MAX_RUNS = 100
const MAX_STEPS = 1_000
const DESCRIPTOR_KEYS = new Set([
  "camIntegration",
  "chainId",
  "rpcUrl",
  "camHost",
  "resourceOrigin",
  "accounts",
  "allowUnsignedCamHash",
])

export function readOptions(env: NodeJS.ProcessEnv): RunnerOptions {
  return {
    descriptor: readDescriptor(requiredEnv(env, "CAM_INTEGRATION_DESCRIPTOR_PATH")),
    seed: requiredEnv(env, "CAM_INTEGRATION_SEED"),
    runs: boundedPositiveIntegerEnv(env, "CAM_INTEGRATION_RUNS", MAX_RUNS),
    steps: boundedPositiveIntegerEnv(env, "CAM_INTEGRATION_STEPS", MAX_STEPS),
    writeMode: readWriteMode(env),
  }
}

function boundedPositiveIntegerEnv(env: NodeJS.ProcessEnv, name: string, max: number): number {
  const value = requiredPositiveIntegerEnv(env, name)
  if (value > max) {
    // These bounds are a lane contract, not a randomness heuristic. Larger
    // campaigns should be split deliberately so CI timeouts and RPC load stay reviewable.
    throw new Error(`${name}: expected a positive integer no greater than ${max}`)
  }

  return value
}

function readWriteMode(env: NodeJS.ProcessEnv): WriteMode {
  const value = requiredEnv(env, "CAM_INTEGRATION_WRITE_MODE")
  if (value === "simulate") {
    return { kind: "simulate" }
  }
  if (value === "local-fixture") {
    return {
      kind: "local-fixture",
      privateKey: requiredPrivateKey(env, "CAM_INTEGRATION_PRIVATE_KEY"),
    }
  }

  throw new Error(`CAM_INTEGRATION_WRITE_MODE: unsupported write mode: ${value}`)
}

function requiredPrivateKey(env: NodeJS.ProcessEnv, name: string): Hex {
  const value = requiredEnv(env, name)
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name}: expected a 32-byte hex private key`)
  }

  return value as Hex
}

function readDescriptor(path: string): Descriptor {
  const value = parseJsonBytes(readBoundedFileSync(path, "CAM integration descriptor"))
  if (!isRecordObject(value)) {
    throw new Error("CAM integration descriptor must be an object")
  }
  rejectUnknownDescriptorFields(value)
  if (value.camIntegration !== CAM_INTEGRATION_DESCRIPTOR_VERSION) {
    throw new Error(`CAM integration descriptor version must be ${CAM_INTEGRATION_DESCRIPTOR_VERSION}`)
  }
  const accountsValue = value.accounts
  if (!Array.isArray(accountsValue)) {
    throw new Error("descriptor.accounts must be an array")
  }
  if (accountsValue.length !== 1) {
    throw new Error("descriptor.accounts must contain exactly one address")
  }

  return {
    camIntegration: CAM_INTEGRATION_DESCRIPTOR_VERSION,
    chainId: requireEvmChainId(requiredString(value, "chainId", "descriptor.chainId")),
    rpcUrl: requireHttpURL(requiredString(value, "rpcUrl", "descriptor.rpcUrl"), "descriptor.rpcUrl").href,
    camHost: requireEvmAddress(requiredString(value, "camHost", "descriptor.camHost"), "descriptor.camHost"),
    resourceOrigin: requireHttpOrigin(
      requiredString(value, "resourceOrigin", "descriptor.resourceOrigin"),
      "descriptor.resourceOrigin",
    ),
    accounts: accountsValue.map((account, index) =>
      requireEvmAddress(requiredStringValue(account, `descriptor.accounts.${index}`), `descriptor.accounts.${index}`),
    ),
    allowUnsignedCamHash: requiredBoolean(value, "allowUnsignedCamHash", "descriptor.allowUnsignedCamHash"),
  }
}

function rejectUnknownDescriptorFields(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (!DESCRIPTOR_KEYS.has(key)) {
      throw new Error(`descriptor.${key}: field is not allowed in CAM integration descriptor`)
    }
  }
}

