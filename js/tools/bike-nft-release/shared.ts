import type { CamHost } from "../../packages/cam-evm-viem/dist/index.js"
import {
  checkedReleaseChainId,
  parseJsonRecord,
  requireDistinctHexValues,
  requireExactKeys,
  requiredNonzeroAddress,
  requiredNonzeroBytes32,
  requiredSafeInteger,
  requiredSingleLineString,
  requiredSourceCommit,
  requiredTransactionHash,
} from "../release-values.ts"

export const RELEASE_PLAN_SCHEMA = "bike-nft.release-plan.v1"
export const DEPLOYMENT_SCHEMA = "bike-nft.deployment.v1"

const PLAN_KEYS = [
  "schema", "sourceCommit", "expectedChainId", "camURI", "camHash", "intendedCamRootOwner",
  "tokenName", "tokenSymbol", "baseTokenURI", "collectionURI", "intendedComponentsAdmin",
  "componentsAdminDelay", "componentsPauser", "componentsConfigurer", "intendedManagerAdmin",
  "managerAdminDelay", "managerPauser", "managerConfigurer", "registrars",
] as const

const DEPLOYMENT_KEYS = [
  "schema", "sourceCommit", "chainId", "deployer", "camURI", "camHash", "intendedCamRootOwner",
  "tokenName", "tokenSymbol", "baseTokenURI", "collectionURI", "intendedComponentsAdmin",
  "componentsAdminDelay", "componentsPauser", "componentsConfigurer", "intendedManagerAdmin",
  "managerAdminDelay", "managerPauser", "managerConfigurer", "registrars", "camRoot",
  "components", "manager", "ui", "camRootCodeHash", "componentsCodeHash", "managerCodeHash",
  "uiCodeHash", "camRootCreationTransaction", "componentsCreationTransaction",
  "managerCreationTransaction", "uiCreationTransaction",
] as const

export type ReleaseAuthorities = {
  readonly intendedCamRootOwner: CamHost["address"]
  readonly intendedComponentsAdmin: CamHost["address"]
  readonly componentsAdminDelay: number
  readonly componentsPauser: CamHost["address"]
  readonly componentsConfigurer: CamHost["address"]
  readonly intendedManagerAdmin: CamHost["address"]
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

export function requiredDelay(value: unknown, label: string): number {
  const number = typeof value === "string" && /^[1-9][0-9]*$/.test(value) ? Number(value) : value
  if (!Number.isSafeInteger(number) || Number(number) <= 0 || Number(number) > 281474976710655) {
    throw new Error(`${label} must be a positive uint48 decimal integer`)
  }
  return Number(number)
}

export function requiredAddresses(value: unknown, label: string): readonly CamHost["address"][] {
  const values = typeof value === "string" ? value.split(",") : value
  if (!Array.isArray(values) || values.length === 0) throw new Error(`${label} must contain at least one address`)
  const addresses = values.map((item, index) => requiredNonzeroAddress(item, `${label}[${index}]`))
  requireDistinctHexValues(addresses, label)
  return addresses
}

export function parseReleasePlan(bytes: Uint8Array): ReleasePlan {
  const value = parseJsonRecord(bytes, "release plan")
  requireExactKeys(value, PLAN_KEYS, "Bike release plan")
  if (value.schema !== RELEASE_PLAN_SCHEMA) throw new Error(`unsupported release plan schema: ${String(value.schema)}`)
  return parsePlanFields(value)
}

export function parseDeploymentArtifact(bytes: Uint8Array): DeploymentArtifact {
  const value = parseJsonRecord(bytes, "deployment artifact")
  requireExactKeys(value, DEPLOYMENT_KEYS, "Bike deployment artifact")
  if (value.schema !== DEPLOYMENT_SCHEMA) throw new Error(`unsupported deployment artifact schema: ${String(value.schema)}`)
  const artifact: DeploymentArtifact = {
    ...parseCommonFields(value),
    schema: DEPLOYMENT_SCHEMA,
    chainId: checkedReleaseChainId(requiredSafeInteger(value.chainId, "deployment chainId")),
    deployer: requiredNonzeroAddress(value.deployer, "deployment deployer"),
    camRoot: addressField(value, "camRoot"), components: addressField(value, "components"),
    manager: addressField(value, "manager"), ui: addressField(value, "ui"),
    camRootCodeHash: requiredNonzeroBytes32(value.camRootCodeHash, "deployment camRootCodeHash"),
    componentsCodeHash: requiredNonzeroBytes32(value.componentsCodeHash, "deployment componentsCodeHash"),
    managerCodeHash: requiredNonzeroBytes32(value.managerCodeHash, "deployment managerCodeHash"),
    uiCodeHash: requiredNonzeroBytes32(value.uiCodeHash, "deployment uiCodeHash"),
    camRootCreationTransaction: requiredTransactionHash(value.camRootCreationTransaction, "deployment camRootCreationTransaction"),
    componentsCreationTransaction: requiredTransactionHash(value.componentsCreationTransaction, "deployment componentsCreationTransaction"),
    managerCreationTransaction: requiredTransactionHash(value.managerCreationTransaction, "deployment managerCreationTransaction"),
    uiCreationTransaction: requiredTransactionHash(value.uiCreationTransaction, "deployment uiCreationTransaction"),
  }
  const transactions = [artifact.camRootCreationTransaction, artifact.componentsCreationTransaction, artifact.managerCreationTransaction, artifact.uiCreationTransaction]
  requireDistinctHexValues(transactions, "deployment creation transaction hashes")
  rejectDeployerAuthorities(artifact)
  return artifact
}

function parsePlanFields(value: Record<string, unknown>): ReleasePlan {
  return {
    ...parseCommonFields(value),
    schema: RELEASE_PLAN_SCHEMA,
    expectedChainId: checkedReleaseChainId(requiredSafeInteger(value.expectedChainId, "release plan expectedChainId")),
  }
}

function parseCommonFields(value: Record<string, unknown>): Omit<ReleasePlan, "schema" | "expectedChainId"> {
  return {
    sourceCommit: requiredSourceCommit(value.sourceCommit),
    camURI: requiredSingleLineString(value.camURI, "camURI"),
    camHash: requiredNonzeroBytes32(value.camHash, "camHash"),
    intendedCamRootOwner: addressField(value, "intendedCamRootOwner"),
    tokenName: requiredSingleLineString(value.tokenName, "tokenName"), tokenSymbol: requiredSingleLineString(value.tokenSymbol, "tokenSymbol"),
    baseTokenURI: requiredSingleLineString(value.baseTokenURI, "baseTokenURI"), collectionURI: requiredSingleLineString(value.collectionURI, "collectionURI"),
    intendedComponentsAdmin: addressField(value, "intendedComponentsAdmin"), componentsAdminDelay: requiredDelay(value.componentsAdminDelay, "componentsAdminDelay"),
    componentsPauser: addressField(value, "componentsPauser"), componentsConfigurer: addressField(value, "componentsConfigurer"),
    intendedManagerAdmin: addressField(value, "intendedManagerAdmin"), managerAdminDelay: requiredDelay(value.managerAdminDelay, "managerAdminDelay"),
    managerPauser: addressField(value, "managerPauser"), managerConfigurer: addressField(value, "managerConfigurer"),
    registrars: requiredAddresses(value.registrars, "registrars"),
  }
}

export function rejectDeployerAuthorities(value: Pick<DeploymentArtifact, "deployer"> & ReleaseAuthorities): void {
  const deployer = value.deployer.toLowerCase()
  const authorities = [value.intendedCamRootOwner, value.intendedComponentsAdmin, value.componentsPauser, value.componentsConfigurer, value.intendedManagerAdmin, value.managerPauser, value.managerConfigurer, ...value.registrars]
  if (authorities.some((address) => address.toLowerCase() === deployer)) throw new Error("deployment deployer must not retain a final or operational authority")
}

function addressField(value: Record<string, unknown>, key: string): CamHost["address"] { return requiredNonzeroAddress(value[key], key) }
