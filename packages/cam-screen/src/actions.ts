import { ScreenError } from "./errors.ts"
import {
  createStringMap,
  hasOwn,
  isRecordObject,
  requiredArray,
  requiredNonEmptyString,
  requiredRecord,
  rejectUnknownFields,
} from "./guards.ts"
import { parseExpressionPayload, resolveValueAtPath } from "./expressions.ts"
import type { InertRecord, InertValue } from "@cam/core"
import type {
  ContractCallAction,
  NavigateAction,
  ResolvedScreenAction,
  ScreenAction,
  ScreenRuntimeContext,
} from "./types.ts"

const NAVIGATE_ACTION_KEYS = new Set(["route", "params"])
const CONTRACT_CALL_ACTION_KEYS = new Set(["contract", "function", "args", "onSuccess"])

export function parseAction(input: unknown, path: string): ScreenAction {
  const action = requiredRecord(input, path)
  const hasRoute = hasOwn(action, "route")
  const hasContract = hasOwn(action, "contract") || hasOwn(action, "function")

  if (hasRoute && hasContract) {
    throw new ScreenError("SCREEN_INVALID_FIELD", "action must be either navigation or contract call", path)
  }

  if (hasRoute) {
    return parseNavigateAction(action, path)
  }

  if (hasContract) {
    return parseContractCallAction(action, path)
  }

  throw new ScreenError("SCREEN_INVALID_FIELD", "expected navigation or contract call action", path)
}

export function resolveActionAtPath(
  action: ScreenAction,
  context: ScreenRuntimeContext,
  path: string,
): ResolvedScreenAction {
  if (isNavigateAction(action)) {
    return resolveNavigateAction(action, context, path)
  }

  return {
    contract: action.contract,
    function: action.function,
    args: action.args.map((arg, index) => resolveValueAtPath(arg, context, `${path}.args.${index}`)),
    ...(action.onSuccess === undefined
      ? {}
      : { onSuccess: resolveNavigateAction(action.onSuccess, context, `${path}.onSuccess`) }),
  }
}

function parseNavigateAction(source: Record<string, unknown>, path: string): NavigateAction {
  rejectUnknownFields(source, NAVIGATE_ACTION_KEYS, path, (key) => `field is not allowed in navigation action: ${key}`)

  return {
    route: requiredNonEmptyString(source.route, `${path}.route`),
    params: parseParams(requiredRecord(source.params, `${path}.params`), `${path}.params`),
  }
}

function parseContractCallAction(source: Record<string, unknown>, path: string): ContractCallAction {
  rejectUnknownFields(
    source,
    CONTRACT_CALL_ACTION_KEYS,
    path,
    (key) => `field is not allowed in contract call action: ${key}`,
  )

  const args = requiredArray(source.args, `${path}.args`)

  return {
    contract: requiredNonEmptyString(source.contract, `${path}.contract`),
    function: requiredNonEmptyString(source.function, `${path}.function`),
    args: args.map((arg, index) => parseExpressionPayload(arg, `${path}.args.${index}`)),
    ...(source.onSuccess === undefined
      ? {}
      : { onSuccess: parseOnSuccessAction(source.onSuccess, `${path}.onSuccess`) }),
  }
}

function parseParams(source: Record<string, unknown>, path: string): InertRecord {
  const params = createStringMap<InertValue>()

  for (const [key, value] of Object.entries(source)) {
    if (key.length === 0) {
      throw new ScreenError("SCREEN_INVALID_FIELD", "parameter name must not be empty", path)
    }

    params[key] = parseExpressionPayload(value, `${path}.${key}`)
  }

  return params
}

function resolveNavigateAction(
  action: NavigateAction,
  context: ScreenRuntimeContext,
  path: string,
): NavigateAction {
  return {
    route: action.route,
    params: resolveParams(action.params, context, `${path}.params`),
  }
}

function isNavigateAction(action: ScreenAction): action is NavigateAction {
  return "route" in action
}

function parseOnSuccessAction(input: unknown, path: string): NavigateAction {
  const action = parseAction(input, path)
  if (!isNavigateAction(action)) {
    throw new ScreenError("SCREEN_INVALID_FIELD", "onSuccess action must be navigation", path)
  }

  return action
}

function resolveParams(
  params: InertRecord,
  context: ScreenRuntimeContext,
  path: string,
): InertRecord {
  const resolved = resolveValueAtPath(params, context, path)
  if (!isRecordObject(resolved)) {
    throw new ScreenError("SCREEN_INVALID_FIELD", "expected resolved parameters object", path)
  }

  return resolved as InertRecord
}
