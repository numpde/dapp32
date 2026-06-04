import { CamError } from "./errors.ts"
import { parseExpressionPayload } from "./expressions.ts"
import {
  requiredArray,
  requiredNonEmptyString,
  requiredRecord,
} from "./guards.ts"
import { createStringMap, hasOwn } from "@cam/protocol"
import {
  CAM_CONTRACT_NAMESPACE_PREFIX,
  CAM_ROUTES_NAMESPACE,
  CAM_UI_NAMESPACE,
  CAM_VERSION,
} from "./constants.ts"
import type {
  CamContractNamespace,
  CamDocument,
  CamInvocation,
  CamNamespace,
  CamRoute,
  CamRoutesNamespace,
  CamUiNamespace,
} from "./types.ts"
import type { InertValue } from "@cam/protocol"

const TOP_LEVEL_KEYS = new Set(["cam", "entry", "namespaces", "routes"])
const CONTRACT_NAMESPACE_KEYS = new Set(["type", "abiURI", "integrity"])
const ROUTES_NAMESPACE_KEYS = new Set(["type"])
const UI_NAMESPACE_KEYS = new Set(["type", "uri", "integrity"])
const ROUTE_KEYS = new Set(["kind", "inputs", "call", "then"])
const INVOCATION_KEYS = new Set(["namespace", "function", "args"])

export function parseCam(input: unknown): CamDocument {
  const source = requiredRecord(input, "")
  rejectUnknownCamFields(source, TOP_LEVEL_KEYS, "")

  const namespaces = parseNamespaces(requiredRecord(source.namespaces, "namespaces"))
  const routes = parseRoutes(requiredRecord(source.routes, "routes"), namespaces)
  const entry = requiredNonEmptyString(source.entry, "entry")

  if (!hasOwn(routes, entry)) {
    throw new CamError("CAM_ENTRY_ROUTE_MISSING", `entry route does not exist: ${entry}`, "entry")
  }

  return {
    cam: parseCamVersion(source.cam),
    entry,
    namespaces,
    routes,
  }
}

function parseCamVersion(value: unknown): string {
  const version = requiredNonEmptyString(value, "cam")
  if (version !== CAM_VERSION) {
    throw new CamError("CAM_INVALID_FIELD", `unsupported CAM version: ${version}`, "cam")
  }

  return version
}

function parseNamespaces(source: Record<string, unknown>): Record<string, CamNamespace> {
  const namespaces = createStringMap<CamNamespace>()

  for (const [name, value] of Object.entries(source)) {
    if (name.length === 0) {
      throw new CamError("CAM_INVALID_FIELD", "namespace name must not be empty", "namespaces")
    }

    namespaces[name] = parseNamespace(name, value)
  }

  return namespaces
}

function parseNamespace(name: string, value: unknown): CamNamespace {
  const path = `namespaces.${name}`
  const source = requiredRecord(value, path)
  const type = requiredNonEmptyString(source.type, `${path}.type`)

  switch (type) {
    case "contract":
      return parseContractNamespace(source, path)
    case "routes":
      return parseRoutesNamespace(source, path)
    case "ui":
      return parseUiNamespace(source, path)
    default:
      throw new CamError("CAM_INVALID_FIELD", `unknown namespace type: ${type}`, `${path}.type`)
  }
}

function parseContractNamespace(source: Record<string, unknown>, path: string): CamContractNamespace {
  const name = path.slice("namespaces.".length)
  if (!name.startsWith(CAM_CONTRACT_NAMESPACE_PREFIX) || name.length === CAM_CONTRACT_NAMESPACE_PREFIX.length) {
    throw new CamError("CAM_INVALID_FIELD", `contract namespace must be ${CAM_CONTRACT_NAMESPACE_PREFIX}<name>`, path)
  }
  rejectUnknownCamFields(source, CONTRACT_NAMESPACE_KEYS, path)
  return {
    type: "contract",
    abiURI: requiredNonEmptyString(source.abiURI, `${path}.abiURI`),
    integrity: requiredNonEmptyString(source.integrity, `${path}.integrity`),
  }
}

function parseRoutesNamespace(source: Record<string, unknown>, path: string): CamRoutesNamespace {
  if (path !== `namespaces.${CAM_ROUTES_NAMESPACE}`) {
    throw new CamError("CAM_INVALID_FIELD", `routes namespace must be named ${CAM_ROUTES_NAMESPACE}`, path)
  }
  rejectUnknownCamFields(source, ROUTES_NAMESPACE_KEYS, path)
  return {
    type: "routes",
  }
}

function parseUiNamespace(source: Record<string, unknown>, path: string): CamUiNamespace {
  if (path !== `namespaces.${CAM_UI_NAMESPACE}`) {
    throw new CamError("CAM_INVALID_FIELD", `ui namespace must be named ${CAM_UI_NAMESPACE}`, path)
  }
  rejectUnknownCamFields(source, UI_NAMESPACE_KEYS, path)
  return {
    type: "ui",
    uri: requiredNonEmptyString(source.uri, `${path}.uri`),
    integrity: requiredNonEmptyString(source.integrity, `${path}.integrity`),
  }
}

function parseRoutes(
  source: Record<string, unknown>,
  namespaces: Record<string, CamNamespace>,
): Record<string, CamRoute> {
  const routes = createStringMap<CamRoute>()

  for (const [name, value] of Object.entries(source)) {
    if (name.length === 0) {
      throw new CamError("CAM_INVALID_FIELD", "route name must not be empty", "routes")
    }

    const path = `routes.${name}`
    const route = requiredRecord(value, path)
    rejectUnknownCamFields(route, ROUTE_KEYS, path)

    const kind = parseRouteKind(route.kind, `${path}.kind`)
    const call = parseInvocation(route.call, `${path}.call`, namespaces, new Set(["contract"]))
    const then = parseInvocation(
      route.then,
      `${path}.then`,
      namespaces,
      kind === "read" ? new Set(["ui"]) : new Set(["routes"]),
    )

    routes[name] = {
      kind,
      inputs: parseInputNames(route.inputs, `${path}.inputs`),
      call,
      then,
    }
  }

  return routes
}

function parseRouteKind(value: unknown, path: string): CamRoute["kind"] {
  const kind = requiredNonEmptyString(value, path)
  if (kind !== "read" && kind !== "write") {
    throw new CamError("CAM_INVALID_FIELD", `route kind must be read or write: ${kind}`, path)
  }

  return kind
}

function parseInputNames(value: unknown, path: string): readonly string[] {
  const source = requiredArray(value, path)
  const names: string[] = []
  const seen = new Set<string>()

  for (const [index, item] of source.entries()) {
    const itemPath = `${path}.${index}`
    const name = requiredNonEmptyString(item, itemPath)
    if (seen.has(name)) {
      throw new CamError("CAM_INVALID_FIELD", `duplicate input name: ${name}`, itemPath)
    }

    seen.add(name)
    names.push(name)
  }

  return names
}

function parseInvocation(
  value: unknown,
  path: string,
  namespaces: Record<string, CamNamespace>,
  allowedNamespaceTypes: ReadonlySet<CamNamespace["type"]>,
): CamInvocation {
  const source = requiredRecord(value, path)
  rejectUnknownCamFields(source, INVOCATION_KEYS, path)

  const namespace = requiredNonEmptyString(source.namespace, `${path}.namespace`)
  if (!hasOwn(namespaces, namespace)) {
    throw new CamError("CAM_INVALID_FIELD", `invocation references unknown namespace: ${namespace}`, `${path}.namespace`)
  }
  const namespaceType = namespaces[namespace].type
  if (!allowedNamespaceTypes.has(namespaceType)) {
    throw new CamError("CAM_INVALID_FIELD", `invocation references invalid ${namespaceType} namespace: ${namespace}`, `${path}.namespace`)
  }

  return {
    namespace,
    function: requiredNonEmptyString(source.function, `${path}.function`),
    args: parseNamedArgs(requiredRecord(source.args, `${path}.args`), `${path}.args`),
  }
}

function parseNamedArgs(source: Record<string, unknown>, path: string): Record<string, InertValue> {
  const args = createStringMap<InertValue>()

  for (const [name, value] of Object.entries(source)) {
    if (name.length === 0) {
      throw new CamError("CAM_INVALID_FIELD", "argument name must not be empty", path)
    }

    args[name] = parseExpressionPayload(value, `${path}.${name}`)
  }

  return args
}

function rejectUnknownCamFields(
  source: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
): void {
  // V1 is intentionally closed-world. Unknown fields are rejected so older or
  // richer CAM shapes cannot be partially interpreted as stricter V1 documents.
  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) {
      const fieldPath = path.length === 0 ? key : `${path}.${key}`
      throw new CamError("CAM_UNKNOWN_FIELD", `field is not allowed in CAM ${CAM_VERSION}: ${key}`, fieldPath)
    }
  }
}
