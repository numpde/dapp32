import { CamError } from "./errors.ts"
import { resolveArgs } from "./expressions.ts"
import type { CamDocument, CamRouteCall, CamRuntimeContext } from "./types.ts"

export function resolveRouteCall(
  cam: CamDocument,
  routeName: string,
  context: CamRuntimeContext,
): CamRouteCall {
  const route = cam.routes[routeName]
  if (route === undefined) {
    throw new CamError("CAM_INVALID_FIELD", `route does not exist: ${routeName}`, `routes.${routeName}`)
  }

  if (!Object.prototype.hasOwnProperty.call(cam.contracts, route.contract)) {
    throw new CamError(
      "CAM_UNKNOWN_CONTRACT",
      `route references unknown contract: ${route.contract}`,
      `routes.${routeName}.contract`,
    )
  }

  return {
    contract: route.contract,
    function: route.function,
    args: resolveArgs(route.args, context),
  }
}
