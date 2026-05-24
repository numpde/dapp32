import { CamError } from "./errors.ts"
import { validateExpressionValue } from "./expressions.ts"
import {
  hasOwn,
  isRecordObject,
  requiredArray,
  requiredNonEmptyString,
  requiredRecord,
} from "./guards.ts"
import type { CamContract, CamDocument, CamRoute } from "./types.ts"

const TOP_LEVEL_KEYS = new Set(["$schema", "cam", "name", "description", "entry", "contracts", "routes"])
const CONTRACT_KEYS = new Set(["abiURI"])
const ROUTE_KEYS = new Set(["contract", "function", "args"])

export function parseCam(input: unknown): CamDocument {
  const source = requiredRecord(input, "")
  rejectUnknownFields(source, TOP_LEVEL_KEYS, "")

  const contracts = parseContracts(requiredRecord(source.contracts, "contracts"))
  const routes = parseRoutes(requiredRecord(source.routes, "routes"), contracts)
  const entry = requiredNonEmptyString(source.entry, "entry")

  if (!hasOwn(routes, entry)) {
    throw new CamError("CAM_ENTRY_ROUTE_MISSING", `entry route does not exist: ${entry}`, "entry")
  }

  return {
    ...optionalNonEmptyStringProperty(source, "$schema"),
    cam: requiredNonEmptyString(source.cam, "cam"),
    name: requiredNonEmptyString(source.name, "name"),
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
    const contract = requiredRecord(value, path)
    rejectUnknownFields(contract, CONTRACT_KEYS, path)

    contracts[name] = {
      abiURI: requiredNonEmptyString(contract.abiURI, `${path}.abiURI`),
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
    const route = requiredRecord(value, path)
    rejectUnknownFields(route, ROUTE_KEYS, path)

    const contract = requiredNonEmptyString(route.contract, `${path}.contract`)
    if (!hasOwn(contracts, contract)) {
      throw new CamError("CAM_UNKNOWN_CONTRACT", `route references unknown contract: ${contract}`, `${path}.contract`)
    }

    const functionName = requiredNonEmptyString(route.function, `${path}.function`)
    const args = requiredArray(route.args, `${path}.args`)
    validateExpressionValue(args, `${path}.args`)

    routes[name] = {
      contract,
      function: functionName,
      args: args.map((arg) => cloneJsonValue(arg)),
    }
  }

  return routes
}

function cloneJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item))
  }

  if (isRecordObject(value)) {
    // parseCam returns a normalized document snapshot, not live references into
    // the caller's parsed JSON object.
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]),
    )
  }

  return value
}

function optionalNonEmptyStringProperty(source: Record<string, unknown>, key: string): Record<string, string> {
  if (!hasOwn(source, key)) {
    // These are document metadata fields. Absence is meaningful and distinct
    // from an empty string or explicit undefined, which are rejected below.
    return {}
  }

  return { [key]: requiredNonEmptyString(source[key], key) }
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
