import {
  assertCamResourceSize,
  parseJsonBytes,
} from "@cam/protocol"

import {
  conformanceRules,
  issueFromError,
} from "../issues.ts"
import type {
  CamConformanceIssue,
} from "../issues.ts"
import {
  RESOURCE_RULES,
} from "../resources/rules.ts"

type RootCamJsonResult =
  | {
      readonly ok: true
      readonly value: unknown
    }
  | {
      readonly ok: false
    }

const RULES = conformanceRules({
  CAM_ROOT_JSON_INVALID: {
    class: "A",
    reason: "Invalid root JSON prevents protocol interpretation at the caller-supplied root resource.",
  },
})

export function parseRootCamJson({
  resource,
  bytes,
  issues,
}: {
  readonly resource: string
  readonly bytes: Uint8Array
  readonly issues: CamConformanceIssue[]
}): RootCamJsonResult {
  try {
    assertCamResourceSize(bytes, resource)
  } catch (error) {
    issues.push(issueFromError({
      rule: RESOURCE_RULES.CAM_RESOURCE_TOO_LARGE,
      resource,
      error,
    }))
    return {
      ok: false,
    }
  }

  try {
    return {
      ok: true,
      value: parseJsonBytes(bytes),
    }
  } catch (error) {
    issues.push(issueFromError({
      rule: RULES.CAM_ROOT_JSON_INVALID,
      resource,
      error,
    }))
    return {
      ok: false,
    }
  }
}
