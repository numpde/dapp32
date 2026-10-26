import { createHash } from "node:crypto"
import { getAddress, zeroAddress, type Abi, type Hex } from "viem"
import type { ReleaseReference, ExpectedStep } from "./reference.ts"
import { parseStrictJson } from "./strict-json.ts"
import type { UIBackingReference } from "../ui-release/shared.ts"

export type ReleaseApp = "escrow" | "bike-nft" | "pay-to-play"

type ContractLocation = { readonly source: string; readonly contract: string }

export const ARTIFACTS: Record<ReleaseApp, Record<string, ContractLocation>> = {
  escrow: {
    camRoot: { source: "cam/src/CamRoot.sol", contract: "CamRoot" },
    escrow: { source: "escrow/src/CamEscrow.sol", contract: "CamEscrow" },
    ui: { source: "escrow/src/CamEscrowUI.sol", contract: "CamEscrowUI" },
  },
  "bike-nft": {
    camRoot: { source: "cam/src/CamRoot.sol", contract: "CamRoot" },
    components: { source: "bike-nft/src/BicycleComponents.sol", contract: "BicycleComponents" },
    manager: { source: "bike-nft/src/BicycleComponentManager.sol", contract: "BicycleComponentManager" },
    ui: { source: "bike-nft/src/BicycleComponentManagerUI.sol", contract: "BicycleComponentManagerUI" },
  },
  "pay-to-play": {
    camRoot: { source: "cam/src/CamRoot.sol", contract: "CamRoot" },
    payments: { source: "pay-to-play/src/PayToPlay.sol", contract: "PayToPlay" },
    ui: { source: "pay-to-play/src/PayToPlayUI.sol", contract: "PayToPlayUI" },
  },
}

export type CompiledContractReference = {
  readonly role: string
  readonly name: string
  readonly source: string
  readonly compilerVersion: string
  readonly compilerMetadataSha256: Hex
  readonly artifactSha256: Hex
  readonly creationBytecode: Hex
  readonly abi: Abi
}

type ReferenceSnapshotBase = ReleaseReference & {
  readonly app: ReleaseApp
  readonly planSha256: Hex
  readonly contracts: readonly CompiledContractReference[]
  readonly snapshotSha256: Hex
}

export type ReferenceSnapshot = ReferenceSnapshotBase & (
  { readonly schema: "release-approval.reference.v2" | "release-approval.contract-reference.v1" }
  | { readonly schema: "release-approval.ui-reference.v1"; readonly backing: UIBackingReference }
)

export function businessContractRoles(app: ReleaseApp): readonly string[] {
  return Object.keys(ARTIFACTS[app]).filter(role => role !== "camRoot" && role !== "ui")
}

export const COMPILER_VERSION = "0.8.35+commit.47b9dedd"
export function sha256(bytes: Uint8Array | string): Hex {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`
}

export function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

export function readAbi(value: unknown, label: string): Abi {
  if (!Array.isArray(value) || value.length > 256 || !value.every((entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry))) {
    throw new Error(`${label} ABI must be a bounded array of items`)
  }
  return value as Abi
}

function inputTypes(item: Record<string, unknown>): string[] | null {
  if (!Array.isArray(item.inputs)) return null
  const types: string[] = []
  for (const input of item.inputs) {
    if (input === null || typeof input !== "object" || typeof (input as Record<string, unknown>).type !== "string") return null
    types.push((input as { type: string }).type)
  }
  return types
}

export function assertAbiMatchesSteps(role: string, abi: Abi, steps: readonly ExpectedStep[]): void {
  const items = abi as readonly Record<string, unknown>[]
  for (const step of steps.filter((candidate) => candidate.role === role)) {
    if (step.kind === "create") {
      const constructors = items.filter((item) => item.type === "constructor")
      const actual = constructors.length === 0 ? [] : constructors.length === 1 ? inputTypes(constructors[0]!) : null
      if (actual === null || JSON.stringify(actual) !== JSON.stringify(step.constructorTypes)) {
        throw new Error(`${role} ABI constructor does not match ${step.name}`)
      }
    } else {
      const functions = items.filter((item) => item.type === "function" && item.name === step.name)
      if (!functions.some((item) => {
        const inputs = inputTypes(item)
        return inputs !== null && `${item.name}(${inputs.join(",")})` === step.signature
      })) {
        throw new Error(`${role} ABI does not declare ${step.signature}`)
      }
    }
  }
}

function parseJsonRecord(bytes: Uint8Array, label: string): Record<string, unknown> {
  return record(parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), "safe-integers"), label)
}

function requireExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value)
  const names = new Set(expected)
  const missing = expected.filter(key => !Object.prototype.hasOwnProperty.call(value, key))
  const unexpected = actual.filter(key => !names.has(key))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(`${label} fields disagree: missing=[${missing.join(",")}] unexpected=[${unexpected.join(",")}]`)
  }
}

function requiredSourceCommit(value: unknown): void {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("source commit must be exactly 40 lowercase hexadecimal characters")
  }
}

function requiredNonzeroAddress(value: unknown, label: string): void {
  if (typeof value !== "string") throw new Error(`${label}: expected 20-byte hex address`)
  const address = getAddress(value)
  if (address === zeroAddress) throw new Error(`${label} must not be the zero address`)
}

function bytes32(value: unknown, label: string): void {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${label} must be 32 hex bytes`)
}

function snapshotAbi(value: unknown, role: string): Abi {
  const abi = readAbi(value, role)
  const functions = new Set<string>()
  let constructors = 0
  for (const item of abi as readonly Record<string, unknown>[]) {
    if (item.type === "constructor") {
      constructors += 1
      if (constructors > 1 || inputTypes(item) === null) throw new Error(`${role} ABI has duplicate or malformed constructor`)
    } else if (item.type === "function") {
      if (typeof item.name !== "string" || item.name.length === 0 || item.name.length > 128) throw new Error(`${role} ABI has malformed function name`)
      const inputs = inputTypes(item)
      if (inputs === null) throw new Error(`${role} ABI function ${item.name} has malformed inputs`)
      const signature = `${item.name}(${inputs.join(",")})`
      if (functions.has(signature)) throw new Error(`${role} duplicate ABI function: ${signature}`)
      functions.add(signature)
    } else if (item.type !== "event" && item.type !== "error" && item.type !== "fallback" && item.type !== "receive") {
      throw new Error(`${role} ABI has unknown item type`)
    }
  }
  return abi
}

function snapshotContracts(value: unknown, app: ReleaseApp, inventory: readonly string[] = Object.keys(ARTIFACTS[app])): readonly CompiledContractReference[] {
  if (!Array.isArray(value) || value.length !== inventory.length) throw new Error("reference compiler contract inventory is incomplete")
  const roles = new Set<string>()
  for (const item of value) {
    const contract = record(item, "compiler contract")
    requireExactKeys(contract, ["role", "name", "source", "compilerVersion", "compilerMetadataSha256", "artifactSha256", "creationBytecode", "abi"], "compiler contract")
    if (typeof contract.role !== "string") throw new Error("compiler contract role must be text")
    if (roles.has(contract.role)) throw new Error(`duplicate compiler contract role: ${contract.role}`)
    roles.add(contract.role)
    const location = ARTIFACTS[app][contract.role]
    if (!inventory.includes(contract.role) || !location || contract.name !== location.contract || contract.source !== location.source) throw new Error(`compiler contract ${contract.role} differs from ${app} release inventory`)
    if (contract.compilerVersion !== COMPILER_VERSION) throw new Error(`${contract.role} compiler version differs from pinned release build`)
    bytes32(contract.compilerMetadataSha256, `${contract.role} metadata digest`)
    bytes32(contract.artifactSha256, `${contract.role} artifact digest`)
    if (typeof contract.creationBytecode !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(contract.creationBytecode) || contract.creationBytecode.length > 2 + 2 * 128 * 1024) {
      throw new Error(`${contract.role} creation bytecode must be bounded hex bytes`)
    }
    snapshotAbi(contract.abi, contract.role)
  }
  return value as readonly CompiledContractReference[]
}

const PRESENTATION_CONTROLS = /[\p{C}\p{Zl}\p{Zp}]/u

function snapshotSteps(value: unknown, contracts: readonly CompiledContractReference[]): readonly ExpectedStep[] {
  if (!Array.isArray(value) || value.length < contracts.length || value.length > 64) throw new Error("invalid reference step inventory")
  const byRole = new Map(contracts.map((contract) => [contract.role, contract]))
  const created = new Set<string>()
  const steps: ExpectedStep[] = []
  for (const [index, item] of value.entries()) {
    const step = record(item, `reference step ${index + 1}`)
    if (step.kind === "create") {
      requireExactKeys(step, ["kind", "role", "name", "action", "argumentLabels", "constructorTypes", "args"], `reference creation step ${index + 1}`)
    } else if (step.kind === "call") {
      if (typeof step.signature !== "string") throw new Error(`reference call signature is missing at step ${index + 1}`)
      requireExactKeys(step, ["kind", "role", "name", "action", "argumentLabels", "signature", "args"], `reference call step ${index + 1}`)
    } else {
      throw new Error(`reference step ${index + 1} has unknown kind`)
    }
    if (typeof step.role !== "string" || !byRole.has(step.role)) throw new Error(`reference step ${index + 1} has unknown contract role`)
    if (typeof step.name !== "string" || step.name.length === 0 || step.name.length > 128) throw new Error(`reference step ${index + 1} has invalid name`)
    if (!Array.isArray(step.args) || step.args.length > 16) throw new Error(`reference step ${index + 1} has invalid arguments`)
    if (typeof step.action !== "string" || step.action.length === 0 || step.action.length > 256 || PRESENTATION_CONTROLS.test(step.action)) {
      throw new Error(`reference step ${index + 1} action must be a printable single line of at most 256 characters`)
    }
    if (!Array.isArray(step.argumentLabels) || step.argumentLabels.length !== step.args.length || step.argumentLabels.some(label =>
      typeof label !== "string" || label.length === 0 || label.length > 128 || PRESENTATION_CONTROLS.test(label))) {
      throw new Error(`reference step ${index + 1} argument labels must match its arguments and be printable single lines of at most 128 characters`)
    }
    for (const arg of step.args) {
      if (typeof arg === "string") {
        if (arg.length > 4096) throw new Error(`reference step ${index + 1} has oversized argument`)
      } else {
        const reference = record(arg, `reference step ${index + 1} role argument`)
        requireExactKeys(reference, ["createdContract"], `reference step ${index + 1} role argument`)
        if (typeof reference.createdContract !== "string" || !created.has(reference.createdContract)) {
          throw new Error(`reference step ${index + 1} has unknown or future created contract role`)
        }
      }
    }
    if (step.kind === "create") {
      if (created.has(step.role)) throw new Error(`duplicate reference creation role: ${step.role}`)
      if (step.name !== byRole.get(step.role)!.name) throw new Error(`reference creation name differs from compiler contract ${step.role}`)
      if (!Array.isArray(step.constructorTypes) || step.constructorTypes.length !== step.args.length || step.constructorTypes.some((type) => typeof type !== "string" || type.length > 64)) {
        throw new Error(`reference creation step ${index + 1} has invalid constructor types`)
      }
      created.add(step.role)
    } else {
      if (!created.has(step.role)) throw new Error(`reference call targets an uncreated role: ${step.role}`)
      if (typeof step.signature !== "string" || step.signature.length > 256 || !step.signature.startsWith(`${step.name}(`) || !step.signature.endsWith(")")) {
        throw new Error(`reference call signature is missing or invalid at step ${index + 1}`)
      }
    }
    steps.push(step as ExpectedStep)
  }
  if (created.size !== contracts.length) throw new Error("reference omits a compiler contract creation")
  for (const contract of contracts) assertAbiMatchesSteps(contract.role, contract.abi, steps)
  return steps
}

export function parseReferenceSnapshot(bytes: Uint8Array): ReferenceSnapshot {
  if (bytes.byteLength > 1024 * 1024) throw new Error("release approval reference exceeds 1048576 bytes")
  const value = parseJsonRecord(bytes, "release approval reference")
  const uiOnly = value.schema === "release-approval.ui-reference.v1"
  const businessOnly = value.schema === "release-approval.contract-reference.v1"
  requireExactKeys(value, ["schema", "app", "sourceCommit", "expectedChainId", "expectedDeployer", "planSha256", "steps", "contracts", "snapshotSha256", ...(uiOnly ? ["backing"] : [])], "release approval reference")
  if (!uiOnly && !businessOnly && value.schema !== "release-approval.reference.v2") throw new Error("unsupported release approval reference schema")
  if (value.app !== "escrow" && value.app !== "bike-nft" && value.app !== "pay-to-play") throw new Error("unknown release approval app")
  if (typeof value.snapshotSha256 !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.snapshotSha256)) throw new Error("invalid reference snapshot digest")
  const { snapshotSha256, ...base } = value
  if (sha256(JSON.stringify(base)) !== snapshotSha256) throw new Error("reference snapshot digest mismatch")
  requiredSourceCommit(value.sourceCommit)
  requiredNonzeroAddress(value.expectedDeployer, "reference expected deployer")
  if (!Number.isSafeInteger(value.expectedChainId) || Number(value.expectedChainId) <= 0) throw new Error("invalid reference chain ID")
  bytes32(value.planSha256, "reference plan digest")
  const contracts = snapshotContracts(value.contracts, value.app, uiOnly ? ["ui"] : businessOnly ? businessContractRoles(value.app) : undefined)
  const steps = snapshotSteps(value.steps, contracts)
  if (uiOnly) {
    const backing = record(value.backing, "UI backing deployment")
    requireExactKeys(backing, ["sourceCommit", "chainId", "creator", "artifactSha256", "address", "codeHash", "creationTransaction", "creationInputHash"], "UI backing deployment")
    requiredSourceCommit(backing.sourceCommit)
    requiredNonzeroAddress(backing.address, "UI backing address")
    requiredNonzeroAddress(backing.creator, "UI backing creator")
    for (const field of ["artifactSha256", "codeHash", "creationTransaction", "creationInputHash"] as const) bytes32(backing[field], `UI backing ${field}`)
    if (backing.chainId !== value.expectedChainId) throw new Error("UI backing chain differs from the selected UI chain")
    if (steps.length !== 1 || steps[0]!.kind !== "create" || steps[0]!.role !== "ui"
        || JSON.stringify(steps[0]!.constructorTypes) !== '["address"]'
        || typeof steps[0]!.args[0] !== "string" || steps[0]!.args.length !== 1
        || getAddress(steps[0]!.args[0]) !== getAddress(backing.address as string)) {
      throw new Error("UI approval must create only the selected UI with its declared backing contract")
    }
  }
  return value as ReferenceSnapshot
}
