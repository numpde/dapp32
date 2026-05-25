import { CamError } from "./errors.ts"
import { validateExpressionValue } from "./expressions.ts"
import {
  cloneJsonValue,
  createStringMap,
  hasOwn,
  requiredArray,
  requiredNonEmptyString,
  requiredRecord,
  rejectUnknownFields,
} from "./guards.ts"
import { CAM_VERSION } from "./constants.ts"
import type { CamContract, CamDocument, CamRoute } from "./types.ts"

const TOP_LEVEL_KEYS = new Set(["cam", "entry", "contracts", "routes"])
const CONTRACT_KEYS = new Set(["abiURI"])
const ROUTE_KEYS = new Set(["contract", "function", "args"])

export function parseCam(input: unknown): CamDocument {
  const source = requiredRecord(input, "")
  rejectUnknownCamFields(source, TOP_LEVEL_KEYS, "")

  const contracts = parseContracts(requiredRecord(source.contracts, "contracts"))
  const routes = parseRoutes(requiredRecord(source.routes, "routes"), contracts)
  const entry = requiredNonEmptyString(source.entry, "entry")

  if (!hasOwn(routes, entry)) {
    throw new CamError("CAM_ENTRY_ROUTE_MISSING", `entry route does not exist: ${entry}`, "entry")
  }

  return {
    cam: parseCamVersion(source.cam),
    entry,
    contracts,
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

function parseContracts(source: Record<string, unknown>): Record<string, CamContract> {
  const contracts = createStringMap<CamContract>()

  for (const [name, value] of Object.entries(source)) {
    if (name.length === 0) {
      throw new CamError("CAM_INVALID_FIELD", "contract name must not be empty", "contracts")
    }

    const path = `contracts.${name}`
    const contract = requiredRecord(value, path)
    rejectUnknownCamFields(contract, CONTRACT_KEYS, path)

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
  const routes = createStringMap<CamRoute>()

  for (const [name, value] of Object.entries(source)) {
    if (name.length === 0) {
      throw new CamError("CAM_INVALID_FIELD", "route name must not be empty", "routes")
    }

    const path = `routes.${name}`
    const route = requiredRecord(value, path)
    rejectUnknownCamFields(route, ROUTE_KEYS, path)

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

function rejectUnknownCamFields(
  source: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  path: string,
): void {
  // V1 is intentionally closed-world. Unknown fields are rejected so older or
  // richer CAM shapes cannot be partially interpreted as stricter V1 documents.
  rejectUnknownFields(source, allowedKeys, path, (key) => `field is not allowed in CAM ${CAM_VERSION}: ${key}`)
}
