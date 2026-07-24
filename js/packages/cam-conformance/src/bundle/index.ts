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
  validateRootManifest,
} from "../manifest/root.ts"
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
  declaredUiDocument,
} from "../ui/resources.ts"

export type {
  CamConformanceBundle,
} from "./types.ts"

// Bundle conformance starts from caller-collected bytes and orchestrates static
// publication facts only: no fetching, route execution, account state, RPC, or
// wallet behavior. Dynamic values stay at runtime.
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
  const version = validateRootManifest({
    resource: bundle.rootURI,
    root,
    issues,
  })
  if (version === undefined) {
    return issues
  }
  // Structural inventory joins root namespaces/resources/routes so later
  // cross-document rules can report author-editable paths.
  const namespaces = validateNamespaceDeclarations({
    resource: bundle.rootURI,
    root,
    issues,
  })
  const declarations = declaredResources({
    namespaces,
    issues,
  })
  const validDeclarations = validateDeclaredResources({
    resources: bundle.resources,
    declarations,
    issues,
  })
  const uiDocument = declaredUiDocument({
    resources: bundle.resources,
    declarations: validDeclarations,
    issues,
  })
  const functionsByNamespace = contractFunctionsByNamespace(bundle.resources, validDeclarations, issues)
  const routes = validateRouteDeclarations({
    resource: bundle.rootURI,
    root,
    version,
    namespaces,
    issues,
  })
  const uiNodes = declaredUiNodes({
    uiDocument,
    issues,
  })
  // These cross-resource checks prove deterministic bundle failures from the
  // static inventories above, with conformance-owned rule codes and paths.
  validateRouteHandoffs({
    resource: bundle.rootURI,
    routes,
    uiNodes,
    functionsByNamespace,
    issues,
  })
  validateUiDataflow({
    uiDocument,
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
    uiDocument,
    routes,
    functionsByNamespace,
    issues,
  })
  validateUiExpressionRoots({
    uiDocument,
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
