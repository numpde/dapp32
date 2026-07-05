import {
  isRecordObject,
} from "../json.ts"
import {
  CAM_MANIFEST_TOP_LEVEL_KEYS,
} from "../manifest.ts"
import {
  CAM_VERSION,
} from "../versions.ts"
import {
  camFactDiagnostic,
  type CamFactDiagnostic,
  type CamFactResult,
} from "./diagnostics.ts"

export type CamRootFact = {
  readonly resource: string
  readonly value: Record<string, unknown>
  readonly version: typeof CAM_VERSION
}

export function collectCamRootFact(
  input: unknown,
  options: {
    readonly resource: string
  },
): CamFactResult<CamRootFact> {
  const diagnostics: CamFactDiagnostic[] = []
  if (!isRecordObject(input)) {
    diagnostics.push(camFactDiagnostic({
      code: "CAM_FACT_ROOT_NOT_OBJECT",
      resource: options.resource,
      message: "CAM root document must be a JSON object",
    }))
    return { diagnostics }
  }

  if (input.cam !== CAM_VERSION) {
    diagnostics.push(camFactDiagnostic({
      code: "CAM_FACT_ROOT_VERSION_INVALID",
      resource: options.resource,
      path: "cam",
      message: typeof input.cam === "string" && input.cam.length > 0
        ? `unsupported CAM version: ${input.cam}`
        : `CAM version must be ${CAM_VERSION}`,
    }))
    return { diagnostics }
  }

  for (const key of Object.keys(input)) {
    if (CAM_MANIFEST_TOP_LEVEL_KEYS.has(key)) continue
    diagnostics.push(camFactDiagnostic({
      code: "CAM_FACT_ROOT_FIELD_UNKNOWN",
      resource: options.resource,
      path: key,
      message: `field is not allowed in CAM ${CAM_VERSION}: ${key}`,
    }))
  }

  return {
    value: {
      resource: options.resource,
      value: input,
      version: CAM_VERSION,
    },
    diagnostics,
  }
}
