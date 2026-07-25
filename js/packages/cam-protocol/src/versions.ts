// Keep default authoring on the latest version supported end-to-end. CAM 1.1
// parsing and conformance land before its EVM execution path, so callers must
// opt into 1.1 explicitly until that runtime boundary is complete.
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

export function camVersionSupportsWriteValue(version: CamVersion): boolean {
  return version === "1.1.0"
}
