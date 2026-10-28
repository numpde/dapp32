import { CAM_ROUTE_CALL_NAMESPACE_TYPES, CAM_READ_ROUTE_THEN_NAMESPACE_TYPES } from "../manifest.ts"
import {
  isRecordObject,
} from "../json.ts"
import { collectCamRouteExpressionDiagnostics } from "./route-expressions.ts"
import type {
  CamNamespaceType,
} from "../manifest.ts"
import {
  camFactDiagnostic,
  type CamFactDiagnostic,
  type CamFactResult,
} from "./diagnostics.ts"

export type CamInvocationFact = {
  readonly resource: string
  readonly path: string
  readonly namespace: string
  readonly namespaceType: CamNamespaceType
  readonly function: string
  readonly args: Record<string, unknown>
}

export type CamRouteResolutionFact = {
  readonly resolve: CamInvocationFact
  readonly target: string
}

export function collectCamRouteResolutionFact({
  resource, path, route, namespaceTypes, declaredInputs,
}: {
  readonly resource: string
  readonly path: string
  readonly route: Record<string, unknown>
  readonly namespaceTypes: ReadonlyMap<string, CamNamespaceType>
  readonly declaredInputs: ReadonlySet<string>
}): CamFactResult<CamRouteResolutionFact> {
  const diagnostics: CamFactDiagnostic[] = []
  const hasResolver = Object.hasOwn(route, "resolve")
  const call = isRecordObject(route.call) ? route.call : undefined
  const hasTarget = call !== undefined && Object.hasOwn(call, "target")
  function invalid(field: string, message: string): void {
    diagnostics.push(camFactDiagnostic({ code: "CAM_FACT_ROUTE_RESOLUTION_INVALID", resource, path: `${path}.${field}`, message }))
  }
  if (!hasResolver && !hasTarget) return { diagnostics }
  if (route.kind !== "write") {
    invalid(hasResolver ? "resolve" : "call.target", "resolved targets require a write route")
    return { diagnostics }
  }
  if (!hasResolver) {
    invalid("call.target", "write call target requires a resolver")
    return { diagnostics }
  }
  const target = call?.target
  if (typeof target !== "string" || !/^\$outputs\.(0|[1-9][0-9]*)$/.test(target)) {
    invalid("call.target", "resolved write target must directly reference one positional resolver address output")
  }
  const result = collectCamInvocationFact({
    resource, path: `${path}.resolve`, invocation: route.resolve, namespaceTypes,
    allowedNamespaceTypes: new Set(["contract"]), purpose: "route resolver",
  })
  diagnostics.push(...result.diagnostics)
  const resolve = result.value
  if (resolve !== undefined) {
    if (resolve.function.startsWith("$")) invalid("resolve.function", "route resolver function must be a static function name or signature")
    diagnostics.push(...collectCamRouteExpressionDiagnostics({
      resource, path: `${path}.resolve.args`, value: resolve.args, declaredInputs,
      allowOutputs: false, outputUnavailableMessage: "resolver arguments cannot reference outputs before the resolver runs",
    }))
  }
  if (diagnostics.length !== 0 || resolve === undefined || typeof target !== "string") return { diagnostics }
  return { value: { resolve, target }, diagnostics }
}

export function collectCamInvocationFact({
  resource,
  path,
  invocation,
  namespaceTypes,
  allowedNamespaceTypes,
  purpose,
  allowTarget,
}: {
  readonly resource: string
  readonly path: string
  readonly invocation: unknown
  readonly namespaceTypes: ReadonlyMap<string, CamNamespaceType>
  readonly allowedNamespaceTypes: ReadonlySet<CamNamespaceType>
  readonly purpose: string
  readonly allowTarget?: boolean
}): CamFactResult<CamInvocationFact> {
  const diagnostics: CamFactDiagnostic[] = []
  if (!isRecordObject(invocation)) {
    diagnostics.push(invocationDiagnostic({
      code: "CAM_FACT_INVOCATION_NOT_OBJECT",
      resource,
      path,
      message: `${purpose} must be an object`,
    }))
    return { diagnostics }
  }

  for (const key of Object.keys(invocation)) {
    if (["namespace", "function", "args"].includes(key) || allowTarget === true && key === "target") continue
    diagnostics.push(invocationDiagnostic({
      code: "CAM_FACT_INVOCATION_FIELD_UNKNOWN", resource, path: `${path}.${key}`,
      message: `${purpose} field is not allowed: ${key}`,
    }))
  }

  const functionName = invocation.function
  if (typeof functionName !== "string" || functionName.length === 0) {
    diagnostics.push(invocationDiagnostic({
      code: "CAM_FACT_INVOCATION_FUNCTION_INVALID",
      resource,
      path: `${path}.function`,
      message: `${purpose} function must be a non-empty string`,
    }))
  }

  const args = invocation.args
  if (!isRecordObject(args)) {
    diagnostics.push(invocationDiagnostic({
      code: "CAM_FACT_INVOCATION_ARGS_INVALID",
      resource,
      path: `${path}.args`,
      message: `${purpose} args must be an object`,
    }))
  }

  const namespace = invocation.namespace
  const namespacePath = `${path}.namespace`
  if (typeof namespace !== "string" || namespace.length === 0) {
    diagnostics.push(invocationDiagnostic({
      code: "CAM_FACT_INVOCATION_NAMESPACE_INVALID",
      resource,
      path: namespacePath,
      message: `${purpose} namespace must be a non-empty string`,
    }))
    return { diagnostics }
  }

  const namespaceType = namespaceTypes.get(namespace)
  if (namespaceType === undefined) {
    diagnostics.push(invocationDiagnostic({
      code: "CAM_FACT_INVOCATION_NAMESPACE_UNKNOWN",
      resource,
      path: namespacePath,
      message: `${purpose} references unknown namespace: ${namespace}`,
    }))
    return { diagnostics }
  }

  if (!allowedNamespaceTypes.has(namespaceType)) {
    diagnostics.push(invocationDiagnostic({
      code: "CAM_FACT_INVOCATION_NAMESPACE_TYPE_INVALID",
      resource,
      path: namespacePath,
      message: `${purpose} references invalid ${namespaceType} namespace: ${namespace}`,
    }))
  }

  if (typeof functionName !== "string" || functionName.length === 0) return { diagnostics }
  if (!isRecordObject(args)) return { diagnostics }
  if (Object.hasOwn(args, "")) {
    diagnostics.push(invocationDiagnostic({
      code: "CAM_FACT_INVOCATION_ARG_NAME_INVALID",
      resource,
      path: `${path}.args`,
      message: `${purpose} argument name must not be empty`,
    }))
    return { diagnostics }
  }
  if (!allowedNamespaceTypes.has(namespaceType)) return { diagnostics }

  return {
    value: {
      resource,
      path,
      namespace,
      namespaceType,
      function: functionName,
      args,
    },
    diagnostics,
  }
}

function invocationDiagnostic({
  code,
  resource,
  path,
  message,
}: {
  readonly code:
    | "CAM_FACT_INVOCATION_NOT_OBJECT"
    | "CAM_FACT_INVOCATION_NAMESPACE_INVALID"
    | "CAM_FACT_INVOCATION_NAMESPACE_UNKNOWN"
    | "CAM_FACT_INVOCATION_NAMESPACE_TYPE_INVALID"
    | "CAM_FACT_INVOCATION_FUNCTION_INVALID"
    | "CAM_FACT_INVOCATION_ARGS_INVALID"
    | "CAM_FACT_INVOCATION_ARG_NAME_INVALID"
    | "CAM_FACT_INVOCATION_FIELD_UNKNOWN"
  readonly resource: string
  readonly path: string
  readonly message: string
}): CamFactDiagnostic {
  return camFactDiagnostic({
    code,
    resource,
    path,
    message,
  })
}

export type CamRouteReviewFact = {
  readonly call: CamInvocationFact
  readonly then: CamInvocationFact
}
export type CamRouteReceiptFact = {
  readonly event: string
  readonly then: CamInvocationFact
  readonly empty?: CamInvocationFact
}
export type CamRoutePresentationsFact = {
  readonly review?: CamRouteReviewFact
  readonly receipt?: CamRouteReceiptFact
}

export function collectCamRoutePresentationsFact({
  resource, path, route, namespaceTypes, declaredInputs,
}: {
  readonly resource: string
  readonly path: string
  readonly route: Record<string, unknown>
  readonly namespaceTypes: ReadonlyMap<string, CamNamespaceType>
  readonly declaredInputs: ReadonlySet<string>
}): CamFactResult<CamRoutePresentationsFact> {
  const diagnostics: CamFactDiagnostic[] = []
  function invalid(code: CamFactDiagnostic["code"], field: string, message: string): void {
    diagnostics.push(camFactDiagnostic({ code, resource, path: `${path}.${field}`, message }))
  }
  function object(field: string, keys: readonly string[]): Record<string, unknown> | undefined {
    if (!Object.hasOwn(route, field)) return undefined
    if (route.kind !== "write") {
      invalid("CAM_FACT_INVOCATION_FIELD_UNKNOWN", field, `${field} is available only on write routes`)
      return undefined
    }
    const value = route[field]
    if (!isRecordObject(value)) {
      invalid("CAM_FACT_INVOCATION_NOT_OBJECT", field, `route ${field} must be an object`)
      return undefined
    }
    for (const key of Object.keys(value)) {
      if (!keys.includes(key)) invalid("CAM_FACT_INVOCATION_FIELD_UNKNOWN", `${field}.${key}`, `route ${field} field is not allowed: ${key}`)
    }
    return value
  }
  function invocation(value: unknown, field: string, contract: boolean, allowOutputs: boolean): CamInvocationFact | undefined {
    const result = collectCamInvocationFact({
      resource, path: `${path}.${field}`, invocation: value, namespaceTypes,
      allowedNamespaceTypes: contract ? CAM_ROUTE_CALL_NAMESPACE_TYPES : CAM_READ_ROUTE_THEN_NAMESPACE_TYPES,
      purpose: `route ${field}`,
    })
    diagnostics.push(...result.diagnostics)
    const fact = result.value
    if (fact === undefined) return undefined
    if (contract && fact.function.startsWith("$")) {
      invalid("CAM_FACT_INVOCATION_FUNCTION_INVALID", `${field}.function`, "review call must name a static contract function or signature")
    }
    diagnostics.push(...collectCamRouteExpressionDiagnostics({
      resource, path: `${path}.${field}.args`, value: fact.args, declaredInputs, allowOutputs,
      outputUnavailableMessage: `outputs are unavailable in ${field} arguments`,
    }))
    return fact
  }
  let review: CamRouteReviewFact | undefined
  const reviewSource = object("review", ["call", "then"])
  if (reviewSource !== undefined) {
    const call = invocation(reviewSource.call, "review.call", true, false)
    const then = invocation(reviewSource.then, "review.then", false, true)
    if (call !== undefined && then !== undefined) review = { call, then }
  }
  let receipt: CamRouteReceiptFact | undefined
  const receiptSource = object("receipt", ["event", "then", "empty"])
  if (receiptSource !== undefined) {
    const event = receiptSource.event
    if (typeof event !== "string" || event.length === 0 || event.startsWith("$")) {
      invalid("CAM_FACT_INVOCATION_FUNCTION_INVALID", "receipt.event", "receipt event must be a static event name")
    }
    const then = invocation(receiptSource.then, "receipt.then", false, true)
    const empty = Object.hasOwn(receiptSource, "empty")
      ? invocation(receiptSource.empty, "receipt.empty", false, false)
      : undefined
    if (typeof event === "string" && event.length !== 0 && then !== undefined) {
      receipt = { event, then, ...(empty === undefined ? {} : { empty }) }
    }
  }
  // Write continuations do not consume mined events; receipt UI owns that phase.
  if (route.kind === "write") {
    const then = isRecordObject(route.then) ? route.then : undefined
    diagnostics.push(...collectCamRouteExpressionDiagnostics({
      resource, path: `${path}.then.args`, value: then?.args, declaredInputs,
      allowOutputs: false,
      outputUnavailableMessage: "write continuation outputs are unavailable",
    }))
  }
  if (diagnostics.length !== 0) return { diagnostics }
  return { value: { ...(review === undefined ? {} : { review }), ...(receipt === undefined ? {} : { receipt }) }, diagnostics }
}
