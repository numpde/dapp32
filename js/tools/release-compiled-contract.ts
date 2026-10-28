import { lstat, realpath } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { keccak256, toHex, type Abi, type Hex } from "viem"
import { readBoundedRegularFile } from "./release-files.ts"
import { readAbi, record, sha256 } from "./release-approval/reference-read.ts"

export type CompiledContractSource = {
  readonly name: string
  readonly source: string
  readonly compilerVersion: string
  readonly compilerSettings: Readonly<Record<string, unknown>>
  readonly compilerMetadataSha256: Hex
  readonly artifactSha256: Hex
  readonly creationBytecode: Hex
  readonly abi: Abi
}

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

async function readCompilation(location: { readonly source: string; readonly contract: string },
  artifactsRoot: string, sourcesRoot: string) {
  const artifactBytes = await checkedArtifactBytes(artifactsRoot, location.contract)
  const artifact = record(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(artifactBytes)), `${location.contract} compiler artifact`)
  const bytecode = record(artifact.bytecode, `${location.contract} bytecode`)
  const links = record(bytecode.linkReferences, `${location.contract} link references`)
  if (Object.keys(links).length !== 0) throw new Error(`${location.contract} creation bytecode has unresolved link references`)
  if (typeof bytecode.object !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(bytecode.object) || bytecode.object.length > 2 + 2 * 128 * 1024) {
    throw new Error(`${location.contract} creation bytecode must be bounded, linked hex bytes`)
  }

  const abi = readAbi(artifact.abi, location.contract)
  const metadata = record(artifact.metadata, `${location.contract} metadata`)
  const compiler = record(metadata.compiler, `${location.contract} compiler`)
  if (typeof compiler.version !== "string" || compiler.version.length === 0 || compiler.version.length > 128) {
    throw new Error(`${location.contract} compiler metadata has no bounded compiler version`)
  }
  const settings = record(metadata.settings, `${location.contract} compiler settings`)
  const target = record(settings.compilationTarget, `${location.contract} compilation target`)
  if (Object.keys(target).length !== 1 || target[location.source] !== location.contract) throw new Error(`${location.contract} compilation target mismatch`)
  const sources = record(metadata.sources, `${location.contract} compiler sources`)
  if (Object.keys(sources).length === 0 || Object.keys(sources).length > 200 || !(location.source in sources)) throw new Error(`${location.contract} compiler sources are incomplete or excessive`)
  const sourceContents: Record<string, { content: string }> = {}
  for (const [relative, entry] of Object.entries(sources)) {
    const hash = record(entry, `${location.contract} compiler source ${relative}`).keccak256
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`${location.contract} compiler source hash is invalid: ${relative}`)
    const contents = await checkedSourceBytes(sourcesRoot, relative)
    const actual = keccak256(toHex(contents))
    if (actual.toLowerCase() !== hash.toLowerCase()) throw new Error(`${location.contract} source hash mismatch: ${relative}`)
    sourceContents[relative] = { content: new TextDecoder("utf-8", { fatal: true }).decode(contents) }
  }

  const compiled: CompiledContractSource = {
    name: location.contract, source: location.source, compilerVersion: compiler.version, compilerSettings: settings,
    compilerMetadataSha256: sha256(JSON.stringify(metadata)),
    artifactSha256: sha256(artifactBytes),
    creationBytecode: bytecode.object as Hex,
    abi,
  }
  return { compiled, metadata, sourceContents }
}

export async function readCompiledContractSource(location: { readonly source: string; readonly contract: string },
  artifactsRoot: string, sourcesRoot: string): Promise<CompiledContractSource> {
  return (await readCompilation(location, artifactsRoot, sourcesRoot)).compiled
}

/** Export only metadata-named, hash-checked sources; never send an entire archive to a verifier. */
export async function readSourceVerificationInput(location: { readonly source: string; readonly contract: string },
  artifactsRoot: string, sourcesRoot: string) {
  const { compiled, metadata, sourceContents } = await readCompilation(location, artifactsRoot, sourcesRoot)
  // compilationTarget describes a compiler output; it is not a valid solc input setting.
  const { compilationTarget: _target, ...settings } = compiled.compilerSettings
  return { metadata, compilerVersion: compiled.compilerVersion, contractIdentifier: `${compiled.source}:${compiled.name}`,
    stdJsonInput: { language: "Solidity", sources: sourceContents, settings } }
}
