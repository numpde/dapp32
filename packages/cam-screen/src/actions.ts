import { ScreenError } from "./errors.ts"
import {
  cloneJsonValue,
  createStringMap,
  hasOwn,
  isRecordObject,
  requiredArray,
  requiredNonEmptyString,
  requiredRecord,
  rejectUnknownFields,
} from "./guards.ts"
import { resolveValueAtPath, validateExpressionValue } from "./expressions.ts"
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

export function resolveAction(action: ScreenAction, context: ScreenRuntimeContext): ResolvedScreenAction {
  return resolveActionAtPath(action, context, "action")
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
  validateExpressionValue(args, `${path}.args`)

  return {
    contract: requiredNonEmptyString(source.contract, `${path}.contract`),
    function: requiredNonEmptyString(source.function, `${path}.function`),
    args: args.map((arg) => cloneJsonValue(arg)),
    ...(source.onSuccess === undefined
      ? {}
      : { onSuccess: parseOnSuccessAction(source.onSuccess, `${path}.onSuccess`) }),
  }
}

function parseParams(source: Record<string, unknown>, path: string): Record<string, unknown> {
  const params = createStringMap<unknown>()

  for (const [key, value] of Object.entries(source)) {
    if (key.length === 0) {
      throw new ScreenError("SCREEN_INVALID_FIELD", "parameter name must not be empty", path)
    }

    validateExpressionValue(value, `${path}.${key}`)
    params[key] = cloneJsonValue(value)
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
  params: Record<string, unknown>,
  context: ScreenRuntimeContext,
  path: string,
): Record<string, unknown> {
  const resolved = resolveValueAtPath(params, context, path)
  if (!isRecordObject(resolved)) {
    throw new ScreenError("SCREEN_INVALID_FIELD", "expected resolved parameters object", path)
  }

  return resolved
}
