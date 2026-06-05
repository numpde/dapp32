import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"
import {
  issueFromError,
  type CamConformanceIssue,
} from "../issues.ts"
import {
  parseRawUiDocument,
  readRawUiDocument,
  type RawUiDocument,
} from "./document.ts"

export function validateDeclaredUiDocuments({
  resources,
  declarations,
  issues,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly issues: CamConformanceIssue[]
}): void {
  forEachDeclaredUiResourceBytes({
    resources,
    declarations,
    visit: (resource, bytes) => {
      try {
        parseRawUiDocument(bytes)
      } catch (error) {
        issues.push(issueFromError({
          rule: "CAM_UI_DOCUMENT_INVALID",
          resource,
          error,
        }))
      }
    },
  })
}

export function forEachRawUiResource({
  resources,
  declarations,
  visit,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly visit: (resource: string, ui: RawUiDocument) => void
}): void {
  forEachDeclaredUiResourceBytes({
    resources,
    declarations,
    visit: (resource, bytes) => {
      // Granular UI facets only inspect parseable declared UI resources. Missing
      // resources and invalid UI bytes are reported by the resource/runtime
      // facets, so repeating those errors here would make author feedback noisy.
      const ui = readRawUiDocument(bytes)
      if (ui === undefined) return

      visit(resource, ui)
    },
  })
}

export function forEachDeclaredUiResourceBytes({
  resources,
  declarations,
  visit,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly visit: (resource: string, bytes: Uint8Array) => void
}): void {
  for (const declaration of declarations) {
    if (declaration.namespaceType !== "ui") continue

    const bytes = resources.get(declaration.uri)
    if (bytes === undefined) continue

    visit(declaration.uri, bytes)
  }
}
