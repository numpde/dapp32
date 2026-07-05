import {
  collectCamRootFact,
} from "@cam/protocol"
import type {
  CamFactDiagnostic,
} from "@cam/protocol"

import {
  conformanceIssue,
  conformanceRules,
  type CamConformanceIssue,
} from "../issues.ts"

const RULES = conformanceRules({
  CAM_MANIFEST_ROOT_INVALID: {
    class: "A",
    reason: "The CAM root document must be an object before any manifest joins are meaningful.",
  },
  CAM_MANIFEST_FIELD_UNKNOWN: {
    class: "A",
    reason: "CAM V1 root fields are closed-world publication semantics.",
  },
  CAM_MANIFEST_VERSION_INVALID: {
    class: "A",
    reason: "Version mismatch means this package cannot claim conformance for the document semantics.",
  },
})

export function validateRootManifest({
  resource,
  root,
  issues,
}: {
  readonly resource: string
  readonly root: unknown
  readonly issues: CamConformanceIssue[]
}): boolean {
  const result = collectCamRootFact(root, { resource })
  for (const diagnostic of result.diagnostics) {
    issues.push(rootFactDiagnosticIssue(diagnostic))
  }
  return result.value !== undefined
}

function rootFactDiagnosticIssue(diagnostic: CamFactDiagnostic): CamConformanceIssue {
  switch (diagnostic.code) {
    case "CAM_FACT_ROOT_NOT_OBJECT":
      return conformanceIssue({
        rule: RULES.CAM_MANIFEST_ROOT_INVALID,
        resource: diagnostic.resource,
        path: diagnostic.path,
        message: diagnostic.message,
      })
    case "CAM_FACT_ROOT_VERSION_INVALID":
      return conformanceIssue({
        rule: RULES.CAM_MANIFEST_VERSION_INVALID,
        resource: diagnostic.resource,
        path: diagnostic.path,
        message: diagnostic.message,
      })
    case "CAM_FACT_ROOT_FIELD_UNKNOWN":
      return conformanceIssue({
        rule: RULES.CAM_MANIFEST_FIELD_UNKNOWN,
        resource: diagnostic.resource,
        path: diagnostic.path,
        message: diagnostic.message,
      })
    default:
      throw new Error(`unexpected CAM root fact diagnostic: ${diagnostic.code}`)
  }
}
