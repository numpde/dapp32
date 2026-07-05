import { CamError } from "./errors.ts"
import { parseExpressionPayload } from "./expressions.ts"
import {
  requiredNonEmptyString,
  requiredRecord,
} from "./guards.ts"
import {
  CAM_ROUTE_CALL_NAMESPACE_TYPES,
  CAM_VERSION,
  camRouteThenNamespaceTypes,
  collectCamInvocationFact,
  collectCamNamespaceFacts,
  collectCamResourceDeclarationFacts,
  collectCamRootFact,
  collectCamRouteInputsFact,
  createStringMap,
  hasOwn,
  isCamRouteKind,
} from "@cam/protocol"
import type {
  CamContractNamespace,
  CamDocument,
  CamInvocation,
  CamNamespace,
  CamRoute,
  CamRoutesNamespace,
  CamUiNamespace,
} from "./types.ts"
import type {
  CamFactDiagnostic,
  CamNamespaceFact,
  CamResourceDeclarationFact,
  CamRootFact,
  CamNamespaceType,
  InertValue,
} from "@cam/protocol"

const CONTRACT_NAMESPACE_KEYS = new Set(["type", "abiURI", "integrity"])
const ROUTES_NAMESPACE_KEYS = new Set(["type"])
const UI_NAMESPACE_KEYS = new Set(["type", "uri", "integrity"])
const ROUTE_KEYS = new Set(["kind", "inputs", "call", "then"])
const INVOCATION_KEYS = new Set(["namespace", "function", "args"])

export function parseCam(input: unknown): CamDocument {
  const root = parseRootFact(input)
  const namespaces = parseNamespaces(root)
  const routes = parseRoutes(requiredRecord(root.value.routes, "routes"), namespaces)
  const entry = requiredNonEmptyString(root.value.entry, "entry")

  if (!hasOwn(routes, entry)) {
    throw new CamError("CAM_ENTRY_ROUTE_MISSING", `entry route does not exist: ${entry}`, "entry")
  }

  return {
    cam: root.version,
    entry,
    namespaces,
    routes,
  }
}

function parseRootFact(input: unknown): CamRootFact {
  const result = collectCamRootFact(input, { resource: "CAM root" })
  const diagnostic = result.diagnostics[0]
  if (diagnostic !== undefined) {
    throw camErrorFromFactDiagnostic(diagnostic)
  }
  if (result.value === undefined) {
    throw new CamError("CAM_NOT_OBJECT", "CAM root document must be a JSON object")
  }

  return result.value
}

function parseNamespaces(root: CamRootFact): Record<string, CamNamespace> {
  const namespaceResult = collectCamNamespaceFacts(root)
  const namespaceDiagnostic = namespaceResult.diagnostics[0]
  if (namespaceDiagnostic !== undefined) {
    throw camErrorFromFactDiagnostic(namespaceDiagnostic)
  }

  return parseNamespaceFacts(namespaceResult.namespaces)
}

function parseNamespaceFacts(
  facts: readonly CamNamespaceFact[],
): Record<string, CamNamespace> {
  const namespaces = createStringMap<CamNamespace>()
  for (const fact of facts) {
    namespaces[fact.name] = parseNamespaceFact(fact)
  }

  return namespaces
}

function parseNamespaceFact(fact: CamNamespaceFact): CamNamespace {
  switch (fact.type) {
    case "contract":
      return parseContractNamespace(fact)
    case "routes":
      return parseRoutesNamespace(fact)
    case "ui":
      return parseUiNamespace(fact)
  }
}

function parseContractNamespace(fact: CamNamespaceFact): CamContractNamespace {
  rejectUnknownCamFields(fact.declaration, CONTRACT_NAMESPACE_KEYS, fact.path)
  const resource = parseResourceDeclaration(fact)
  return {
    type: "contract",
    abiURI: resource.uri,
    integrity: resource.integrity,
  }
}

function parseRoutesNamespace(fact: CamNamespaceFact): CamRoutesNamespace {
  rejectUnknownCamFields(fact.declaration, ROUTES_NAMESPACE_KEYS, fact.path)
  return {
    type: "routes",
  }
}

function parseUiNamespace(fact: CamNamespaceFact): CamUiNamespace {
  rejectUnknownCamFields(fact.declaration, UI_NAMESPACE_KEYS, fact.path)
  const resource = parseResourceDeclaration(fact)
  return {
    type: "ui",
    uri: resource.uri,
    integrity: resource.integrity,
  }
}

function parseResourceDeclaration(fact: CamNamespaceFact): CamResourceDeclarationFact {
  const result = collectCamResourceDeclarationFacts([fact])
  const diagnostic = result.diagnostics[0]
  if (diagnostic !== undefined) {
    throw camErrorFromFactDiagnostic(diagnostic)
  }
  const declaration = result.declarations[0]
  if (declaration !== undefined) return declaration

  // Earlier fact collection is fail-fast for resource diagnostics. Reaching
  // this means the runtime adapter and fact collector disagree about usability.
  throw new CamError("CAM_INVALID_FIELD", `CAM resource declaration is not usable: ${fact.name}`, fact.path)
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
    const call = parseInvocation(route.call, `${path}.call`, namespaces, CAM_ROUTE_CALL_NAMESPACE_TYPES)
    const then = parseInvocation(
      route.then,
      `${path}.then`,
      namespaces,
      camRouteThenNamespaceTypes(kind),
    )

    routes[name] = {
      kind,
      inputs: parseInputNames(route.inputs, `${path}.inputs`, name),
      call,
      then,
    }
  }

  return routes
}

function parseRouteKind(value: unknown, path: string): CamRoute["kind"] {
  const kind = requiredNonEmptyString(value, path)
  if (!isCamRouteKind(kind)) {
    throw new CamError("CAM_INVALID_FIELD", `route kind must be read or write: ${kind}`, path)
  }

  return kind
}

function parseInputNames(value: unknown, path: string, routeName: string): readonly string[] {
  const result = collectCamRouteInputsFact({
    resource: "CAM root",
    path,
    routeName,
    inputs: value,
  })
  const diagnostic = result.diagnostics[0]
  if (diagnostic !== undefined) {
    throw camErrorFromFactDiagnostic(diagnostic)
  }
  if (result.value === undefined) {
    throw new CamError("CAM_INVALID_FIELD", "CAM route inputs are not usable", path)
  }

  return result.value.inputs
}

function parseInvocation(
  value: unknown,
  path: string,
  namespaces: Record<string, CamNamespace>,
  allowedNamespaceTypes: ReadonlySet<CamNamespace["type"]>,
): CamInvocation {
  const source = requiredRecord(value, path)
  rejectUnknownCamFields(source, INVOCATION_KEYS, path)
  const result = collectCamInvocationFact({
    resource: "CAM root",
    path,
    invocation: source,
    namespaceTypes: namespaceTypeMap(namespaces),
    allowedNamespaceTypes,
    purpose: path.endsWith(".call") ? "route call" : "route continuation",
  })
  const diagnostic = result.diagnostics[0]
  if (diagnostic !== undefined) {
    throw camErrorFromFactDiagnostic(diagnostic)
  }
  const fact = result.value
  if (fact === undefined) {
    throw new CamError("CAM_INVALID_FIELD", "CAM invocation is not usable", path)
  }

  return {
    namespace: fact.namespace,
    function: fact.function,
    args: parseNamedArgs(fact.args, `${path}.args`),
  }
}

function namespaceTypeMap(namespaces: Record<string, CamNamespace>): ReadonlyMap<string, CamNamespaceType> {
  const namespaceTypes = new Map<string, CamNamespaceType>()
  for (const [name, namespace] of Object.entries(namespaces)) {
    namespaceTypes.set(name, namespace.type)
  }
  return namespaceTypes
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

function camErrorFromFactDiagnostic(diagnostic: CamFactDiagnostic): CamError {
  switch (diagnostic.code) {
    case "CAM_FACT_ROOT_NOT_OBJECT":
      return new CamError("CAM_NOT_OBJECT", diagnostic.message, diagnostic.path)
    case "CAM_FACT_ROOT_FIELD_UNKNOWN":
      return new CamError("CAM_UNKNOWN_FIELD", diagnostic.message, diagnostic.path)
    case "CAM_FACT_RESOURCE_URI_POLICY_INVALID":
      return new CamError("CAM_INVALID_URI", diagnostic.message, diagnostic.path)
    case "CAM_FACT_ROOT_VERSION_INVALID":
    case "CAM_FACT_NAMESPACES_NOT_OBJECT":
    case "CAM_FACT_NAMESPACE_NAME_EMPTY":
    case "CAM_FACT_NAMESPACE_NOT_OBJECT":
    case "CAM_FACT_NAMESPACE_TYPE_INVALID":
    case "CAM_FACT_NAMESPACE_NAME_INVALID":
    case "CAM_FACT_RESOURCE_URI_INVALID":
    case "CAM_FACT_RESOURCE_INTEGRITY_INVALID":
    case "CAM_FACT_INVOCATION_NOT_OBJECT":
    case "CAM_FACT_INVOCATION_NAMESPACE_INVALID":
    case "CAM_FACT_INVOCATION_NAMESPACE_UNKNOWN":
    case "CAM_FACT_INVOCATION_NAMESPACE_TYPE_INVALID":
    case "CAM_FACT_INVOCATION_FUNCTION_INVALID":
    case "CAM_FACT_INVOCATION_ARGS_INVALID":
    case "CAM_FACT_INVOCATION_ARG_NAME_INVALID":
    case "CAM_FACT_ROUTE_INPUTS_NOT_ARRAY":
    case "CAM_FACT_ROUTE_INPUT_NAME_INVALID":
    case "CAM_FACT_ROUTE_INPUT_NAME_DUPLICATE":
      return new CamError("CAM_INVALID_FIELD", diagnostic.message, diagnostic.path)
  }
}
