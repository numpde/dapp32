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
