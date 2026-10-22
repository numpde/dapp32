// CAM 1.2 remains the baseline for static authoring; CAM 1.3 opts into resolved write targets.
// Existing publications retain their grammar when a successor is supported.
export const CAM_VERSION = "1.2.0"
export const UI_VERSION = "1.0.0"

export const CAM_SUPPORTED_VERSIONS = Object.freeze([CAM_VERSION, "1.3.0"] as const)

export type CamVersion = (typeof CAM_SUPPORTED_VERSIONS)[number]

export function isCamVersion(value: unknown): value is CamVersion {
  return value === CAM_VERSION || value === "1.3.0"
}
