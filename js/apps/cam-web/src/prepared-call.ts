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
    { label: "Route", value: call.route, mono: false },
    { label: "Address", value: call.address, mono: true },
    { label: "Function", value: call.function, mono: false },
    { label: "Args", value: formatInertValue(call.args), mono: false },
    ...(call.value === undefined
      ? []
      : [{ label: "Value (wei)", value: formatInertValue(call.value), mono: true }]),
    {
      label: "Then",
      value: `${call.then.namespace}.${call.then.function} ${formatInertValue(call.then.args)}`,
      mono: false,
    },
  ]
}
