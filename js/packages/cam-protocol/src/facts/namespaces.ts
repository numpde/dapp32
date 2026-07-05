import {
  isRecordObject,
} from "../json.ts"
import {
  isCamNamespaceType,
  type CamNamespaceType,
} from "../manifest.ts"
import {
  CAM_CONTRACT_NAMESPACE_PREFIX,
  CAM_ROUTES_NAMESPACE,
  CAM_UI_NAMESPACE,
  isCamNamespaceNameForType,
} from "../namespaces.ts"
import {
  camFactDiagnostic,
  type CamFactDiagnostic,
  type CamFactDiagnosticCode,
} from "./diagnostics.ts"
import type {
  CamRootFact,
} from "./root.ts"

export type CamNamespaceFact = {
  readonly resource: string
  readonly path: string
  readonly name: string
  readonly type: CamNamespaceType
  readonly declaration: Record<string, unknown>
}

export function collectCamNamespaceFacts(root: CamRootFact): {
  readonly namespaces: readonly CamNamespaceFact[]
  readonly diagnostics: readonly CamFactDiagnostic[]
} {
  const namespaces: CamNamespaceFact[] = []
  const diagnostics: CamFactDiagnostic[] = []
  const rawNamespaces = root.value.namespaces
  if (!isRecordObject(rawNamespaces)) {
    diagnostics.push(namespaceDiagnostic({
      code: "CAM_FACT_NAMESPACES_NOT_OBJECT",
      resource: root.resource,
      path: "namespaces",
      message: "CAM namespaces must be an object",
    }))
    return { namespaces, diagnostics }
  }

  for (const [name, declaration] of Object.entries(rawNamespaces)) {
    const fact = collectCamNamespaceFact(root.resource, name, declaration, diagnostics)
    if (fact !== undefined) {
      namespaces.push(fact)
    }
  }

  return { namespaces, diagnostics }
}

function collectCamNamespaceFact(
  resource: string,
  name: string,
  declaration: unknown,
  diagnostics: CamFactDiagnostic[],
): CamNamespaceFact | undefined {
  if (name.length === 0) {
    diagnostics.push(namespaceDiagnostic({
      code: "CAM_FACT_NAMESPACE_NAME_EMPTY",
      resource,
      path: "namespaces",
      message: "namespace name must not be empty",
    }))
    return undefined
  }
  const basePath = `namespaces.${name}`
  if (!isRecordObject(declaration)) {
    diagnostics.push(namespaceDiagnostic({
      code: "CAM_FACT_NAMESPACE_NOT_OBJECT",
      resource,
      path: basePath,
      message: `namespace must be an object: ${name}`,
    }))
    return undefined
  }

  const rawType = declaration.type
  if (typeof rawType !== "string" || rawType.length === 0) {
    diagnostics.push(namespaceDiagnostic({
      code: "CAM_FACT_NAMESPACE_TYPE_INVALID",
      resource,
      path: `${basePath}.type`,
      message: `namespace type must be a non-empty string: ${name}`,
    }))
    return undefined
  }

  if (!isCamNamespaceType(rawType)) {
    diagnostics.push(namespaceDiagnostic({
      code: "CAM_FACT_NAMESPACE_TYPE_INVALID",
      resource,
      path: `${basePath}.type`,
      message: `unknown namespace type: ${rawType}`,
    }))
    return undefined
  }

  if (!isCamNamespaceNameForType(name, rawType)) {
    diagnostics.push(namespaceDiagnostic({
      code: "CAM_FACT_NAMESPACE_NAME_INVALID",
      resource,
      path: basePath,
      message: namespaceNameMessage(rawType),
    }))
    return undefined
  }

  return {
    resource,
    path: basePath,
    name,
    type: rawType,
    declaration,
  }
}

function namespaceNameMessage(type: CamNamespaceType): string {
  switch (type) {
    case "contract":
      return `contract namespace must be ${CAM_CONTRACT_NAMESPACE_PREFIX}<name>`
    case "routes":
      return `routes namespace must be named ${CAM_ROUTES_NAMESPACE}`
    case "ui":
      return `ui namespace must be named ${CAM_UI_NAMESPACE}`
  }
}

function namespaceDiagnostic({
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
