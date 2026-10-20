import { createHash } from "node:crypto"
import { lstat, realpath } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { keccak256, toHex, type Abi, type Hex } from "viem"

import { bikeReference } from "../bike-nft-release/reference.ts"
import { escrowReference } from "../escrow-release/reference.ts"
import { payToPlayReference } from "../pay-to-play-release/reference.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import { parseJsonRecord, requireExactKeys, requiredNonzeroAddress, requiredSourceCommit } from "../release-values.ts"
import type { ReleaseReference, ExpectedStep } from "./reference.ts"

export type ReleaseApp = "escrow" | "bike-nft" | "pay-to-play"

type ContractLocation = { readonly source: string; readonly contract: string }

const ARTIFACTS: Record<ReleaseApp, Record<string, ContractLocation>> = {
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

export type ReferenceSnapshot = ReleaseReference & {
  readonly schema: "release-approval.reference.v1"
  readonly app: ReleaseApp
  readonly planSha256: Hex
  readonly contracts: readonly CompiledContractReference[]
  readonly snapshotSha256: Hex
}

const COMPILER_VERSION = "0.8.35+commit.47b9dedd"
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
const MAX_SOURCE_BYTES = 1024 * 1024

function sha256(bytes: Uint8Array | string): Hex {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function sourcePath(value: string): string {
  if (!/^[a-zA-Z0-9_@./-]+$/.test(value) || value.startsWith("/") || value.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`compiler source path is unsafe: ${value}`)
  }
  if (!/^(?:cam|escrow|bike-nft|pay-to-play|dependencies)\//.test(value)) {
    throw new Error(`compiler source path is outside release sources: ${value}`)
  }
  return value
}

async function checkedSourceBytes(sourceRoot: string, relative: string): Promise<Uint8Array> {
  const root = await realpath(sourceRoot)
  const path = await realpath(resolve(root, sourcePath(relative)))
  if (!path.startsWith(`${root}${sep}`)) throw new Error(`compiler source resolves outside release sources: ${relative}`)
  return readBoundedRegularFile(path, `compiler source ${relative}`, MAX_SOURCE_BYTES)
}

function readAbi(value: unknown, label: string): Abi {
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

function assertAbiMatchesSteps(role: string, abi: Abi, steps: readonly ExpectedStep[]): void {
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

async function checkedArtifactBytes(artifactsRoot: string, contract: string): Promise<Uint8Array> {
  const rootStat = await lstat(artifactsRoot)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("compiler artifact root must be a real directory without a symlink")
  const root = await realpath(artifactsRoot)
  const directory = resolve(root, `${contract}.sol`)
  const directoryStat = await lstat(directory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error(`${contract} compiler artifact directory must be a real directory without a symlink`)
  if (await realpath(directory) !== directory) throw new Error(`${contract} compiler artifact directory resolves outside its selected path`)
  const path = resolve(directory, `${contract}.json`)
  if (await realpath(path) !== path) throw new Error(`${contract} compiler artifact file resolves outside its selected path`)
  return readBoundedRegularFile(path, `${contract} compiler artifact`, MAX_ARTIFACT_BYTES)
}

async function compiledContract(
  app: ReleaseApp,
  step: ExpectedStep,
  steps: readonly ExpectedStep[],
  artifactsRoot: string,
  sourcesRoot: string,
): Promise<CompiledContractReference> {
  const location = ARTIFACTS[app][step.role]
  if (!location || location.contract !== step.name) throw new Error(`no compiler artifact declared for ${app} ${step.role}:${step.name}`)
  const artifactBytes = await checkedArtifactBytes(artifactsRoot, location.contract)
  const artifact = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(artifactBytes)), `${step.name} compiler artifact`)
  const bytecode = record(artifact.bytecode, `${step.name} bytecode`)
  const links = record(bytecode.linkReferences, `${step.name} link references`)
  if (Object.keys(links).length !== 0) throw new Error(`${step.name} creation bytecode has unresolved link references`)
  if (typeof bytecode.object !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode.object) || bytecode.object.length > 2 + 2 * 128 * 1024) {
    throw new Error(`${step.name} creation bytecode must be bounded, linked hex bytes`)
  }

  const abi = readAbi(artifact.abi, step.name)
  assertAbiMatchesSteps(step.role, abi, steps)
  const metadata = record(artifact.metadata, `${step.name} metadata`)
  const compiler = record(metadata.compiler, `${step.name} compiler`)
  if (compiler.version !== COMPILER_VERSION) throw new Error(`${step.name} compiler version differs from pinned ${COMPILER_VERSION}`)
  const settings = record(metadata.settings, `${step.name} compiler settings`)
  const target = record(settings.compilationTarget, `${step.name} compilation target`)
  if (Object.keys(target).length !== 1 || target[location.source] !== location.contract) throw new Error(`${step.name} compilation target mismatch`)
  const optimizer = record(settings.optimizer, `${step.name} optimizer`)
  if (optimizer.enabled !== true || optimizer.runs !== 200 || settings.evmVersion !== "prague") throw new Error(`${step.name} compiler settings differ from pinned release build`)
  const sources = record(metadata.sources, `${step.name} compiler sources`)
  if (Object.keys(sources).length === 0 || Object.keys(sources).length > 200 || !(location.source in sources)) throw new Error(`${step.name} compiler sources are incomplete or excessive`)
  for (const [relative, entry] of Object.entries(sources)) {
    const hash = record(entry, `${step.name} compiler source ${relative}`).keccak256
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`${step.name} compiler source hash is invalid: ${relative}`)
    const actual = keccak256(toHex(await checkedSourceBytes(sourcesRoot, relative)))
    if (actual.toLowerCase() !== hash.toLowerCase()) throw new Error(`${step.name} source hash mismatch: ${relative}`)
  }

  return {
    role: step.role, name: step.name, source: location.source,
    compilerVersion: COMPILER_VERSION,
    compilerMetadataSha256: sha256(JSON.stringify(metadata)),
    artifactSha256: sha256(artifactBytes),
    creationBytecode: bytecode.object as Hex,
    abi,
  }
}

export function releaseReferenceFromPlan(app: ReleaseApp, planBytes: Uint8Array, deployer: string): ReleaseReference {
  if (app === "escrow") return escrowReference(planBytes, deployer)
  if (app === "bike-nft") return bikeReference(planBytes, deployer)
  return payToPlayReference(planBytes, deployer)
}

export async function prepareReferenceSnapshot(
  app: ReleaseApp,
  expected: ReleaseReference,
  planBytes: Uint8Array,
  artifactsRoot: string,
  sourcesRoot: string,
): Promise<ReferenceSnapshot> {
  if (planBytes.byteLength > 64 * 1024) throw new Error("release plan exceeds 65536 bytes")
  const fromPlan = releaseReferenceFromPlan(app, planBytes, expected.expectedDeployer)
  if (JSON.stringify(fromPlan) !== JSON.stringify(expected)) throw new Error("reference steps or identity differ from the validated release plan")
  const creates = expected.steps.filter((step) => step.kind === "create")
  if (creates.length !== Object.keys(ARTIFACTS[app]).length) throw new Error(`${app} reference has an incomplete creation inventory`)
  const contracts: CompiledContractReference[] = []
  for (const step of creates) contracts.push(await compiledContract(app, step, expected.steps, artifactsRoot, sourcesRoot))
  // The launcher must bind the mounted source archive to this plan's commit.
  const base = {
    schema: "release-approval.reference.v1" as const,
    app, sourceCommit: expected.sourceCommit, expectedChainId: expected.expectedChainId,
    expectedDeployer: expected.expectedDeployer, planSha256: sha256(planBytes),
    steps: expected.steps, contracts,
  }
  return { ...base, snapshotSha256: sha256(JSON.stringify(base)) }
}

export async function writeReferenceSnapshot(path: string, snapshot: ReferenceSnapshot): Promise<void> {
  await writeNewJson(path, snapshot, "release approval reference")
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

function snapshotContracts(value: unknown, app: ReleaseApp): readonly CompiledContractReference[] {
  if (!Array.isArray(value) || value.length !== Object.keys(ARTIFACTS[app]).length) throw new Error("reference compiler contract inventory is incomplete")
  const roles = new Set<string>()
  for (const item of value) {
    const contract = record(item, "compiler contract")
    requireExactKeys(contract, ["role", "name", "source", "compilerVersion", "compilerMetadataSha256", "artifactSha256", "creationBytecode", "abi"], "compiler contract")
    if (typeof contract.role !== "string") throw new Error("compiler contract role must be text")
    if (roles.has(contract.role)) throw new Error(`duplicate compiler contract role: ${contract.role}`)
    roles.add(contract.role)
    const location = ARTIFACTS[app][contract.role]
    if (!location || contract.name !== location.contract || contract.source !== location.source) throw new Error(`compiler contract ${contract.role} differs from ${app} release inventory`)
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

function snapshotSteps(value: unknown, contracts: readonly CompiledContractReference[]): readonly ExpectedStep[] {
  if (!Array.isArray(value) || value.length < contracts.length || value.length > 64) throw new Error("invalid reference step inventory")
  const byRole = new Map(contracts.map((contract) => [contract.role, contract]))
  const created = new Set<string>()
  const steps: ExpectedStep[] = []
  for (const [index, item] of value.entries()) {
    const step = record(item, `reference step ${index + 1}`)
    if (step.kind === "create") {
      requireExactKeys(step, ["kind", "role", "name", "constructorTypes", "args"], `reference creation step ${index + 1}`)
    } else if (step.kind === "call") {
      if (typeof step.signature !== "string") throw new Error(`reference call signature is missing at step ${index + 1}`)
      requireExactKeys(step, ["kind", "role", "name", "signature", "args"], `reference call step ${index + 1}`)
    } else {
      throw new Error(`reference step ${index + 1} has unknown kind`)
    }
    if (typeof step.role !== "string" || !byRole.has(step.role)) throw new Error(`reference step ${index + 1} has unknown contract role`)
    if (typeof step.name !== "string" || step.name.length === 0 || step.name.length > 128) throw new Error(`reference step ${index + 1} has invalid name`)
    if (!Array.isArray(step.args) || step.args.length > 16) throw new Error(`reference step ${index + 1} has invalid arguments`)
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
  requireExactKeys(value, ["schema", "app", "sourceCommit", "expectedChainId", "expectedDeployer", "planSha256", "steps", "contracts", "snapshotSha256"], "release approval reference")
  if (value.schema !== "release-approval.reference.v1") throw new Error("unsupported release approval reference schema")
  if (value.app !== "escrow" && value.app !== "bike-nft" && value.app !== "pay-to-play") throw new Error("unknown release approval app")
  if (typeof value.snapshotSha256 !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value.snapshotSha256)) throw new Error("invalid reference snapshot digest")
  const { snapshotSha256, ...base } = value
  if (sha256(JSON.stringify(base)) !== snapshotSha256) throw new Error("reference snapshot digest mismatch")
  requiredSourceCommit(value.sourceCommit)
  requiredNonzeroAddress(value.expectedDeployer, "reference expected deployer")
  if (!Number.isSafeInteger(value.expectedChainId) || Number(value.expectedChainId) <= 0) throw new Error("invalid reference chain ID")
  bytes32(value.planSha256, "reference plan digest")
  const contracts = snapshotContracts(value.contracts, value.app)
  snapshotSteps(value.steps, contracts)
  return value as ReferenceSnapshot
}
