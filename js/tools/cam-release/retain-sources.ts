import { readdir, realpath, unlink, rmdir } from "node:fs/promises"
import { resolve, sep } from "node:path"
import { readBoundedRegularFile } from "../release-files.ts"
import { parseJsonRecord } from "../release-values.ts"

/** Keep only compiler metadata inputs after a complete CAM bundle owns its resources. */
export async function retainCompilationSources(artifactDirectory: string, sourceDirectory: string): Promise<void> {
  const artifactRoot = await realpath(artifactDirectory)
  const sourceRoot = await realpath(sourceDirectory)
  const required = new Set<string>()
  for (const contractDirectory of await readdir(artifactRoot, { withFileTypes: true })) {
    if (!contractDirectory.isDirectory() || contractDirectory.isSymbolicLink()) throw new Error("Compiler output contains an unexpected entry")
    const contract = contractDirectory.name.replace(/\.sol$/, "")
    if (`${contract}.sol` !== contractDirectory.name) throw new Error("Compiler output directory name is invalid")
    const bytes = await readBoundedRegularFile(resolve(artifactRoot, contractDirectory.name, `${contract}.json`), `${contract} compiler artifact`, 2 * 1024 * 1024)
    const artifact = parseJsonRecord(bytes, `${contract} compiler artifact`)
    if (artifact.metadata === null || typeof artifact.metadata !== "object" || Array.isArray(artifact.metadata)) throw new Error(`${contract} compiler metadata is missing`)
    const metadata = artifact.metadata as Record<string, unknown>
    if (metadata.sources === null || typeof metadata.sources !== "object" || Array.isArray(metadata.sources)) throw new Error(`${contract} compiler source list is invalid`)
    for (const source of Object.keys(metadata.sources)) {
      if (!/^[a-zA-Z0-9_@./-]+$/.test(source) || source.startsWith("/") || source.split("/").some(part => part === "" || part === "." || part === "..")) {
        throw new Error(`Compiler source path is unsafe: ${source}`)
      }
      const path = resolve(sourceRoot, "dapps", source)
      if (!path.startsWith(`${sourceRoot}${sep}`)) throw new Error(`Compiler source escapes selected source tree: ${source}`)
      const resolved = await realpath(path)
      if (!resolved.startsWith(`${sourceRoot}${sep}`)) throw new Error(`Compiler source resolves outside selected source tree: ${source}`)
      required.add(resolved)
    }
  }
  if (required.size === 0) throw new Error("Compiler metadata names no source files")

  await pruneSourceTree(sourceRoot, required)
}

async function pruneSourceTree(sourceRoot: string, required: ReadonlySet<string>): Promise<void> {
  async function prune(directory: string): Promise<void> {
    const resolvedDirectory = await realpath(directory)
    if (resolvedDirectory !== sourceRoot && !resolvedDirectory.startsWith(`${sourceRoot}${sep}`)) throw new Error("Source cleanup escaped its selected tree")
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Cannot compact source tree containing a symbolic link: ${path}`)
      if (entry.isDirectory()) {
        await prune(path)
        if ((await readdir(path)).length === 0) await rmdir(path)
      } else if (entry.isFile()) {
        if (!required.has(await realpath(path))) await unlink(path)
      } else throw new Error(`Cannot compact source tree containing a special file: ${path}`)
    }
  }
  await prune(sourceRoot)
}

export async function removeExpandedAuthoringSources(directory: string): Promise<void> {
  const root = await realpath(directory)
  await pruneSourceTree(root, new Set())
  await rmdir(root)
}
