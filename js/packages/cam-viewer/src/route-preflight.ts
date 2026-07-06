import { routeRequiresAccount } from "@cam/core"
import type { CamDocument } from "@cam/core"

import { CamViewerError } from "./errors.ts"
import type { CamViewerAccount } from "./types.ts"

export function assertViewerRouteAccountAvailable({
  cam,
  route,
  account,
}: {
  readonly cam: CamDocument
  readonly route: string
  readonly account?: CamViewerAccount
}): void {
  if (account === undefined && routeRequiresAccount(cam, route)) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM route requires an account: ${route}`)
  }
}
