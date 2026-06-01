import { CamError } from "./errors.ts"
import { resolveArgs } from "./expressions.ts"
import { hasOwn } from "@cam/protocol"
import type { CamDocument, CamResolvedInvocation, CamRuntimeContext } from "./types.ts"

export function resolveRouteCall(
  cam: CamDocument,
  routeName: string,
  context: CamRuntimeContext,
): CamResolvedInvocation {
  const route = routeForName(cam, routeName)

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
