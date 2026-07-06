import {
  createContext,
  resolveRouteThen,
} from "@cam/core"
import {
  CAM_UI_NAMESPACE,
  createStringMap,
} from "@cam/protocol"
import {
  UiError,
  resolveInitialUiNode,
  resolveUiNode,
} from "@cam/screen"
import type { CamDocument } from "@cam/core"
import type { CamHost } from "@cam/evm-viem"
import type { InertRecord, InertValue } from "@cam/protocol"
import type {
  ResolvedUiNode,
  UiDocument,
  UiRuntimeContext,
} from "@cam/screen"

import { CamViewerError } from "./errors.ts"
import type { CamViewerAccount } from "./types.ts"

export function resolveViewerInitialUi({
  cam,
  ui,
  host,
  account,
  route,
  inputs,
  values,
}: {
  readonly cam: CamDocument
  readonly ui: UiDocument
  readonly host: CamHost
  readonly account?: CamViewerAccount
  readonly route: string
  readonly inputs: InertRecord
  readonly values: readonly InertValue[]
}): {
  readonly state: InertRecord
  readonly resolvedUi: ResolvedUiNode
} {
  const then = resolveUiContinuation({
    cam,
    host,
    ...(account === undefined ? {} : { account }),
    route,
    inputs,
    values,
  })

  // UI initial resolution is deliberately two-pass: input nodes establish the
  // state values first, then action nodes can safely read $state.
  try {
    return resolveInitialUiNode(ui, then.function, then.args, uiContext({
      host,
      ...(account === undefined ? {} : { account }),
      inputs,
      values,
      state: createStringMap<InertValue>(),
    }))
  } catch (cause) {
    throw accountAwareUiError(cause, account)
  }
}

export function resolveViewerCurrentUi({
  cam,
  ui,
  host,
  account,
  route,
  inputs,
  values,
  state,
}: {
  readonly cam: CamDocument
  readonly ui: UiDocument
  readonly host: CamHost
  readonly account?: CamViewerAccount
  readonly route: string
  readonly inputs: InertRecord
  readonly values: readonly InertValue[]
  readonly state: InertRecord
}): ResolvedUiNode {
  const then = resolveUiContinuation({
    cam,
    host,
    ...(account === undefined ? {} : { account }),
    route,
    inputs,
    values,
  })

  try {
    return resolveUiNode(ui, then.function, then.args, uiContext({
      host,
      ...(account === undefined ? {} : { account }),
      inputs,
      values,
      state,
    }))
  } catch (cause) {
    throw accountAwareUiError(cause, account)
  }
}

function resolveUiContinuation({
  cam,
  host,
  account,
  route,
  inputs,
  values,
}: {
  readonly cam: CamDocument
  readonly host: CamHost
  readonly account?: CamViewerAccount
  readonly route: string
  readonly inputs: InertRecord
  readonly values: readonly InertValue[]
}) {
  const then = resolveRouteThen(cam, route, routeContext({
    host,
    ...(account === undefined ? {} : { account }),
    inputs,
    outputs: values,
  }))
  if (then.namespace !== CAM_UI_NAMESPACE) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", `CAM read route must continue to ui namespace: ${route}`)
  }

  return then
}

function uiContext({
  host,
  account,
  inputs,
  values,
  state,
}: {
  readonly host: CamHost
  readonly account?: CamViewerAccount
  readonly inputs: InertRecord
  readonly values: readonly InertValue[]
  readonly state: InertRecord
}): UiRuntimeContext {
  return {
    ...routeContext({
      host,
      ...(account === undefined ? {} : { account }),
      inputs,
      outputs: values,
    }),
    state,
  }
}

function routeContext({
  host,
  account,
  inputs,
  outputs,
}: {
  readonly host: CamHost
  readonly account?: CamViewerAccount
  readonly inputs: InertRecord
  readonly outputs: readonly InertValue[]
}) {
  return createContext({
    host,
    ...(account === undefined ? {} : { account }),
    inputs,
    outputs,
  })
}

function accountAwareUiError(cause: unknown, account?: CamViewerAccount): never {
  if (
    account === undefined
    && cause instanceof UiError
    && cause.code === "UI_UNRESOLVED_VALUE"
    && cause.unresolvedRoot === "account"
  ) {
    throw new CamViewerError("CAM_VIEWER_ACTION_UNSUPPORTED", "CAM UI requires an account", cause)
  }

  throw cause
}
