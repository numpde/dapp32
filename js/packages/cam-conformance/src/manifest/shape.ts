import {
  isRecordObject,
} from "@cam/protocol"

import type {
  CamConformanceIssue,
} from "../issues.ts"

const ROOT_KEYS = new Set(["cam", "entry", "namespaces", "routes"])
const CONTRACT_NAMESPACE_KEYS = new Set(["type", "abiURI", "integrity"])
const ROUTES_NAMESPACE_KEYS = new Set(["type"])
const UI_NAMESPACE_KEYS = new Set(["type", "uri", "integrity"])
const ROUTE_KEYS = new Set(["kind", "inputs", "call", "then"])
const INVOCATION_KEYS = new Set(["namespace", "function", "args"])

// This facet is intentionally small and syntactic. It gives CAM authors precise
// unknown-field errors before the sourced runtime parser performs final
// compatibility validation.
export function validateManifestShape({
  resource,
  root,
  issues,
}: {
  readonly resource: string
  readonly root: unknown
  readonly issues: CamConformanceIssue[]
}): void {
  if (!isRecordObject(root)) return

  rejectUnknownFields(resource, "", root, ROOT_KEYS, issues)
  validateNamespaceFields(resource, root.namespaces, issues)
  validateRouteFields(resource, root.routes, issues)
}

function validateNamespaceFields(resource: string, namespaces: unknown, issues: CamConformanceIssue[]): void {
  if (!isRecordObject(namespaces)) return

  for (const [name, declaration] of Object.entries(namespaces)) {
    if (!isRecordObject(declaration)) continue

    const allowedKeys = namespaceKeys(declaration.type)
    if (allowedKeys === undefined) continue

    rejectUnknownFields(resource, `namespaces.${name}`, declaration, allowedKeys, issues)
  }
}

function namespaceKeys(type: unknown): ReadonlySet<string> | undefined {
  switch (type) {
    case "contract":
      return CONTRACT_NAMESPACE_KEYS
    case "routes":
      return ROUTES_NAMESPACE_KEYS
    case "ui":
      return UI_NAMESPACE_KEYS
    default:
      return undefined
  }
}

function validateRouteFields(resource: string, routes: unknown, issues: CamConformanceIssue[]): void {
  if (!isRecordObject(routes)) return

  for (const [name, route] of Object.entries(routes)) {
    if (!isRecordObject(route)) continue

    const routePath = `routes.${name}`
    rejectUnknownFields(resource, routePath, route, ROUTE_KEYS, issues)
    validateInvocationFields(resource, `${routePath}.call`, route.call, issues)
    validateInvocationFields(resource, `${routePath}.then`, route.then, issues)
  }
}

function validateInvocationFields(
  resource: string,
  path: string,
  invocation: unknown,
  issues: CamConformanceIssue[],
): void {
  if (isRecordObject(invocation)) {
    rejectUnknownFields(resource, path, invocation, INVOCATION_KEYS, issues)
  }
}

function rejectUnknownFields(
  resource: string,
  path: string,
  source: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  issues: CamConformanceIssue[],
): void {
  for (const key of Object.keys(source)) {
    if (allowedKeys.has(key)) continue

    issues.push({
      rule: "CAM_MANIFEST_FIELD_UNKNOWN",
      severity: "error",
      resource,
      path: path.length === 0 ? key : `${path}.${key}`,
      message: `field is not allowed in CAM manifest: ${key}`,
    })
  }
}
