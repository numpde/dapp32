import type {
  CamViewerPreparedContractCall,
} from "@cam/viewer"
import { abiFunctionSignature } from "@cam/protocol"
import type { AbiFunction } from "viem"

import {
  formatInertValue,
} from "./display.ts"

export type PreparedCallField = {
  readonly label: string
  readonly value: string
  readonly mono: boolean
}

export function preparedCallFields(call: CamViewerPreparedContractCall): readonly PreparedCallField[] {
  // Preparation already validates function selection and named arguments.
  // The review reads that ABI to label the exact values being sent.
  const functionAbi = call.abi.find((item): item is AbiFunction => item.type === "function"
    && (item.name === call.function || abiFunctionSignature(item) === call.function))!
  return [
    { label: "Contract address", value: call.address, mono: true },
    { label: "Contract function", value: call.function, mono: false },
    ...functionAbi.inputs.map(input => ({ label: `Input: ${input.name!} (${input.type})`, value: formatInertValue(call.args[input.name!]!), mono: false })),
    ...(call.value === undefined
      ? []
      : [{ label: "Native amount to send (wei)", value: formatInertValue(call.value), mono: true }]),
    { label: "App action", value: call.route, mono: false },
    { label: "After confirmation", value: `${call.then.namespace}.${call.then.function} ${formatInertValue(call.then.args)}`, mono: false },
  ]
}
