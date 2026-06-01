import { CamError } from "./errors.ts"
import { resolveArgs } from "./expressions.ts"
import { hasOwn } from "@cam/protocol"
import type { CamDocument, CamResolvedInvocation, CamRoute, CamRuntimeContext } from "./types.ts"

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
  const expected = new Set(route.inputs)
  const actual = new Set(Object.keys(context.inputs))

  for (const name of route.inputs) {
    if (!actual.has(name)) {
      throw new CamError("CAM_INVALID_FIELD", `missing route input: ${name}`, `routes.${routeName}.inputs`)
    }
  }

  for (const name of actual) {
    if (!expected.has(name)) {
      throw new CamError("CAM_INVALID_FIELD", `unexpected route input: ${name}`, `routes.${routeName}.inputs`)
    }
  }
}
