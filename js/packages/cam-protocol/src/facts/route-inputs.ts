import {
  isExpressionIdentifier,
} from "../expressions.ts"
import {
  camFactDiagnostic,
  type CamFactDiagnostic,
  type CamFactDiagnosticCode,
  type CamFactResult,
} from "./diagnostics.ts"

export type CamRouteInputsFact = {
  readonly resource: string
  readonly path: string
  readonly inputs: readonly string[]
}

export function collectCamRouteInputsFact({
  resource,
  path,
  routeName,
  inputs,
}: {
  readonly resource: string
  readonly path: string
  readonly routeName: string
  readonly inputs: unknown
}): CamFactResult<CamRouteInputsFact> {
  const diagnostics: CamFactDiagnostic[] = []
  if (!Array.isArray(inputs)) {
    diagnostics.push(routeInputDiagnostic({
      code: "CAM_FACT_ROUTE_INPUTS_NOT_ARRAY",
      resource,
      path,
      message: `route inputs must be an array: ${routeName}`,
    }))
    return { diagnostics }
  }

  const seen = new Set<string>()
  const validatedInputs: string[] = []
  for (const [index, input] of inputs.entries()) {
    const itemPath = `${path}.${index}`
    if (typeof input !== "string" || input.length === 0) {
      diagnostics.push(routeInputDiagnostic({
        code: "CAM_FACT_ROUTE_INPUT_NAME_INVALID",
        resource,
        path: itemPath,
        message: `route input name must be a non-empty string: ${routeName}`,
      }))
      continue
    }
    if (!isExpressionIdentifier(input)) {
      diagnostics.push(routeInputDiagnostic({
        code: "CAM_FACT_ROUTE_INPUT_NAME_INVALID",
        resource,
        path: itemPath,
        message: `route input name must be an expression identifier: ${input}`,
      }))
      continue
    }
    if (seen.has(input)) {
      diagnostics.push(routeInputDiagnostic({
        code: "CAM_FACT_ROUTE_INPUT_NAME_DUPLICATE",
        resource,
        path: itemPath,
        message: `duplicate route input name: ${input}`,
      }))
    }
    seen.add(input)
    validatedInputs.push(input)
  }

  if (validatedInputs.length !== inputs.length || seen.size !== inputs.length) {
    return { diagnostics }
  }

  return {
    value: {
      resource,
      path,
      inputs: validatedInputs,
    },
    diagnostics,
  }
}

function routeInputDiagnostic({
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
