import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"
import {
  readRawUiDocument,
  type RawUiDocument,
} from "./document.ts"

export function forEachRawUiResource({
  resources,
  declarations,
  visit,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly visit: (resource: string, ui: RawUiDocument) => void
}): void {
  for (const declaration of declarations) {
    if (declaration.namespaceType !== "ui") continue

    // Granular UI facets only inspect parseable declared UI resources. Missing
    // resources and invalid UI bytes are reported by the resource/runtime
    // facets, so repeating those errors here would make author feedback noisy.
    const bytes = resources.get(declaration.uri)
    if (bytes === undefined) continue

    const ui = readRawUiDocument(bytes)
    if (ui === undefined) continue

    visit(declaration.uri, ui)
  }
}
