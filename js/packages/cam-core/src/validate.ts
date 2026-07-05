import { CamError } from "./errors.ts"
import { parseExpressionPayload } from "./expressions.ts"
import {
  requiredArray,
  requiredNonEmptyString,
  requiredRecord,
} from "./guards.ts"
import {
  CAM_ROUTE_CALL_NAMESPACE_TYPES,
  CAM_VERSION,
  camRouteThenNamespaceTypes,
  collectCamNamespaceFacts,
  collectCamResourceDeclarationFacts,
  collectCamRootFact,
  createStringMap,
  hasOwn,
  isCamRouteKind,
  isExpressionIdentifier,
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

  const resourceResult = collectCamResourceDeclarationFacts(namespaceResult.namespaces)
  return parseNamespaceFacts(
    namespaceResult.namespaces,
    resourceResult.declarations,
    resourceResult.diagnostics,
  )
}

function parseNamespaceFacts(
  facts: readonly CamNamespaceFact[],
  declarations: readonly CamResourceDeclarationFact[],
  diagnostics: readonly CamFactDiagnostic[],
): Record<string, CamNamespace> {
  const namespaces = createStringMap<CamNamespace>()
  const declarationsByNamespace = createStringMap<CamResourceDeclarationFact>()
  for (const declaration of declarations) {
    declarationsByNamespace[declaration.namespace] = declaration
  }

  for (const fact of facts) {
    namespaces[fact.name] = parseNamespaceFact(
      fact,
      declarationsByNamespace[fact.name],
      firstResourceDiagnosticForNamespace(fact, diagnostics),
    )
  }

  return namespaces
}

function parseNamespaceFact(
  fact: CamNamespaceFact,
  declaration: CamResourceDeclarationFact | undefined,
  diagnostic: CamFactDiagnostic | undefined,
): CamNamespace {
  switch (fact.type) {
    case "contract":
      return parseContractNamespace(fact, declaration, diagnostic)
    case "routes":
      return parseRoutesNamespace(fact)
    case "ui":
      return parseUiNamespace(fact, declaration, diagnostic)
  }
}

function parseContractNamespace(
  fact: CamNamespaceFact,
  declaration: CamResourceDeclarationFact | undefined,
  diagnostic: CamFactDiagnostic | undefined,
): CamContractNamespace {
  rejectUnknownCamFields(fact.declaration, CONTRACT_NAMESPACE_KEYS, fact.path)
  const resource = requiredResourceDeclaration(fact, declaration, diagnostic)
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

function parseUiNamespace(
  fact: CamNamespaceFact,
  declaration: CamResourceDeclarationFact | undefined,
  diagnostic: CamFactDiagnostic | undefined,
): CamUiNamespace {
  rejectUnknownCamFields(fact.declaration, UI_NAMESPACE_KEYS, fact.path)
  const resource = requiredResourceDeclaration(fact, declaration, diagnostic)
  return {
    type: "ui",
    uri: resource.uri,
    integrity: resource.integrity,
  }
}

function requiredResourceDeclaration(
  fact: CamNamespaceFact,
  declaration: CamResourceDeclarationFact | undefined,
  diagnostic: CamFactDiagnostic | undefined,
): CamResourceDeclarationFact {
  if (declaration !== undefined) return declaration
  if (diagnostic !== undefined) {
    throw camErrorFromFactDiagnostic(diagnostic)
  }

  // Earlier fact collection is fail-fast for resource diagnostics. Reaching
  // this means the runtime adapter and fact collector disagree about usability.
  throw new CamError("CAM_INVALID_FIELD", `CAM resource declaration is not usable: ${fact.name}`, fact.path)
}

function firstResourceDiagnosticForNamespace(
  fact: CamNamespaceFact,
  diagnostics: readonly CamFactDiagnostic[],
): CamFactDiagnostic | undefined {
  const prefix = `${fact.path}.`
  return diagnostics.find((diagnostic) => diagnostic.path?.startsWith(prefix))
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
      inputs: parseInputNames(route.inputs, `${path}.inputs`),
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

function parseInputNames(value: unknown, path: string): readonly string[] {
  const source = requiredArray(value, path)
  const names: string[] = []
  const seen = new Set<string>()

  for (const [index, item] of source.entries()) {
    const itemPath = `${path}.${index}`
    const name = requiredNonEmptyString(item, itemPath)
    if (!isExpressionIdentifier(name)) {
      throw new CamError("CAM_INVALID_FIELD", `input name must be an expression identifier: ${name}`, itemPath)
    }
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
      return new CamError("CAM_INVALID_FIELD", diagnostic.message, diagnostic.path)
  }
}
