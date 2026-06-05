import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"
import {
  issueFromError,
  type CamConformanceIssue,
} from "../issues.ts"
import {
  parseRawUiDocument,
  type RawUiDocument,
} from "./document.ts"

export type RawUiDocuments = ReadonlyMap<string, RawUiDocument>

export function declaredUiDocuments({
  resources,
  declarations,
  issues,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly issues: CamConformanceIssue[]
}): RawUiDocuments {
  const documents = new Map<string, RawUiDocument>()

  forEachDeclaredUiResourceBytes({
    resources,
    declarations,
    visit: (resource, bytes) => {
      try {
        documents.set(resource, parseRawUiDocument(bytes))
      } catch (error) {
        issues.push(issueFromError({
          rule: "CAM_UI_DOCUMENT_INVALID",
          resource,
          error,
        }))
      }
    },
  })

  return documents
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
