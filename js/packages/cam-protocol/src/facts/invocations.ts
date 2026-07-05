import {
  isRecordObject,
} from "../json.ts"
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

export function collectCamInvocationFact({
  resource,
  path,
  invocation,
  namespaceTypes,
  allowedNamespaceTypes,
  purpose,
}: {
  readonly resource: string
  readonly path: string
  readonly invocation: unknown
  readonly namespaceTypes: ReadonlyMap<string, CamNamespaceType>
  readonly allowedNamespaceTypes: ReadonlySet<CamNamespaceType>
  readonly purpose: string
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
