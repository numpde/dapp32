import { readBoundedRegularFile } from "../release-files.ts"
import { camBindingRecipe } from "./bindings.ts"
import { ARTIFACTS, businessContractRoles, type ReleaseApp } from "../release-approval/reference-read.ts"
import { readCompiledContractSource, type CompiledContractSource } from "../release-compiled-contract.ts"

export async function readBusinessCompilations(app: ReleaseApp, artifactsRoot: string, sourcesRoot: string): Promise<Readonly<Record<string, CompiledContractSource>>> {
  const compilations: Record<string, CompiledContractSource> = {}
  for (const role of businessContractRoles(app)) {
    compilations[role] = await readCompiledContractSource(ARTIFACTS[app][role]!, artifactsRoot, sourcesRoot)
  }
  return compilations
}

export function readUICompilation(app: ReleaseApp, artifactsRoot: string, sourcesRoot: string): Promise<CompiledContractSource> {
  return readCompiledContractSource(ARTIFACTS[app].ui!, artifactsRoot, sourcesRoot)
}

export function readRootCompilation(app: ReleaseApp, artifactsRoot: string, sourcesRoot: string): Promise<CompiledContractSource> {
  return readCompiledContractSource(ARTIFACTS[app].camRoot!, artifactsRoot, sourcesRoot)
}

export function selectBundleCompilations(app: ReleaseApp, business: Readonly<Record<string, CompiledContractSource>>,
  ui: CompiledContractSource, root: CompiledContractSource | undefined) {
  const selected = new Map<string, { role: string; compilation: CompiledContractSource }>()
  for (const binding of camBindingRecipe(app)) {
    const name = binding.args[0] as string
    const role = (binding.args[1] as { readonly createdContract: string }).createdContract
    const compilation = role === "camRoot" ? root : role === "ui" ? ui : business[role]
    if (compilation === undefined) throw new Error(`Cannot prepare CAM bundle: no selected original compilation for ${name} (${role})`)
    selected.set(name, { role, compilation })
  }
  return selected
}

export function bundleCompilationSources(selected: ReturnType<typeof selectBundleCompilations>,
  businessSource: string, uiSource: string, rootSource: string | undefined) {
  return Object.fromEntries([...selected].map(([name, original]) => {
    let sourceCommit: string
    if (original.role === "ui") sourceCommit = uiSource
    else if (original.role === "camRoot") {
      if (rootSource === undefined) throw new Error("Selected root ABI requires its original source commit")
      sourceCommit = rootSource
    } else sourceCommit = businessSource
    const { abi: _abi, creationBytecode: _program, compilerSettings: _settings, ...compilation } = original.compilation
    return [name, { role: original.role, sourceCommit, ...compilation }]
  }))
}

/** Root provenance is independent of the authored bundle and its logical ABI resources. */
export async function readOriginalRootCompilation(app: ReleaseApp, sourceCommit: string) {
  const selected = new TextDecoder().decode(await readBoundedRegularFile("/root-proof/source-commit", "original root source selection", 40))
  if (selected !== sourceCommit) throw new Error("Cannot admit existing CAM root: retained original source differs from selected root evidence")
  return readRootCompilation(app, "/root-proof/compiler/root", "/root-proof/sources/root/dapps")
}
