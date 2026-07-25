import { CamError } from "./errors.ts"
import { resolveArgs, resolveExpressionValue } from "./expressions.ts"
import {
  collectExpressionReferences,
  diffNameSets,
  hasOwn,
} from "@cam/protocol"
import type { CamRuntimeContext, InertValue } from "@cam/protocol"
import type { CamDocument, CamResolvedInvocation, CamResolvedRouteCall, CamRoute } from "./types.ts"

export function resolveRouteCall(
  cam: CamDocument,
  routeName: string,
  context: CamRuntimeContext,
): CamResolvedRouteCall {
  const route = routeForName(cam, routeName)
  assertRouteInputs(route, routeName, context)

  const call = {
    namespace: route.call.namespace,
    function: route.call.function,
    args: resolveArgs(route.call.args, context),
  }
  if (route.kind === "read" || route.value === undefined) {
    return call
  }

  return {
    ...call,
    value: resolveExpressionValue(route.value, context, `routes.${routeName}.value`),
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
  const surfaces: readonly InertValue[] = [
    route.call.args,
    route.then.args,
    ...(route.kind === "write" && route.value !== undefined ? [route.value] : []),
  ]
  return surfaces.some((value) =>
    collectExpressionReferences(value, { numericSegments: true })
      .some((occurrence) => occurrence.reference?.root === "account")
  )
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
