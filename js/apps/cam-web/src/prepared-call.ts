import type {
  CamViewerPreparedContractCall,
} from "@cam/viewer"
import { abiFunctionSignature, parseJsonText } from "@cam/protocol"
import type { AbiFunction } from "viem"
import { readJsonDataURI } from "./nft-metadata.ts"
import { failureReport } from "./errors.ts"
import type { FailureReport } from "./errors.ts"

import {
  formatInertValue,
} from "./display.ts"

export type PreparedCallField = {
  readonly label: string
  readonly value: string
  readonly mono: boolean
  readonly compact?: boolean
  readonly json?: { readonly status: "ready"; readonly text: string } | { readonly status: "failed"; readonly failure: FailureReport }
}

export function preparedCallFields(call: CamViewerPreparedContractCall): readonly PreparedCallField[] {
  // Preparation already validates function selection and named arguments.
  // The review reads that ABI to label the exact values being sent.
  const functionAbi = call.abi.find((item): item is AbiFunction => item.type === "function"
    && (item.name === call.function || abiFunctionSignature(item) === call.function))!
  return [
    { label: "Contract address", value: call.address, mono: true },
    { label: "Contract function", value: call.function, mono: false },
    ...functionAbi.inputs.map(input => {
      const argument = call.args[input.name!]!
      const field = { label: `Input: ${input.name!} (${input.type})`, value: formatInertValue(argument), mono: false, ...(input.type === "bytes" ? { compact: false } : {}) }
      if (input.type !== "string" || typeof argument !== "string" || !/^data:application\/json[;,]/i.test(argument)) return field
      try {
        const text = readJsonDataURI(argument)
        parseJsonText(text)
        return { ...field, value: argument, json: { status: "ready" as const, text } }
      } catch (error) {
        return { ...field, value: argument, json: { status: "failed" as const, failure: failureReport(error, "Cannot preview this JSON. Inspect the exact URI below.") } }
      }
    }),
    ...(call.value === undefined
      ? []
      : [{ label: "Native amount to send (wei)", value: formatInertValue(call.value), mono: true }]),
    { label: "App action", value: call.route, mono: false },
    { label: "After confirmation", value: `${call.then.namespace}.${call.then.function} ${formatInertValue(call.then.args)}`, mono: false },
  ]
}
