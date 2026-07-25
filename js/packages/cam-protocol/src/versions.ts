export const CAM_VERSION = "1.1.0"
export const UI_VERSION = "1.0.0"

export const CAM_SUPPORTED_VERSIONS = Object.freeze([
  "1.0.0",
  CAM_VERSION,
] as const)

export type CamVersion = (typeof CAM_SUPPORTED_VERSIONS)[number]

const CAM_SUPPORTED_VERSION_SET: ReadonlySet<string> = new Set(CAM_SUPPORTED_VERSIONS)

export function isCamVersion(value: unknown): value is CamVersion {
  return typeof value === "string" && CAM_SUPPORTED_VERSION_SET.has(value)
}

export function camVersionSupportsWriteValue(version: CamVersion): boolean {
  return version === CAM_VERSION
}
