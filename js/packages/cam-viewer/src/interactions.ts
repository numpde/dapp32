import {
  hasOwn,
  isRecordObject,
  UI_CALL_NAMESPACE_BY_ELEMENT,
} from "@cam/protocol"
import type { CamDocument } from "@cam/core"
import type { InertRecord, InertValue } from "@cam/protocol"
import {
  resolvedUiButtons,
  forEachResolvedUiNode,
} from "@cam/screen"
import type {
  ResolvedButtonNode,
  ResolvedUiNode,
} from "@cam/screen"

import { CamViewerError } from "./errors.ts"
import type { CamViewerActionKind } from "./types.ts"

export function renderedActionKind(cam: CamDocument, action: ResolvedButtonNode): CamViewerActionKind {
  if (action.call.namespace !== UI_CALL_NAMESPACE_BY_ELEMENT.Button) return "unsupported"
  const route = cam.routes[action.call.function]
  if (route === undefined) return "unsupported"
  return route.kind === "read" ? "navigate" : "contractCall"
}

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
  const kind = renderedActionKind(cam, action)
  if (kind === "unsupported") {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM action references unknown route: ${route}`)
  }

  return { type: kind, route, inputs: action.call.args }
}

export function assertActionIsRendered(resolvedUi: ResolvedUiNode, action: ResolvedButtonNode): ResolvedButtonNode {
  // Rendered actions are the viewer/session handoff boundary. Re-checking
  // membership here prevents stale or fabricated buttons from bypassing the
  // current resolved UI and jumping directly to manifest routes.
  const rendered = resolvedUiButtons(resolvedUi)
  const matching = rendered.filter((button) => sameActionCall(button, action))
  if (matching.length === 0) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "CAM action is not rendered in the current view")
  }
  const enabled = matching.find((button) => button.disabled !== true)
  if (enabled === undefined) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "CAM action is disabled in the current view")
  }
  return enabled
}

export function assertStatePatchTargets(resolvedUi: ResolvedUiNode, patch: InertRecord): void {
  const renderedInputs = new Set<string>()
  const enabledInputs = new Set<string>()
  forEachResolvedUiNode(resolvedUi, (node) => {
    if (node.element !== "TextField" && node.element !== "NftMetadataField" && node.element !== "DocumentHashField" && node.element !== "AmountField" && node.element !== "NonNegativeIntegerField" && node.element !== "DurationField") return
    renderedInputs.add(node.state.key)
    if (node.disabled !== true) enabledInputs.add(node.state.key)
  })
  for (const name of Object.keys(patch)) {
    if (!renderedInputs.has(name)) {
      throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", `CAM viewer state field has no rendered input: ${name}`)
    }
    if (!enabledInputs.has(name)) {
      throw new CamViewerError("CAM_VIEWER_INVALID_INERT_VALUE", `CAM viewer state field is disabled in the current view: ${name}`)
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
