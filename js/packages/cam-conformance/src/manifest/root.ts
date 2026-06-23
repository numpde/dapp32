import {
  CAM_VERSION,
  CAM_MANIFEST_TOP_LEVEL_KEYS,
  isRecordObject,
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
  if (!isRecordObject(root)) {
    issues.push(conformanceIssue({
      rule: RULES.CAM_MANIFEST_ROOT_INVALID,
      resource,
      message: "CAM root document must be a JSON object",
    }))
    return false
  }

  if (!validateRootVersion(resource, root.cam, issues)) {
    return false
  }
  for (const key of Object.keys(root)) {
    if (CAM_MANIFEST_TOP_LEVEL_KEYS.has(key)) continue
    issues.push(conformanceIssue({
      rule: RULES.CAM_MANIFEST_FIELD_UNKNOWN,
      resource,
      path: key,
      message: `field is not allowed in CAM ${CAM_VERSION}: ${key}`,
    }))
  }
  return true
}

function validateRootVersion(resource: string, version: unknown, issues: CamConformanceIssue[]): boolean {
  if (version === CAM_VERSION) return true

  issues.push(conformanceIssue({
    rule: RULES.CAM_MANIFEST_VERSION_INVALID,
    resource,
    path: "cam",
    message: typeof version === "string" && version.length > 0
      ? `unsupported CAM version: ${version}`
      : `CAM version must be ${CAM_VERSION}`,
  }))
  return false
}
