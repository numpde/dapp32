import { createHash } from "node:crypto"
import {
  CamResourceIntegrityError,
  assertCamResourceSize,
  assertCamSecondaryResourceURI,
  camNamespaceResourceURIKey,
  isCamResourceNamespaceType,
  verifySha256ResourceIntegrity,
} from "@cam/protocol"
import type {
  CamResourceNamespaceType,
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
  nonEmptyString,
} from "../walk.ts"
import {
  RESOURCE_RULES,
} from "./rules.ts"

type ResourceRule = (typeof RESOURCE_RULES)[keyof typeof RESOURCE_RULES]

export type ResourceDeclaration = {
  readonly namespace: string
  readonly namespaceType: CamResourceNamespaceType
  readonly uri: string
  readonly integrity: string
  readonly uriPath: string
  readonly integrityPath: string
}

export function declaredResources({
  resource,
  namespaces,
  issues,
}: {
  readonly resource: string
  readonly namespaces: readonly DeclaredNamespace[]
  readonly issues: CamConformanceIssue[]
}): readonly ResourceDeclaration[] {
  const declarations: ResourceDeclaration[] = []
  for (const namespace of namespaces) {
    collectNamespaceResource({
      declarations,
      issues,
      resource,
      namespace,
    })
  }

  return declarations
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

function collectNamespaceResource({
  declarations,
  issues,
  resource,
  namespace,
}: {
  readonly declarations: ResourceDeclaration[]
  readonly issues: CamConformanceIssue[]
  readonly resource: string
  readonly namespace: DeclaredNamespace
}): void {
  if (!isCamResourceNamespaceType(namespace.type)) return
  const uriKey = camNamespaceResourceURIKey(namespace.type)

  const basePath = `namespaces.${namespace.name}`
  const declaredURI = nonEmptyString(namespace.declaration[uriKey])
  const declaredIntegrity = nonEmptyString(namespace.declaration.integrity)
  if (declaredURI === undefined) {
    issues.push(resourceDeclarationIssue({
      resource,
      path: `${basePath}.${uriKey}`,
      message: `CAM resource URI must be a non-empty string: ${namespace.name}`,
    }))
  }

  if (declaredIntegrity === undefined) {
    issues.push(resourceDeclarationIssue({
      resource,
      path: `${basePath}.integrity`,
      message: `CAM resource integrity must be a non-empty string: ${namespace.name}`,
    }))
  }

  if (declaredURI === undefined || declaredIntegrity === undefined) {
    return
  }
  const uriIsValid = validateResourceURI({
    resource,
    path: `${basePath}.${uriKey}`,
    uri: declaredURI,
    issues,
  })
  if (!uriIsValid) {
    return
  }

  declarations.push({
    namespace: namespace.name,
    namespaceType: namespace.type,
    uri: declaredURI,
    integrity: declaredIntegrity,
    uriPath: `${basePath}.${uriKey}`,
    integrityPath: `${basePath}.integrity`,
  })
}

function validateResourceURI({
  resource,
  path,
  uri,
  issues,
}: {
  readonly resource: string
  readonly path: string
  readonly uri: string
  readonly issues: CamConformanceIssue[]
}): boolean {
  return validateResourceRule({
    issues,
    action: () => assertCamSecondaryResourceURI(uri, path),
    issue: (error) => issueFromError({
      rule: RESOURCE_RULES.CAM_RESOURCE_DECLARATION_INVALID,
      resource,
      path,
      error,
    }),
  })
}

function resourceDeclarationIssue({
  resource,
  path,
  message,
}: {
  readonly resource: string
  readonly path: string
  readonly message: string
}): CamConformanceIssue {
  return conformanceIssue({
    rule: RESOURCE_RULES.CAM_RESOURCE_DECLARATION_INVALID,
    resource,
    path,
    message,
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
