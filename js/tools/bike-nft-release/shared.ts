import { requireEvmAddress } from "../../packages/cam-evm-viem/dist/index.js"
import type { CamHost } from "../../packages/cam-evm-viem/dist/index.js"
import { isRecordObject, parseJsonBytes } from "../../packages/cam-protocol/dist/index.js"

export { writeNewJson, writeNewText } from "../release-files.ts"

export const RELEASE_PLAN_SCHEMA = "bike-nft.release-plan.v1"
export const DEPLOYMENT_SCHEMA = "bike-nft.deployment.v1"
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

const PLAN_KEYS = [
  "schema", "sourceCommit", "expectedChainId", "camURI", "camHash", "camRootOwner",
  "tokenName", "tokenSymbol", "baseTokenURI", "collectionURI", "componentsAdmin",
  "componentsAdminDelay", "componentsPauser", "componentsConfigurer", "managerAdmin",
  "managerAdminDelay", "managerPauser", "managerConfigurer", "registrars",
] as const

const DEPLOYMENT_KEYS = [
  "schema", "sourceCommit", "chainId", "deployer", "camURI", "camHash", "camRootOwner",
  "tokenName", "tokenSymbol", "baseTokenURI", "collectionURI", "componentsAdmin",
  "componentsAdminDelay", "componentsPauser", "componentsConfigurer", "managerAdmin",
  "managerAdminDelay", "managerPauser", "managerConfigurer", "registrars", "camRoot",
  "components", "manager", "ui", "camRootCodeHash", "componentsCodeHash", "managerCodeHash",
  "uiCodeHash", "camRootCreationTransaction", "componentsCreationTransaction",
  "managerCreationTransaction", "uiCreationTransaction",
] as const

export type ReleaseAuthorities = {
  readonly camRootOwner: CamHost["address"]
  readonly componentsAdmin: CamHost["address"]
  readonly componentsAdminDelay: number
  readonly componentsPauser: CamHost["address"]
  readonly componentsConfigurer: CamHost["address"]
  readonly managerAdmin: CamHost["address"]
  readonly managerAdminDelay: number
  readonly managerPauser: CamHost["address"]
  readonly managerConfigurer: CamHost["address"]
  readonly registrars: readonly CamHost["address"][]
}

export type ReleasePlan = ReleaseAuthorities & {
  readonly schema: typeof RELEASE_PLAN_SCHEMA
  readonly sourceCommit: string
  readonly expectedChainId: number
  readonly camURI: string
  readonly camHash: `0x${string}`
  readonly tokenName: string
  readonly tokenSymbol: string
  readonly baseTokenURI: string
  readonly collectionURI: string
}

export type DeploymentArtifact = Omit<ReleasePlan, "schema" | "expectedChainId"> & {
  readonly schema: typeof DEPLOYMENT_SCHEMA
  readonly chainId: number
  readonly deployer: CamHost["address"]
  readonly camRoot: CamHost["address"]
  readonly components: CamHost["address"]
  readonly manager: CamHost["address"]
  readonly ui: CamHost["address"]
  readonly camRootCodeHash: `0x${string}`
  readonly componentsCodeHash: `0x${string}`
  readonly managerCodeHash: `0x${string}`
  readonly uiCodeHash: `0x${string}`
  readonly camRootCreationTransaction: `0x${string}`
  readonly componentsCreationTransaction: `0x${string}`
  readonly managerCreationTransaction: `0x${string}`
  readonly uiCreationTransaction: `0x${string}`
}

export function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.length === 0) throw new Error(`missing required environment variable: ${name}`)
  return value
}

export function requiredSourceCommit(value: string): string {
  if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("source commit must be exactly 40 lowercase hexadecimal characters")
  return value
}

export function requiredReleaseChainId(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) throw new Error("expected chain ID must be a positive decimal integer")
  return checkedReleaseChainId(Number(value))
}

export function checkedReleaseChainId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("expected chain ID must be a positive safe integer")
  if (value === 1337 || value === 31337) throw new Error(`release deployment rejects local fixture chain ID: ${value}`)
  return value
}

export function requiredDelay(value: unknown, label: string): number {
  const number = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(number) || Number(number) <= 0 || Number(number) > 281474976710655) {
    throw new Error(`${label} must be a positive uint48 decimal integer`)
  }
  return Number(number)
}

export function requiredNonzeroAddress(value: string, label: string): CamHost["address"] {
  const address = requireEvmAddress(value, label)
  if (address.toLowerCase() === ZERO_ADDRESS) throw new Error(`${label} must not be the zero address`)
  return address
}

export function requiredAddresses(value: unknown, label: string): readonly CamHost["address"][] {
  const values = typeof value === "string" ? value.split(",") : value
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must contain at least one address`)
  const addresses = values.map((item, index) => requiredNonzeroAddress(requiredString(item, `${label}[${index}]`), `${label}[${index}]`))
  if (new Set(addresses.map((address) => address.toLowerCase())).size !== addresses.length) {
    throw new Error(`${label} must not contain duplicate addresses`)
  }
  return addresses
}

export function requiredNonzeroBytes32(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value) || /^0x0{64}$/i.test(value)) {
    throw new Error(`${label} must be a nonzero 32-byte hexadecimal value`)
  }
  return value as `0x${string}`
}

export function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be a non-empty single-line string`)
  }
  return value
}

export function parseJsonRecord(bytes: Uint8Array, label: string): Record<string, unknown> {
  const value = parseJsonBytes(bytes)
  if (!isRecordObject(value)) throw new Error(`${label} must be an object`)
  return value
}

export function parseReleasePlan(bytes: Uint8Array): ReleasePlan {
  const value = parseJsonRecord(bytes, "release plan")
  requireExactKeys(value, PLAN_KEYS, "release plan")
  if (value.schema !== RELEASE_PLAN_SCHEMA) throw new Error(`unsupported release plan schema: ${String(value.schema)}`)
  return parsePlanFields(value)
}

export function parseDeploymentArtifact(bytes: Uint8Array): DeploymentArtifact {
  const value = parseJsonRecord(bytes, "deployment artifact")
  requireExactKeys(value, DEPLOYMENT_KEYS, "deployment artifact")
  if (value.schema !== DEPLOYMENT_SCHEMA) throw new Error(`unsupported deployment artifact schema: ${String(value.schema)}`)
  const artifact: DeploymentArtifact = {
    ...parseCommonFields(value),
    schema: DEPLOYMENT_SCHEMA,
    chainId: checkedReleaseChainId(requiredInteger(value.chainId, "deployment chainId")),
    deployer: requiredNonzeroAddress(requiredString(value.deployer, "deployment deployer"), "deployment deployer"),
    camRoot: addressField(value, "camRoot"), components: addressField(value, "components"),
    manager: addressField(value, "manager"), ui: addressField(value, "ui"),
    camRootCodeHash: requiredNonzeroBytes32(value.camRootCodeHash, "deployment camRootCodeHash"),
    componentsCodeHash: requiredNonzeroBytes32(value.componentsCodeHash, "deployment componentsCodeHash"),
    managerCodeHash: requiredNonzeroBytes32(value.managerCodeHash, "deployment managerCodeHash"),
    uiCodeHash: requiredNonzeroBytes32(value.uiCodeHash, "deployment uiCodeHash"),
    camRootCreationTransaction: requiredNonzeroBytes32(value.camRootCreationTransaction, "deployment camRootCreationTransaction"),
    componentsCreationTransaction: requiredNonzeroBytes32(value.componentsCreationTransaction, "deployment componentsCreationTransaction"),
    managerCreationTransaction: requiredNonzeroBytes32(value.managerCreationTransaction, "deployment managerCreationTransaction"),
    uiCreationTransaction: requiredNonzeroBytes32(value.uiCreationTransaction, "deployment uiCreationTransaction"),
  }
  const transactions = [artifact.camRootCreationTransaction, artifact.componentsCreationTransaction, artifact.managerCreationTransaction, artifact.uiCreationTransaction]
  if (new Set(transactions.map((hash) => hash.toLowerCase())).size !== transactions.length) throw new Error("deployment creation transaction hashes must be distinct")
  rejectDeployerAuthorities(artifact)
  return artifact
}

function parsePlanFields(value: Record<string, unknown>): ReleasePlan {
  return {
    ...parseCommonFields(value),
    schema: RELEASE_PLAN_SCHEMA,
    expectedChainId: checkedReleaseChainId(requiredInteger(value.expectedChainId, "release plan expectedChainId")),
  }
}

function parseCommonFields(value: Record<string, unknown>): Omit<ReleasePlan, "schema" | "expectedChainId"> {
  return {
    sourceCommit: requiredSourceCommit(requiredString(value.sourceCommit, "sourceCommit")),
    camURI: requiredString(value.camURI, "camURI"),
    camHash: requiredNonzeroBytes32(value.camHash, "camHash"),
    camRootOwner: addressField(value, "camRootOwner"),
    tokenName: requiredString(value.tokenName, "tokenName"), tokenSymbol: requiredString(value.tokenSymbol, "tokenSymbol"),
    baseTokenURI: requiredString(value.baseTokenURI, "baseTokenURI"), collectionURI: requiredString(value.collectionURI, "collectionURI"),
    componentsAdmin: addressField(value, "componentsAdmin"), componentsAdminDelay: requiredDelay(value.componentsAdminDelay, "componentsAdminDelay"),
    componentsPauser: addressField(value, "componentsPauser"), componentsConfigurer: addressField(value, "componentsConfigurer"),
    managerAdmin: addressField(value, "managerAdmin"), managerAdminDelay: requiredDelay(value.managerAdminDelay, "managerAdminDelay"),
    managerPauser: addressField(value, "managerPauser"), managerConfigurer: addressField(value, "managerConfigurer"),
    registrars: requiredAddresses(value.registrars, "registrars"),
  }
}

export function releasePlanArguments(plan: ReleasePlan): string { return lines(PLAN_KEYS.map((key) => scalar(plan[key]))) }
export function deploymentArguments(artifact: DeploymentArtifact): string { return lines(DEPLOYMENT_KEYS.map((key) => scalar(artifact[key]))) }

export function rejectDeployerAuthorities(value: Pick<DeploymentArtifact, "deployer"> & ReleaseAuthorities): void {
  const deployer = value.deployer.toLowerCase()
  const authorities = [value.camRootOwner, value.componentsAdmin, value.componentsPauser, value.componentsConfigurer, value.managerAdmin, value.managerPauser, value.managerConfigurer, ...value.registrars]
  if (authorities.some((address) => address.toLowerCase() === deployer)) throw new Error("deployment deployer must not retain a final or operational authority")
}

function addressField(value: Record<string, unknown>, key: string): CamHost["address"] { return requiredNonzeroAddress(requiredString(value[key], key), key) }
function requiredInteger(value: unknown, label: string): number { if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`); return Number(value) }
function scalar(value: unknown): string { return Array.isArray(value) ? value.join(",") : String(value) }
function lines(values: readonly string[]): string { for (const value of values) if (/[\r\n]/.test(value)) throw new Error("companion fields must be single-line values"); return `${values.join("\n")}\n` }
function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value); const missing = expected.filter((key) => !actual.includes(key)); const unexpected = actual.filter((key) => !expected.includes(key))
  if (missing.length > 0 || unexpected.length > 0) throw new Error(`${label} fields mismatch: missing=[${missing.join(",")}] unexpected=[${unexpected.join(",")}]`)
}
