import { CamError } from "./errors.ts"
import { resolveArgs } from "./expressions.ts"
import {
  diffNameSets,
  hasOwn,
  isRecordObject,
  parseExpressionReference,
} from "@cam/protocol"
import type { CamRuntimeContext } from "@cam/protocol"
import type { CamDocument, CamResolvedInvocation, CamRoute } from "./types.ts"

export function resolveRouteCall(
  cam: CamDocument,
  routeName: string,
  context: CamRuntimeContext,
): CamResolvedInvocation {
  const route = routeForName(cam, routeName)
  assertRouteInputs(route, routeName, context)

  return {
    namespace: route.call.namespace,
    function: route.call.function,
    args: resolveArgs(route.call.args, context),
  }
}

export function resolveRouteThen(
  cam: CamDocument,
  routeName: string,
  context: CamRuntimeContext,
): CamResolvedInvocation {
  const route = routeForName(cam, routeName)
  assertRouteInputs(route, routeName, context)

  return {
    namespace: route.then.namespace,
    function: route.then.function,
    args: resolveArgs(route.then.args, context),
  }
}

export function routeRequiresAccount(cam: CamDocument, routeName: string): boolean {
  const route = routeForName(cam, routeName)
  // This is a preflight extractor, not another expression parser. Validation
  // owns expression grammar; this only answers whether an anonymous session can
  // attempt the route at all.
  return argsReferenceAccount(route.call.args) || argsReferenceAccount(route.then.args)
}

function routeForName(cam: CamDocument, routeName: string) {
  if (!hasOwn(cam.routes, routeName)) {
    throw new CamError("CAM_INVALID_FIELD", `route does not exist: ${routeName}`, `routes.${routeName}`)
  }

  return cam.routes[routeName]
}

function assertRouteInputs(route: CamRoute, routeName: string, context: CamRuntimeContext): void {
  // `route.inputs` is the callable interface for a route. Expressions may not
  // touch every input on every branch, so enforce the interface before resolving
  // route calls or continuations.
  diffNameSets({
    expectedNames: route.inputs,
    actualNames: Object.keys(context.inputs),
    onMissing: (name) => {
      throw new CamError("CAM_INVALID_FIELD", `missing route input: ${name}`, `routes.${routeName}.inputs`)
    },
    onUnexpected: (name) => {
      throw new CamError("CAM_INVALID_FIELD", `unexpected route input: ${name}`, `routes.${routeName}.inputs`)
    },
  })
}

function argsReferenceAccount(value: unknown): boolean {
  if (typeof value === "string") {
    return parseExpressionReference(value, { numericSegments: true })?.root === "account"
  }

  if (Array.isArray(value)) {
    return value.some((item) => argsReferenceAccount(item))
  }

  if (isRecordObject(value)) {
    return Object.values(value).some((item) => argsReferenceAccount(item))
  }

  return false
}
