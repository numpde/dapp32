import {
  camNamespaceResourceURIKey,
  isCamResourceNamespaceType,
  type CamResourceNamespaceType,
} from "../manifest.ts"
import { isRecordObject } from "../json.ts"
import type { CamRootFact } from "./root.ts"
import {
  assertCamSecondaryResourceURI,
} from "../resources.ts"
import {
  camFactDiagnostic,
  type CamFactDiagnostic,
} from "./diagnostics.ts"
import type {
  CamNamespaceFact,
} from "./namespaces.ts"

export type CamResourceDeclarationFact = {
  readonly sourceResource: string
  readonly namespace: string
  readonly namespaceType: CamResourceNamespaceType | "protocol"
  readonly uri: string
  readonly integrity: string
  readonly uriPath: string
  readonly integrityPath: string
}

export function collectCamResourceDeclarationFacts(
  namespaces: readonly CamNamespaceFact[],
  root?: CamRootFact,
): {
  readonly declarations: readonly CamResourceDeclarationFact[]
  readonly diagnostics: readonly CamFactDiagnostic[]
} {
  const declarations: CamResourceDeclarationFact[] = []
  const diagnostics: CamFactDiagnostic[] = []
  for (const namespace of namespaces) {
    const declaration = collectCamResourceDeclarationFact(namespace, diagnostics)
    if (declaration !== undefined) {
      declarations.push(declaration)
    }
  }

  if (root !== undefined) {
    const protocol = root.value.protocol
    if (!isRecordObject(protocol) || Object.keys(protocol).some(key => key !== "uri" && key !== "integrity")) {
      diagnostics.push(camFactDiagnostic({
        code: "CAM_FACT_RESOURCE_URI_INVALID",
        resource: root.resource,
        path: "protocol",
        message: "CAM protocol must be an object containing only uri and integrity",
      }))
    } else {
      const declaration = collectResourceDeclaration({
        resource: root.resource,
        name: "protocol",
        path: "protocol",
        type: "protocol",
        declaration: protocol,
      }, diagnostics)
      if (declaration !== undefined) declarations.push(declaration)
    }
  }
  return { declarations, diagnostics }
}

function collectCamResourceDeclarationFact(
  namespace: CamNamespaceFact,
  diagnostics: CamFactDiagnostic[],
): CamResourceDeclarationFact | undefined {
  if (!isCamResourceNamespaceType(namespace.type)) return undefined
  return collectResourceDeclaration({ ...namespace, type: namespace.type }, diagnostics)
}

function collectResourceDeclaration(
  namespace: {
    readonly resource: string
    readonly name: string
    readonly path: string
    readonly type: CamResourceNamespaceType | "protocol"
    readonly declaration: Record<string, unknown>
  },
  diagnostics: CamFactDiagnostic[],
): CamResourceDeclarationFact | undefined {
  const uriKey = namespace.type === "protocol" ? "uri" : camNamespaceResourceURIKey(namespace.type)
  const uriPath = `${namespace.path}.${uriKey}`
  const integrityPath = `${namespace.path}.integrity`
  const uri = nonEmptyString(namespace.declaration[uriKey])
  const integrity = nonEmptyString(namespace.declaration.integrity)

  if (uri === undefined) {
    diagnostics.push(resourceDiagnostic({
      code: "CAM_FACT_RESOURCE_URI_INVALID",
      namespace,
      path: uriPath,
      message: `CAM resource URI must be a non-empty string: ${namespace.name}`,
    }))
  }

  if (integrity === undefined) {
    diagnostics.push(resourceDiagnostic({
      code: "CAM_FACT_RESOURCE_INTEGRITY_INVALID",
      namespace,
      path: integrityPath,
      message: `CAM resource integrity must be a non-empty string: ${namespace.name}`,
    }))
  }

  if (uri === undefined || integrity === undefined) {
    return undefined
  }

  let uriIsValid = true
  try {
    assertCamSecondaryResourceURI(uri, uriPath)
  } catch (error) {
    uriIsValid = false
    diagnostics.push(resourceDiagnostic({
      code: "CAM_FACT_RESOURCE_URI_POLICY_INVALID",
      namespace,
      path: uriPath,
      message: error instanceof Error ? error.message : String(error),
    }))
  }
  if (!uriIsValid) {
    return undefined
  }

  return {
    sourceResource: namespace.resource,
    namespace: namespace.name,
    namespaceType: namespace.type,
    uri,
    integrity,
    uriPath,
    integrityPath,
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function resourceDiagnostic({
  code,
  namespace,
  path,
  message,
}: {
  readonly code:
    | "CAM_FACT_RESOURCE_URI_INVALID"
    | "CAM_FACT_RESOURCE_URI_POLICY_INVALID"
    | "CAM_FACT_RESOURCE_INTEGRITY_INVALID"
  readonly namespace: { readonly resource: string }
  readonly path: string
  readonly message: string
}): CamFactDiagnostic {
  return camFactDiagnostic({
    code,
    resource: namespace.resource,
    path,
    message,
  })
}
