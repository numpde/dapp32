export const CAM_VERSION = "1.3.0"
export const UI_VERSION = "1.0.0"

export type CamVersion = typeof CAM_VERSION

export function isCamVersion(value: unknown): value is CamVersion {
  return value === CAM_VERSION
}
