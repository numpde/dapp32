import {
  conformanceRules,
} from "../issues.ts"

export const RESOURCE_RULES = conformanceRules({
  CAM_RESOURCE_MISSING: {
    class: "A",
    reason: "A declared resource missing from supplied bytes is a deterministic publication failure.",
  },
  CAM_RESOURCE_TOO_LARGE: {
    class: "A",
    reason: "Resource byte size is supplied publication data and uses the shared protocol cap.",
  },
  CAM_RESOURCE_ORPHAN: {
    class: "A",
    reason: "Orphan bytes are not anchored by the root manifest.",
  },
  CAM_RESOURCE_INTEGRITY_CONFLICT: {
    class: "A",
    reason: "One URI cannot have multiple committed byte identities in the same bundle.",
  },
  CAM_RESOURCE_DECLARATION_INVALID: {
    class: "A",
    reason: "Resource URI and integrity fields connect namespaces to supplied bytes.",
  },
  CAM_RESOURCE_INTEGRITY_INVALID: {
    class: "A",
    reason: "Integrity grammar is deterministic over the manifest commitment.",
  },
  CAM_RESOURCE_INTEGRITY_MISMATCH: {
    class: "A",
    reason: "Integrity mismatch is deterministic over supplied bytes and the manifest commitment.",
  },
})
