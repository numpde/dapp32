import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"
import {
  conformanceRules,
  issueFromError,
  type CamConformanceIssue,
} from "../issues.ts"
import {
  parseRawUiDocument,
  type RawUiDocument,
} from "./document.ts"

export type DeclaredUiDocument = {
  readonly resource: string
  readonly document: RawUiDocument
}

const RULES = conformanceRules({
  CAM_UI_DOCUMENT_INVALID: {
    class: "A",
    reason: "UI version, root fields, and node inventory gate route/UI joins.",
  },
})

export function declaredUiDocument({
  resources,
  declarations,
  issues,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly issues: CamConformanceIssue[]
}): DeclaredUiDocument | undefined {
  // Namespace validation admits only the canonical CAM V1 `ui` namespace, so
  // downstream facets should model zero-or-one UI document instead of a map.
  for (const declaration of declarations) {
    if (declaration.namespaceType !== "ui") continue

    const bytes = resources.get(declaration.uri)
    if (bytes === undefined) continue

    try {
      return {
        resource: declaration.uri,
        document: parseRawUiDocument(bytes),
      }
    } catch (error) {
      issues.push(issueFromError({
        rule: RULES.CAM_UI_DOCUMENT_INVALID,
        resource: declaration.uri,
        error,
      }))
    }
  }

  return undefined
}
