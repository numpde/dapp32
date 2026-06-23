// Top-level document keys are protocol vocabulary, not parser-local detail:
// parsers reject unknown fields and conformance uses the same closed-world
// boundary as a join gate before cross-document checks run.
export const CAM_MANIFEST_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(["cam", "entry", "namespaces", "routes"])

export type CamRouteKind = "read" | "write"
export type CamNamespaceType = "contract" | "routes" | "ui"
export type CamResourceNamespaceType = Exclude<CamNamespaceType, "routes">
export type CamNamespaceResourceURIKey = "abiURI" | "uri"

// Namespace type and canonical names are the manifest's resource/call graph
// vocabulary. Parser-only field sets stay local because they carry author paths
// and resource-specific requirements.
export const CAM_NAMESPACE_TYPES: ReadonlySet<string> = new Set(["contract", "routes", "ui"])

// Route kind is CAM control flow, not a runtime parser preference: read routes
// render UI; write routes cross the transaction boundary and continue to routes.
export const CAM_ROUTE_KINDS: ReadonlySet<string> = new Set(["read", "write"])

// Route invocation namespaces are the static CAM workflow contract. Parsers
// and conformance should share this boundary while retaining their own
// diagnostics and author paths.
export const CAM_ROUTE_CALL_NAMESPACE_TYPES: ReadonlySet<CamNamespaceType> = new Set(["contract"])
export const CAM_READ_ROUTE_THEN_NAMESPACE_TYPES: ReadonlySet<CamNamespaceType> = new Set(["ui"])
export const CAM_WRITE_ROUTE_THEN_NAMESPACE_TYPES: ReadonlySet<CamNamespaceType> = new Set(["routes"])

export function camRouteThenNamespaceTypes(kind: CamRouteKind): ReadonlySet<CamNamespaceType> {
  return kind === "read" ? CAM_READ_ROUTE_THEN_NAMESPACE_TYPES : CAM_WRITE_ROUTE_THEN_NAMESPACE_TYPES
}

// Resource-bearing namespace types define the manifest-to-bytes join. Routes
// is intentionally absent because it declares no external resource in CAM V1.
export const CAM_NAMESPACE_RESOURCE_URI_KEYS = {
  contract: "abiURI",
  ui: "uri",
} as const satisfies Readonly<Record<CamResourceNamespaceType, CamNamespaceResourceURIKey>>

export function isCamResourceNamespaceType(value: unknown): value is CamResourceNamespaceType {
  return typeof value === "string" && Object.hasOwn(CAM_NAMESPACE_RESOURCE_URI_KEYS, value)
}

export function camNamespaceResourceURIKey(type: CamResourceNamespaceType): CamNamespaceResourceURIKey
export function camNamespaceResourceURIKey(type: CamNamespaceType): CamNamespaceResourceURIKey | undefined
export function camNamespaceResourceURIKey(type: CamNamespaceType): CamNamespaceResourceURIKey | undefined {
  return isCamResourceNamespaceType(type) ? CAM_NAMESPACE_RESOURCE_URI_KEYS[type] : undefined
}

export function isCamNamespaceType(value: unknown): value is CamNamespaceType {
  return typeof value === "string" && CAM_NAMESPACE_TYPES.has(value)
}

export function isCamRouteKind(value: unknown): value is CamRouteKind {
  return typeof value === "string" && CAM_ROUTE_KINDS.has(value)
}
