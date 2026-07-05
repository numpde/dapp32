import {
  resolvedUiButtons,
} from "../../packages/cam-screen/dist/index.js"
import type {
  CamViewerLoadedSnapshot,
  CamViewerSnapshot,
} from "../../packages/cam-viewer/dist/index.js"

export function assertResolvedSnapshot(snapshot: CamViewerSnapshot): void {
  const loaded = requireLoadedSnapshot(snapshot)
  if (resolvedUiButtons(loaded.resolvedUi).some((action) => action.call.namespace !== "routes")) {
    throw new Error(`route ${loaded.route}: resolved action outside routes namespace`)
  }
}

export function requireLoadedSnapshot(snapshot: CamViewerSnapshot): CamViewerLoadedSnapshot {
  if (
    snapshot.route === undefined
    || snapshot.inputs === undefined
    || snapshot.state === undefined
    || snapshot.uiURI === undefined
    || snapshot.resolvedUi === undefined
    || snapshot.values === undefined
  ) {
    throw new Error("viewer snapshot is not loaded")
  }

  return {
    ...(snapshot.account === undefined ? {} : { account: snapshot.account }),
    route: snapshot.route,
    inputs: snapshot.inputs,
    state: snapshot.state,
    uiURI: snapshot.uiURI,
    resolvedUi: snapshot.resolvedUi,
    values: snapshot.values,
  }
}
