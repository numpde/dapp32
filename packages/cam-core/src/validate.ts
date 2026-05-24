import { CamError } from "./errors.ts"
import { validateExpressionValue } from "./expressions.ts"
import type { CamContract, CamDocument, CamRoute } from "./types.ts"

const TOP_LEVEL_KEYS = new Set(["$schema", "cam", "name", "description", "entry", "contracts", "routes"])
const CONTRACT_KEYS = new Set(["abiURI"])
const ROUTE_KEYS = new Set(["contract", "function", "args"])

export function parseCam(input: unknown): CamDocument {
  const source = objectField(input, "")
  rejectUnknownFields(source, TOP_LEVEL_KEYS, "")

  const contracts = parseContracts(objectField(source.contracts, "contracts"))
  const routes = parseRoutes(objectField(source.routes, "routes"), contracts)
  const entry = nonEmptyStringField(source.entry, "entry")

  if (!Object.prototype.hasOwnProperty.call(routes, entry)) {
    throw new CamError("CAM_ENTRY_ROUTE_MISSING", `entry route does not exist: ${entry}`, "entry")
  }

  return {
    ...optionalNonEmptyStringProperty(source, "$schema"),
    cam: nonEmptyStringField(source.cam, "cam"),
    name: nonEmptyStringField(source.name, "name"),
    ...optionalNonEmptyStringProperty(source, "description"),
    entry,
    contracts,
    routes,
  }
}

function parseContracts(source: Record<string, unknown>): Record<string, CamContract> {
  const contracts: Record<string, CamContract> = {}

  for (const [name, value] of Object.entries(source)) {
    if (name.length === 0) {
      throw new CamError("CAM_INVALID_FIELD", "contract name must not be empty", "contracts")
    }

    const path = `contracts.${name}`
    const contract = objectField(value, path)
    rejectUnknownFields(contract, CONTRACT_KEYS, path)

    contracts[name] = {
      abiURI: nonEmptyStringField(contract.abiURI, `${path}.abiURI`),
    }
  }

  return contracts
}

function parseRoutes(
  source: Record<string, unknown>,
  contracts: Record<string, CamContract>,
): Record<string, CamRoute> {
  const routes: Record<string, CamRoute> = {}

  for (const [name, value] of Object.entries(source)) {
    if (name.length === 0) {
      throw new CamError("CAM_INVALID_FIELD", "route name must not be empty", "routes")
    }

    const path = `routes.${name}`
    const route = objectField(value, path)
    rejectUnknownFields(route, ROUTE_KEYS, path)

    const contract = nonEmptyStringField(route.contract, `${path}.contract`)
    if (!Object.prototype.hasOwnProperty.call(contracts, contract)) {
      throw new CamError("CAM_UNKNOWN_CONTRACT", `route references unknown contract: ${contract}`, `${path}.contract`)
    }

    const functionName = nonEmptyStringField(route.function, `${path}.function`)
    const args = requiredArrayField(route.args, `${path}.args`)
    validateExpressionValue(args, `${path}.args`)

    routes[name] = {
      contract,
      function: functionName,
      args,
    }
  }

  return routes
}

function objectField(value: unknown, path: string): Record<string, unknown> {
  if (!isRecordObject(value)) {
    throw new CamError(path === "" ? "CAM_NOT_OBJECT" : "CAM_INVALID_FIELD", "expected an object", path || undefined)
  }

  return value
}

function stringField(value: unknown, path: string): string {
  if (typeof value !== "string") {
    throw new CamError("CAM_INVALID_FIELD", "expected a string", path)
  }

  return value
}

function nonEmptyStringField(value: unknown, path: string): string {
  const string = stringField(value, path)
  if (string.length === 0) {
    throw new CamError("CAM_INVALID_FIELD", "expected a non-empty string", path)
  }

  return string
}

function optionalNonEmptyStringProperty(source: Record<string, unknown>, key: string): Record<string, string> {
  if (source[key] === undefined) {
    // These are document metadata fields. Absence is meaningful and distinct
    // from an empty string, which is rejected below.
    return {}
  }

  return { [key]: nonEmptyStringField(source[key], key) }
}

function requiredArrayField(value: unknown, path: string): readonly unknown[] {
  if (value === undefined) {
    throw new CamError("CAM_INVALID_FIELD", "expected an explicit args array", path)
  }

  if (!Array.isArray(value)) {
    throw new CamError("CAM_INVALID_FIELD", "expected an array", path)
  }

  return value
}

function rejectUnknownFields(source: Record<string, unknown>, allowedKeys: ReadonlySet<string>, path: string): void {
  // V1 is intentionally closed-world. Unknown fields are rejected so older or
  // richer CAM shapes cannot be partially interpreted as stricter V1 documents.
  for (const key of Object.keys(source)) {
    if (!allowedKeys.has(key)) {
      throw new CamError("CAM_INVALID_FIELD", `field is not allowed in CAM 1.0.0: ${key}`, joinPath(path, key))
    }
  }
}

function joinPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  // Parsed CAM JSON should be made of records, arrays, and primitives. This
  // guard selects record-like objects before field validation.
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
