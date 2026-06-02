import {
  CAM_UI_NAMESPACE,
  parseCam,
} from "@cam/core"
import type {
  CamDocument,
} from "@cam/core"
import {
  CamEvmError,
  verifyCamResourceIntegrity,
} from "@cam/evm-viem"
import {
  parseJsonBytes,
} from "@cam/protocol"
import {
  parseUi,
} from "@cam/screen"

import {
  CamConformanceError,
  issueFromError,
} from "./issues.ts"
import type {
  CamConformanceIssue,
} from "./issues.ts"

export type CamConformanceBundle = {
  readonly mainURI: string
  readonly mainBytes: Uint8Array
  readonly resources: ReadonlyMap<string, Uint8Array>
}

type ResourceDeclaration = {
  readonly uri: string
  readonly integrity: string
  readonly uriPath: string
  readonly integrityPath: string
}

export function validateCamBundle(bundle: CamConformanceBundle): readonly CamConformanceIssue[] {
  const issues: CamConformanceIssue[] = []
  const cam = parseMain(bundle.mainBytes, issues)
  if (cam === undefined) {
    return issues
  }

  const declarations = declaredResources(cam)
  for (const declaration of declarations) {
    const bytes = bundle.resources.get(declaration.uri)
    if (bytes === undefined) {
      issues.push({
        rule: "CAM_RESOURCE_MISSING",
        severity: "error",
        resource: declaration.uri,
        path: declaration.uriPath,
        message: `declared CAM resource is missing: ${declaration.uri}`,
      })
      continue
    }

    verifyIntegrity(declaration, bytes, issues)
  }

  const uiDeclaration = declarations.find(
    (declaration) => declaration.uriPath === `namespaces.${CAM_UI_NAMESPACE}.uri`,
  )
  if (uiDeclaration === undefined) {
    issues.push({
      rule: "CAM_UI_RESOURCE_MISSING",
      severity: "error",
      resource: "main.json",
      path: `namespaces.${CAM_UI_NAMESPACE}`,
      message: "CAM bundle must declare a ui namespace",
    })
    return issues
  }

  const uiBytes = bundle.resources.get(uiDeclaration.uri)
  if (uiBytes !== undefined) {
    parseUiResource(uiDeclaration.uri, uiBytes, issues)
  }

  return issues
}

export function assertCamBundle(bundle: CamConformanceBundle): void {
  const issues = validateCamBundle(bundle)
  if (issues.length > 0) {
    throw new CamConformanceError(issues)
  }
}

function parseMain(bytes: Uint8Array, issues: CamConformanceIssue[]): CamDocument | undefined {
  try {
    return parseCam(parseJsonBytes(bytes))
  } catch (error) {
    issues.push(issueFromError({
      rule: "CAM_MAIN_INVALID",
      resource: "main.json",
      error,
    }))
    return undefined
  }
}

function parseUiResource(resource: string, bytes: Uint8Array, issues: CamConformanceIssue[]): void {
  try {
    parseUi(parseJsonBytes(bytes))
  } catch (error) {
    issues.push(issueFromError({
      rule: "CAM_UI_INVALID",
      resource,
      error,
    }))
  }
}

function verifyIntegrity(
  declaration: ResourceDeclaration,
  bytes: Uint8Array,
  issues: CamConformanceIssue[],
): void {
  try {
    verifyCamResourceIntegrity({
      bytes,
      integrity: declaration.integrity,
      uri: declaration.uri,
    })
  } catch (error) {
    issues.push(issueFromError({
      rule: error instanceof CamEvmError ? error.code : "CAM_RESOURCE_INTEGRITY_INVALID",
      resource: declaration.uri,
      path: declaration.integrityPath,
      error,
    }))
  }
}

function declaredResources(cam: CamDocument): readonly ResourceDeclaration[] {
  const declarations: ResourceDeclaration[] = []

  for (const [namespace, declaration] of Object.entries(cam.namespaces)) {
    switch (declaration.type) {
      case "contract":
        declarations.push({
          uri: declaration.abiURI,
          integrity: declaration.integrity,
          uriPath: `namespaces.${namespace}.abiURI`,
          integrityPath: `namespaces.${namespace}.integrity`,
        })
        break
      case "ui":
        declarations.push({
          uri: declaration.uri,
          integrity: declaration.integrity,
          uriPath: `namespaces.${namespace}.uri`,
          integrityPath: `namespaces.${namespace}.integrity`,
        })
        break
      case "routes":
        break
    }
  }

  return declarations
}
