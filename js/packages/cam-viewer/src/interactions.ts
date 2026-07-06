import {
  hasOwn,
  isRecordObject,
  UI_CALL_NAMESPACE_BY_ELEMENT,
} from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import type { InertRecord, InertValue } from "@cam/protocol"
import {
  resolvedUiButtons,
  resolvedUiInputNames,
} from "@cam/screen"
import type {
  ResolvedButtonNode,
  ResolvedUiNode,
} from "@cam/screen"

import { CamViewerError } from "./errors.ts"

export type RenderedActionInterpretation =
  | {
    readonly type: "navigate"
    readonly route: string
    readonly inputs: InertRecord
  }
  | {
    readonly type: "contractCall"
    readonly route: string
    readonly inputs: InertRecord
  }

export function interpretRenderedAction(cam: CamDocument, action: ResolvedButtonNode): RenderedActionInterpretation {
  if (action.call.namespace !== UI_CALL_NAMESPACE_BY_ELEMENT.Button) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM action must call routes namespace: ${action.call.namespace}`)
  }

  const route = action.call.function
  const camRoute = cam.routes[route]
  if (camRoute === undefined) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM action references unknown route: ${route}`)
  }

  if (camRoute.kind === "read") {
    return {
      type: "navigate",
      route,
      inputs: action.call.args,
    }
  }

  if (camRoute.kind === "write") {
    return {
      type: "contractCall",
      route,
      inputs: action.call.args,
    }
  }

  throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `unsupported CAM route kind: ${camRoute.kind}`)
}

export function assertActionIsRendered(resolvedUi: ResolvedUiNode, action: ResolvedButtonNode): void {
  // Rendered actions are the viewer/session handoff boundary. Re-checking
  // membership here prevents stale or fabricated buttons from bypassing the
  // current resolved UI and jumping directly to manifest routes.
  const rendered = resolvedUiButtons(resolvedUi)
  if (!rendered.some((button) => sameActionCall(button, action))) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "CAM action is not rendered in the current view")
  }
}

export function assertStatePatchTargets(resolvedUi: ResolvedUiNode, patch: InertRecord): void {
  const renderedInputs = new Set(resolvedUiInputNames(resolvedUi))
  for (const name of Object.keys(patch)) {
    if (!renderedInputs.has(name)) {
      throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", `CAM viewer state field has no rendered input: ${name}`)
    }
  }
}

function sameActionCall(left: ResolvedButtonNode, right: ResolvedButtonNode): boolean {
  return left.call.namespace === right.call.namespace
    && left.call.function === right.call.function
    && inertEqual(left.call.args, right.call.args)
}

function inertEqual(left: InertValue, right: InertValue): boolean {
  if (Object.is(left, right)) return true

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((item, index) => inertEqual(item, right[index] as InertValue))
  }

  if (!isRecordObject(left) || !isRecordObject(right)) return false
  const leftRecord = left as InertRecord
  const rightRecord = right as InertRecord

  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  if (leftKeys.length !== rightKeys.length) return false
  return leftKeys.every((key) => hasOwn(rightRecord, key) && inertEqual(leftRecord[key], rightRecord[key]))
}
