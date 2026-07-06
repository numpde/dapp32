import { routeRequiresAccount } from "@cam/core"
import type { CamDocument, CamRoute } from "@cam/core"

import { CamViewerError } from "./errors.ts"
import type { CamViewerAccount } from "./types.ts"

export function requireViewerRoute({
  cam,
  route,
  kind,
  account,
  missingMessage,
  wrongKindMessage,
}: {
  readonly cam: CamDocument
  readonly route: string
  readonly kind: CamRoute["kind"]
  readonly account?: CamViewerAccount
  readonly missingMessage: string
  readonly wrongKindMessage: string
}): CamRoute {
  const routeDeclaration = cam.routes[route]
  if (routeDeclaration === undefined) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", missingMessage)
  }
  if (routeDeclaration.kind !== kind) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", wrongKindMessage)
  }
  if (account === undefined && routeRequiresAccount(cam, route)) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM route requires an account: ${route}`)
  }

  return routeDeclaration
}
