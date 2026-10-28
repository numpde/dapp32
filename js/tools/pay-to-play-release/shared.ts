import type { Address, Hex } from "viem"
import { checkedReleaseChainId, parseJsonRecord, requireDistinctHexValues, requireExactKeys, requiredBytes32, requiredNonemptyString, requiredNonzeroAddress, requiredNonzeroBytes32, requiredSafeInteger, requiredSourceCommit, requiredTransactionHash } from "../release-values.ts"

export const DEPLOYMENT_SCHEMA = "pay-to-play.deployment.v2"

export type ContractSettings = {
  readonly intendedPaymentAdmin: Address
  readonly nullClaimPeriod: number
}

export type DeploymentArtifact = ContractSettings & {
  readonly sourceCommit: string
  readonly camURI: string
  readonly camHash: Hex
  readonly intendedCamRootOwner: Address
  readonly schema: typeof DEPLOYMENT_SCHEMA
  readonly chainId: number
  readonly deployer: Address
  readonly camRoot: Address
  readonly payToPlay: Address
  readonly payToPlayUI: Address
  readonly camRootCodeHash: Hex
  readonly payToPlayCodeHash: Hex
  readonly payToPlayUICodeHash: Hex
  readonly camRootCreationTransaction: Hex
  readonly payToPlayCreationTransaction: Hex
  readonly payToPlayCreationInputHash: Hex
  readonly payToPlayUICreationTransaction: Hex
  readonly payToPlayUICreationInputHash: Hex
}

const SETTINGS_KEYS = ["sourceCommit", "camURI", "camHash", "intendedCamRootOwner", "intendedPaymentAdmin", "nullClaimPeriod"] as const

export function checkedClaimPeriod(value: unknown): number {
  const period = requiredSafeInteger(value, "null-channel claim period")
  if (period < 0 || period > 2592000) throw new Error("null-channel claim period must be between 0 and 2592000 seconds")
  return period
}

export function parseDeploymentArtifact(bytes: Uint8Array): DeploymentArtifact {
  const value = parseJsonRecord(bytes, "PayToPlay deployment artifact")
  requireExactKeys(value, [
    "schema", "chainId", ...SETTINGS_KEYS, "deployer", "camRoot", "payToPlay", "payToPlayUI",
    "camRootCodeHash", "payToPlayCodeHash", "camRootCreationTransaction",
    "payToPlayCreationTransaction", "payToPlayCreationInputHash",
    "payToPlayUICodeHash", "payToPlayUICreationTransaction", "payToPlayUICreationInputHash",
  ], "PayToPlay deployment artifact")
  if (value.schema !== DEPLOYMENT_SCHEMA) throw new Error(`unsupported deployment artifact schema: ${String(value.schema)}`)
  const artifact: DeploymentArtifact = {
    sourceCommit: requiredSourceCommit(value.sourceCommit),
    camURI: requiredNonemptyString(value.camURI, "CAM URI"),
    camHash: requiredBytes32(value.camHash, "CAM hash"),
    intendedCamRootOwner: requiredNonzeroAddress(value.intendedCamRootOwner, "intended CAM root owner"),
    ...parseContractSettings(value), schema: DEPLOYMENT_SCHEMA,
    chainId: checkedReleaseChainId(requiredSafeInteger(value.chainId, "deployment chain ID")),
    deployer: requiredNonzeroAddress(value.deployer, "deployment deployer"),
    camRoot: requiredNonzeroAddress(value.camRoot, "CamRoot address"),
    payToPlay: requiredNonzeroAddress(value.payToPlay, "PayToPlay address"),
    payToPlayUI: requiredNonzeroAddress(value.payToPlayUI, "PayToPlayUI address"),
    camRootCodeHash: requiredNonzeroBytes32(value.camRootCodeHash, "CamRoot code hash"),
    payToPlayCodeHash: requiredNonzeroBytes32(value.payToPlayCodeHash, "PayToPlay code hash"),
    payToPlayUICodeHash: requiredNonzeroBytes32(value.payToPlayUICodeHash, "PayToPlayUI code hash"),
    camRootCreationTransaction: requiredTransactionHash(value.camRootCreationTransaction, "CamRoot creation transaction"),
    payToPlayCreationTransaction: requiredTransactionHash(value.payToPlayCreationTransaction, "PayToPlay creation transaction"),
    payToPlayCreationInputHash: requiredNonzeroBytes32(value.payToPlayCreationInputHash, "PayToPlay creation input hash"),
    payToPlayUICreationTransaction: requiredTransactionHash(value.payToPlayUICreationTransaction, "PayToPlayUI creation transaction"),
    payToPlayUICreationInputHash: requiredNonzeroBytes32(value.payToPlayUICreationInputHash, "PayToPlayUI creation input hash"),
  }
  requireDistinctHexValues([artifact.camRoot, artifact.payToPlay, artifact.payToPlayUI], "deployment contract addresses")
  requireDistinctHexValues([artifact.camRootCreationTransaction, artifact.payToPlayCreationTransaction, artifact.payToPlayUICreationTransaction], "deployment creation transactions")
  return artifact
}

export function parseContractSettings(value: Record<string, unknown>): ContractSettings {
  return {
    intendedPaymentAdmin: requiredNonzeroAddress(value.intendedPaymentAdmin, "intended payment admin"),
    nullClaimPeriod: checkedClaimPeriod(value.nullClaimPeriod),
  }
}
