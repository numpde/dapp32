import {
  CamConformanceError,
} from "../issues.ts"
import type {
  CamConformanceIssue,
} from "../issues.ts"

import {
  contractFunctionsByNamespace,
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
  validateUiDataflow,
} from "../ui/dataflow.ts"
import {
  validateUiTypeflow,
} from "../ui/typeflow.ts"
import {
  validateUiExpressionRoots,
} from "../expressions/ui.ts"
import {
  verifyRuntimeUiCompatibility,
} from "../sourced/ui.ts"
import {
  declaredUiDocuments,
} from "../ui/resources.ts"

export type {
  CamConformanceBundle,
} from "./types.ts"

// Bundle conformance starts from bytes the caller already collected. This
// package should not fetch, execute routes, or talk to an EVM client; it only
// proves that the supplied root document and declared resources agree.
export function validateCamBundle(bundle: CamConformanceBundle): readonly CamConformanceIssue[] {
  const issues: CamConformanceIssue[] = []
  const rootResult = parseRootCamJson({
    resource: bundle.rootURI,
    bytes: bundle.rootBytes,
    issues,
  })
  if (!rootResult.ok) {
    return issues
  }

  const root = rootResult.value
  const namespaces = validateNamespaceDeclarations({
    resource: bundle.rootURI,
    root,
    issues,
  })
  const declarations = declaredResources({
    resource: bundle.rootURI,
    namespaces,
    issues,
  })
  const validDeclarations = validateDeclaredResources({
    resources: bundle.resources,
    declarations,
    issues,
  })
  const uiDocuments = declaredUiDocuments({
    resources: bundle.resources,
    declarations: validDeclarations,
    issues,
  })
  const functionsByNamespace = contractFunctionsByNamespace(bundle.resources, validDeclarations, issues)
  const routes = validateRouteDeclarations({
    resource: bundle.rootURI,
    root,
    namespaces,
    issues,
  })
  const uiNodes = declaredUiNodes({
    uiDocuments,
    issues,
  })
  validateRouteHandoffs({
    resource: bundle.rootURI,
    routes,
    uiNodes,
    functionsByNamespace,
    issues,
  })
  validateUiDataflow({
    uiDocuments,
    routes,
    uiNodes,
    issues,
  })
  validateRouteAbiCompatibility({
    resource: bundle.rootURI,
    routes,
    functionsByNamespace,
    issues,
  })
  validateUiTypeflow({
    uiDocuments,
    routes,
    functionsByNamespace,
    issues,
  })
  validateUiExpressionRoots({
    uiDocuments,
    issues,
  })
  verifyDeclaredUiResources(bundle.resources, uiDocuments, issues)
  verifyRuntimeCamCompatibility({
    resource: bundle.rootURI,
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

function verifyDeclaredUiResources(
  resources: ReadonlyMap<string, Uint8Array>,
  uiDocuments: ReadonlyMap<string, unknown>,
  issues: CamConformanceIssue[],
): void {
  for (const resource of uiDocuments.keys()) {
    const bytes = resources.get(resource)
    if (bytes !== undefined) {
      verifyRuntimeUiCompatibility(resource, bytes, issues)
    }
  }
}
