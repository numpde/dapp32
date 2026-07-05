export type CamFactDiagnosticCode =
  | "CAM_FACT_ROOT_NOT_OBJECT"
  | "CAM_FACT_ROOT_VERSION_INVALID"
  | "CAM_FACT_ROOT_FIELD_UNKNOWN"
  | "CAM_FACT_NAMESPACES_NOT_OBJECT"
  | "CAM_FACT_NAMESPACE_NAME_EMPTY"
  | "CAM_FACT_NAMESPACE_NOT_OBJECT"
  | "CAM_FACT_NAMESPACE_TYPE_INVALID"
  | "CAM_FACT_NAMESPACE_NAME_INVALID"
  | "CAM_FACT_RESOURCE_URI_INVALID"
  | "CAM_FACT_RESOURCE_URI_POLICY_INVALID"
  | "CAM_FACT_RESOURCE_INTEGRITY_INVALID"
  | "CAM_FACT_INVOCATION_NOT_OBJECT"
  | "CAM_FACT_INVOCATION_NAMESPACE_INVALID"
  | "CAM_FACT_INVOCATION_NAMESPACE_UNKNOWN"
  | "CAM_FACT_INVOCATION_NAMESPACE_TYPE_INVALID"
  | "CAM_FACT_INVOCATION_FUNCTION_INVALID"
  | "CAM_FACT_INVOCATION_ARGS_INVALID"
  | "CAM_FACT_INVOCATION_ARG_NAME_INVALID"
  | "CAM_FACT_ROUTE_INPUTS_NOT_ARRAY"
  | "CAM_FACT_ROUTE_INPUT_NAME_INVALID"
  | "CAM_FACT_ROUTE_INPUT_NAME_DUPLICATE"

export type CamFactDiagnostic = {
  readonly code: CamFactDiagnosticCode
  readonly resource: string
  readonly message: string
  readonly path?: string
}

export type CamFactResult<T> = {
  readonly value?: T
  readonly diagnostics: readonly CamFactDiagnostic[]
}

export function camFactDiagnostic({
  code,
  resource,
  path,
  message,
}: {
  readonly code: CamFactDiagnosticCode
  readonly resource: string
  readonly path?: string | undefined
  readonly message: string
}): CamFactDiagnostic {
  const diagnostic = {
    code,
    resource,
    message,
  } satisfies Omit<CamFactDiagnostic, "path">

  if (path === undefined) {
    return diagnostic
  }

  return {
    ...diagnostic,
    path,
  }
}
