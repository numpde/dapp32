import { createHash } from "node:crypto"
import {
  CamResourceIntegrityError,
  assertCamResourceSize,
  collectCamResourceDeclarationFacts,
  verifySha256ResourceIntegrity,
} from "@cam/protocol"
import type {
  CamFactDiagnostic,
  CamResourceDeclarationFact,
} from "@cam/protocol"

import {
  conformanceIssue,
  issueFromError,
  type CamConformanceIssue,
} from "../issues.ts"
import type {
  DeclaredNamespace,
} from "../manifest/namespaces.ts"
import {
  RESOURCE_RULES,
} from "./rules.ts"

type ResourceRule = (typeof RESOURCE_RULES)[keyof typeof RESOURCE_RULES]

export type ResourceDeclaration = CamResourceDeclarationFact

export function declaredResources({
  namespaces,
  issues,
}: {
  readonly namespaces: readonly DeclaredNamespace[]
  readonly issues: CamConformanceIssue[]
}): readonly ResourceDeclaration[] {
  const result = collectCamResourceDeclarationFacts(namespaces)
  for (const diagnostic of result.diagnostics) {
    issues.push(resourceFactDiagnosticIssue(diagnostic))
  }

  return result.declarations
}

export function validateDeclaredResources({
  resources,
  declarations,
  issues,
}: {
  readonly resources: ReadonlyMap<string, Uint8Array>
  readonly declarations: readonly ResourceDeclaration[]
  readonly issues: CamConformanceIssue[]
}): readonly ResourceDeclaration[] {
  const validDeclarations: ResourceDeclaration[] = []
  reportIntegrityConflicts(declarations, issues)
  for (const declaration of declarations) {
    if (validateDeclaredResource(resources, declaration, issues)) {
      validDeclarations.push(declaration)
    }
  }
  reportOrphanResources(resources, declarations, issues)
  return validDeclarations
}

function validateDeclaredResource(
  resources: ReadonlyMap<string, Uint8Array>,
  declaration: ResourceDeclaration,
  issues: CamConformanceIssue[],
): boolean {
  const bytes = resources.get(declaration.uri)
  if (bytes === undefined) {
    reportMissingResource(declaration, issues)
    return false
  }

  if (!validateResourceSize(declaration, bytes, issues)) {
    return false
  }

  return verifyResourceIntegrity(declaration, bytes, issues)
}

function reportMissingResource(declaration: ResourceDeclaration, issues: CamConformanceIssue[]): void {
  issues.push(conformanceIssue({
    rule: RESOURCE_RULES.CAM_RESOURCE_MISSING,
    resource: declaration.uri,
    path: declaration.uriPath,
    message: `declared CAM resource is missing: ${declaration.uri}`,
  }))
}

function validateResourceSize(
  declaration: ResourceDeclaration,
  bytes: Uint8Array,
  issues: CamConformanceIssue[],
): boolean {
  return validateResourceRule({
    issues,
    action: () => assertCamResourceSize(bytes, declaration.uri),
    issue: (error) => issueFromError({
      rule: RESOURCE_RULES.CAM_RESOURCE_TOO_LARGE,
      resource: declaration.uri,
      path: declaration.uriPath,
      error,
    }),
  })
}

function reportOrphanResources(
  resources: ReadonlyMap<string, Uint8Array>,
  declarations: readonly ResourceDeclaration[],
  issues: CamConformanceIssue[],
): void {
  const declaredURIs = new Set(declarations.map((declaration) => declaration.uri))
  for (const uri of resources.keys()) {
    if (declaredURIs.has(uri)) continue

    issues.push(conformanceIssue({
      rule: RESOURCE_RULES.CAM_RESOURCE_ORPHAN,
      resource: uri,
      message: `bundle resource is not declared by the root CAM document: ${uri}`,
    }))
  }
}

// Conflicting hashes for one URI make the manifest impossible to reason about
// before any resource is even loaded.
function reportIntegrityConflicts(
  declarations: readonly ResourceDeclaration[],
  issues: CamConformanceIssue[],
): void {
  const integrityByURI = new Map<string, ResourceDeclaration>()
  for (const declaration of declarations) {
    const previous = integrityByURI.get(declaration.uri)
    if (previous === undefined) {
      integrityByURI.set(declaration.uri, declaration)
      continue
    }

    if (previous.integrity !== declaration.integrity) {
      issues.push(conformanceIssue({
        rule: RESOURCE_RULES.CAM_RESOURCE_INTEGRITY_CONFLICT,
        resource: declaration.uri,
        path: declaration.integrityPath,
        message: `resource URI has conflicting integrity declarations: ${declaration.uri}`,
      }))
    }
  }
}

function resourceFactDiagnosticIssue(diagnostic: CamFactDiagnostic): CamConformanceIssue {
  return conformanceIssue({
    rule: RESOURCE_RULES.CAM_RESOURCE_DECLARATION_INVALID,
    resource: diagnostic.resource,
    path: diagnostic.path,
    message: diagnostic.message,
  })
}

// Hashing happens here because conformance receives publication bytes. Hash
// grammar and comparison live in @cam/protocol so loaders and conformance do
// not drift on sha256: integrity semantics.
function verifyResourceIntegrity(
  declaration: ResourceDeclaration,
  bytes: Uint8Array,
  issues: CamConformanceIssue[],
): boolean {
  return validateResourceRule({
    issues,
    action: () => verifySha256ResourceIntegrity({
      actualHash: sha256Hex(bytes),
      integrity: declaration.integrity,
      uri: declaration.uri,
    }),
    issue: (error) => issueFromError({
      rule: resourceIntegrityRule(error),
      resource: declaration.uri,
      path: declaration.integrityPath,
      error,
    }),
  })
}

function resourceIntegrityRule(error: unknown): ResourceRule {
  if (error instanceof CamResourceIntegrityError) {
    switch (error.code) {
      case "CAM_RESOURCE_INTEGRITY_INVALID":
        return RESOURCE_RULES.CAM_RESOURCE_INTEGRITY_INVALID
      case "CAM_RESOURCE_INTEGRITY_MISMATCH":
        return RESOURCE_RULES.CAM_RESOURCE_INTEGRITY_MISMATCH
    }
  }

  return RESOURCE_RULES.CAM_RESOURCE_INTEGRITY_INVALID
}

// Node's crypto API returns the digest without the protocol's 0x marker.
function sha256Hex(bytes: Uint8Array): string {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`
}

function validateResourceRule({
  issues,
  action,
  issue,
}: {
  readonly issues: CamConformanceIssue[]
  readonly action: () => void
  readonly issue: (error: unknown) => CamConformanceIssue
}): boolean {
  const issueCount = issues.length
  try {
    action()
  } catch (error) {
    issues.push(issue(error))
  }

  return issues.length === issueCount
}
