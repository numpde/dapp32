export const CAM_VERSION = "1.3.0"
export const UI_VERSION = "1.0.0"
export const UI_URI_VERSION = "1.1.0"

export function isUiVersion(value: unknown): value is typeof UI_VERSION | typeof UI_URI_VERSION {
  return value === UI_VERSION || value === UI_URI_VERSION
}

export type CamVersion = typeof CAM_VERSION

export function isCamVersion(value: unknown): value is CamVersion {
  return value === CAM_VERSION
}
