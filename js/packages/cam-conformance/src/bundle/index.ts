import {
  CAM_UI_NAMESPACE,
} from "@cam/protocol"

import {
  CamConformanceError,
} from "../issues.ts"
import type {
  CamConformanceIssue,
} from "../issues.ts"

import {
  validateRouteAbiCompatibility,
} from "../abi/routes.ts"
import {
  validateNamespaceDeclarations,
} from "../manifest/namespaces.ts"
import {
  validateRouteDeclarations,
} from "../manifest/routes.ts"
import {
  parseRootCamJson,
} from "../sourced/root.ts"
import {
  declaredResources,
  validateDeclaredResources,
} from "../resources/declarations.ts"
import type {
  ResourceDeclaration,
} from "../resources/declarations.ts"
import {
  validateRouteHandoffs,
} from "../routes/handoffs.ts"
import {
  verifyRuntimeCamCompatibility,
} from "../sourced/runtime.ts"
import {
  declaredUiNodes,
} from "../ui/nodes.ts"
import type {
  CamConformanceBundle,
} from "./types.ts"
import {
  verifyRuntimeUiCompatibility,
} from "../sourced/ui.ts"

export type {
  CamConformanceBundle,
} from "./types.ts"

// Bundle conformance starts from bytes the caller already collected. This
// package should not fetch, execute routes, or talk to an EVM client; it only
// proves that the supplied root document and declared resources agree.
export function validateCamBundle(bundle: CamConformanceBundle): readonly CamConformanceIssue[] {
  const issues: CamConformanceIssue[] = []
  const rootResult = parseRootCamJson({
    resource: bundle.mainURI,
    bytes: bundle.mainBytes,
    issues,
  })
  if (!rootResult.ok) {
    return issues
  }

  const root = rootResult.value
  const namespaces = validateNamespaceDeclarations({
    resource: bundle.mainURI,
    root,
    issues,
  })
  const declarations = declaredResources({
    resource: bundle.mainURI,
    namespaces,
    issues,
  })
  validateDeclaredResources({
    resources: bundle.resources,
    declarations,
    issues,
  })
  const routes = validateRouteDeclarations({
    resource: bundle.mainURI,
    root,
    namespaces,
    issues,
  })
  validateRouteHandoffs({
    resource: bundle.mainURI,
    routes,
    uiNodes: declaredUiNodes({
      resources: bundle.resources,
      declarations,
    }),
    issues,
  })
  validateRouteAbiCompatibility({
    resource: bundle.mainURI,
    resources: bundle.resources,
    declarations,
    routes,
    issues,
  })
  verifyDeclaredUiResource(bundle.resources, declarations, issues)
  verifyRuntimeCamCompatibility({
    resource: bundle.mainURI,
    root,
    issues,
  })

  return issues
}

// Assertion mode is a convenience wrapper for tests and build tools that want a
// normal throwing API while preserving the structured issue list on the error.
export function assertCamBundle(bundle: CamConformanceBundle): void {
  const issues = validateCamBundle(bundle)
  if (issues.length > 0) {
    throw new CamConformanceError(issues)
  }
}

function verifyDeclaredUiResource(
  resources: ReadonlyMap<string, Uint8Array>,
  declarations: readonly ResourceDeclaration[],
  issues: CamConformanceIssue[],
): void {
  const declaration = declarations.find((item) => item.namespace === CAM_UI_NAMESPACE)
  if (declaration === undefined) return

  const bytes = resources.get(declaration.uri)
  if (bytes !== undefined) {
    verifyRuntimeUiCompatibility(declaration.uri, bytes, issues)
  }
}
