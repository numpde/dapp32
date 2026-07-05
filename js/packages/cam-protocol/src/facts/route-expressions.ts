import {
  collectExpressionReferences,
  isExpressionIdentifier,
} from "../expressions.ts"
import {
  CAM_ROUTE_CONTEXT_KEYS,
} from "../runtime-context.ts"
import {
  camFactDiagnostic,
  type CamFactDiagnostic,
  type CamFactDiagnosticCode,
} from "./diagnostics.ts"

export function collectCamRouteExpressionDiagnostics({
  resource,
  value,
  path,
  declaredInputs,
  allowOutputs,
  outputUnavailableMessage,
}: {
  readonly resource: string
  readonly value: unknown
  readonly path: string
  readonly declaredInputs: ReadonlySet<string>
  readonly allowOutputs: boolean
  readonly outputUnavailableMessage: string
}): readonly CamFactDiagnostic[] {
  const diagnostics: CamFactDiagnostic[] = []
  for (const occurrence of collectExpressionReferences(value, { numericSegments: true }, path)) {
    const occurrencePath = occurrence.path
    if (occurrence.syntaxError !== undefined) {
      diagnostics.push(routeExpressionDiagnostic({
        code: "CAM_FACT_ROUTE_EXPRESSION_SYNTAX_INVALID",
        resource,
        path: occurrencePath,
        message: occurrence.syntaxError,
      }))
      continue
    }

    const reference = occurrence.reference
    if (reference === undefined) continue

    const { root, segments } = reference
    const firstSegment = segments[0]
    if (!CAM_ROUTE_CONTEXT_KEYS.has(root)) {
      diagnostics.push(routeExpressionDiagnostic({
        code: "CAM_FACT_ROUTE_EXPRESSION_ROOT_INVALID",
        resource,
        path: occurrencePath,
        message: `route expression root is not supported: ${root}`,
      }))
      continue
    }

    if (root === "inputs" && firstSegment !== undefined) {
      if (!isExpressionIdentifier(firstSegment)) {
        diagnostics.push(routeExpressionDiagnostic({
          code: "CAM_FACT_ROUTE_EXPRESSION_INPUT_INVALID",
          resource,
          path: occurrencePath,
          message: `route expression input segment must be a declared name: ${firstSegment}`,
        }))
      } else if (!declaredInputs.has(firstSegment)) {
        diagnostics.push(routeExpressionDiagnostic({
          code: "CAM_FACT_ROUTE_EXPRESSION_INPUT_UNDECLARED",
          resource,
          path: occurrencePath,
          message: `route expression references undeclared input: ${firstSegment}`,
        }))
      }
    }

    if (root === "outputs" && !allowOutputs) {
      diagnostics.push(routeExpressionDiagnostic({
        code: "CAM_FACT_ROUTE_EXPRESSION_OUTPUT_UNAVAILABLE",
        resource,
        path: occurrencePath,
        message: outputUnavailableMessage,
      }))
    }
  }

  return diagnostics
}

function routeExpressionDiagnostic({
  code,
  resource,
  path,
  message,
}: {
  readonly code: CamFactDiagnosticCode
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
