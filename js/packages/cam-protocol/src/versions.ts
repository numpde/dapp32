// Default authoring follows the latest CAM version supported end to end.
// Only the current publication format is accepted.
export const CAM_VERSION = "1.2.0"
export const UI_VERSION = "1.0.0"

export const CAM_SUPPORTED_VERSIONS = Object.freeze([CAM_VERSION] as const)

export type CamVersion = (typeof CAM_SUPPORTED_VERSIONS)[number]

export function isCamVersion(value: unknown): value is CamVersion {
  return value === CAM_VERSION
}
