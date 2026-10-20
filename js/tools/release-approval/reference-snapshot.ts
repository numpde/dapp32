import { lstat, realpath } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { keccak256, toHex, type Hex } from "viem"

import { bikeReference } from "../bike-nft-release/reference.ts"
import { escrowReference } from "../escrow-release/reference.ts"
import { payToPlayReference } from "../pay-to-play-release/reference.ts"
import { readBoundedRegularFile, writeNewJson } from "../release-files.ts"
import type { ReleaseReference, ExpectedStep } from "./reference.ts"
import {
  ARTIFACTS, COMPILER_VERSION, assertAbiMatchesSteps, readAbi, record, sha256,
  type ReleaseApp, type CompiledContractReference, type ReferenceSnapshot,
} from "./reference-read.ts"
export { parseReferenceSnapshot } from "./reference-read.ts"
export type { ReleaseApp, CompiledContractReference, ReferenceSnapshot } from "./reference-read.ts"

const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
const MAX_SOURCE_BYTES = 1024 * 1024

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
