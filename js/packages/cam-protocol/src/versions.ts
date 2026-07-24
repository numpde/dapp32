// Keep the default authoring version on the last fully specified grammar until
// 1.1-only syntax lands. Readers accept both versions now so that the later
// grammar change can bump the default atomically with its new semantics.
export const CAM_VERSION = "1.0.0"
export const UI_VERSION = "1.0.0"

export const CAM_SUPPORTED_VERSIONS = Object.freeze([
  CAM_VERSION,
  "1.1.0",
] as const)

export type CamVersion = (typeof CAM_SUPPORTED_VERSIONS)[number]

const CAM_SUPPORTED_VERSION_SET: ReadonlySet<string> = new Set(CAM_SUPPORTED_VERSIONS)

export function isCamVersion(value: unknown): value is CamVersion {
  return typeof value === "string" && CAM_SUPPORTED_VERSION_SET.has(value)
}
