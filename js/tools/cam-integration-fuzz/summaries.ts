import type {
  ResolvedButtonNode,
} from "../../packages/cam-screen/dist/index.js"
import {
  resolvedUiButtons,
} from "../../packages/cam-screen/dist/index.js"
import type {
  CamViewerLoadedSnapshot,
  CamViewerPreparedContractCall,
} from "../../packages/cam-viewer/dist/index.js"
import type {
  JsonObject,
} from "./events.ts"

export function actionSummaries(actions: readonly ResolvedButtonNode[]): readonly JsonObject[] {
  return actions.map((action) => actionSummary(action))
}

export function actionSummary(action: ResolvedButtonNode): JsonObject {
  return {
    element: action.element,
    props: action.props,
    call: action.call,
  }
}

export function contractCallSummary(call: CamViewerPreparedContractCall): JsonObject {
  return {
    route: call.route,
    address: call.address,
    function: call.function,
    args: call.args,
  }
}

export function snapshotSummary(snapshot: CamViewerLoadedSnapshot): JsonObject {
  return {
    route: snapshot.route,
    inputs: snapshot.inputs,
    state: snapshot.state,
    values: snapshot.values,
    actions: actionSummaries(resolvedUiButtons(snapshot.resolvedUi)),
  }
}
