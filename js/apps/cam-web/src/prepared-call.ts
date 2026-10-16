import type {
  CamViewerPreparedContractCall,
} from "@cam/viewer"

import {
  formatInertValue,
} from "./display.ts"

export type PreparedCallField = {
  readonly label: string
  readonly value: string
  readonly mono: boolean
}

export function preparedCallFields(call: CamViewerPreparedContractCall): readonly PreparedCallField[] {
  return [
    { label: "Contract address", value: call.address, mono: true },
    { label: "Contract function", value: call.function, mono: false },
    { label: "Function inputs", value: formatInertValue(call.args), mono: false },
    ...(call.value === undefined
      ? []
      : [{ label: "Native amount to send (wei)", value: formatInertValue(call.value), mono: true }]),
  ]
}
