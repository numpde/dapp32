import { decodeEventLog, encodeAbiParameters, toEventSelector } from "viem"
import type { AbiEvent, Address, Block, Transaction, TransactionReceipt } from "viem"
import type { CamResolvedInvocation } from "@cam/core"
import type { CamRuntimeContext, InertRecord, InertValue } from "@cam/protocol"
import { inspectAbiParameterNames } from "@cam/protocol"
import { evmUint256Value } from "./abi-values.ts"
import { validateAbiParameters } from "./abi.ts"
import { findUniqueAbiFunction } from "./abi-functions.ts"
import { readCamInvocation, normalizeRouteResult, normalizeRouteValues } from "./routes.ts"
import { encodeCamContractCall, writeRequest } from "./writes.ts"
import type { CamContractCall, CamPublicClient, CamSimulationClient, ResolvedCamContract } from "./types.ts"

export type CamReviewClient = CamPublicClient & CamSimulationClient & {
  readonly getBlock: (request: { readonly blockNumber?: NonNullable<Block["number"]> }) => Promise<Pick<Block, "number" | "hash">>
}

export async function reviewCamContractCall({ publicClient, account, call, read, context, contracts }: {
  readonly publicClient: CamReviewClient
  readonly account: Address
  readonly call: CamContractCall
  readonly read: CamResolvedInvocation
  readonly context: CamRuntimeContext
  readonly contracts: Record<string, ResolvedCamContract>
}): Promise<{ readonly blockNumber: string; readonly values: readonly InertValue[] }> {
  const block = await publicClient.getBlock({})
  if (block.number === null || block.hash === null) throw new Error("Cannot review a transaction without an observed block.")
  const result = await readCamInvocation({ publicClient, contracts, context, route: "transaction review", routeCall: read, blockNumber: block.number })
  const simulation = await publicClient.simulateContract({ ...writeRequest(call), account, blockNumber: block.number })
  if (typeof simulation !== "object" || simulation === null || !("result" in simulation)) throw new Error("Transaction simulation did not return its result.")
  const fn = findUniqueAbiFunction({ abi: call.abi, functionName: call.function, notFoundCode: "CAM_WRITE_FUNCTION_NOT_FOUND", ambiguousCode: "CAM_WRITE_FUNCTION_AMBIGUOUS", purpose: "review" })
  const simulated = normalizeRouteResult(simulation.result, call.function, fn.outputs).values
  const current = await publicClient.getBlock({ blockNumber: block.number })
  if (current.hash !== block.hash) throw new Error("The observed block changed during transaction review. Review the transaction again.")
  return { blockNumber: block.number.toString(), values: [{ read: [...result.values], simulation: [...simulated] }] }
}

export function receiptEventAbi(call: CamContractCall, event: string): AbiEvent {
  const matches = call.abi.filter((item): item is AbiEvent => item.type === "event" && item.name === event)
  if (matches.length !== 1) throw new Error(`Transaction receipt requires one unambiguous ABI event: ${event}`)
  const selected = matches[0]!
  validateAbiParameters(selected.inputs, `receipt event ${event}.inputs`)
  if (selected.anonymous !== undefined && selected.anonymous !== false || inspectAbiParameterNames(selected.inputs).issues.length !== 0
    || selected.inputs.some(input => input.indexed !== undefined && typeof input.indexed !== "boolean" || input.indexed && (input.type === "string" || input.type === "bytes" || input.type.startsWith("tuple") || input.type.includes("[")))) {
    throw new Error(`Transaction receipt event must have named, recoverable arguments and a signature topic: ${event}`)
  }
  return selected
}

export type CamMinedTransaction = Pick<Transaction, "hash" | "blockHash" | "blockNumber" | "from" | "to" | "input" | "value">
export type CamMinedReceipt = Pick<TransactionReceipt, "status" | "transactionHash" | "blockHash" | "blockNumber" | "from" | "to"> & {
  readonly logs: readonly Pick<TransactionReceipt["logs"][number], "address" | "topics" | "data">[]
}

export function interpretCamReceipt({ call, event, receipt, transaction, account }: {
  readonly call: CamContractCall
  readonly event: string
  readonly receipt: CamMinedReceipt
  readonly transaction: CamMinedTransaction
  readonly account: Address
}): InertRecord | undefined {
  // An absent event has app-defined meaning only after the mined call itself
  // is identified. A wallet replacement may have sent different calldata.
  if (receipt.status !== "success" || transaction.hash !== receipt.transactionHash
    || transaction.blockHash !== receipt.blockHash || transaction.blockNumber !== receipt.blockNumber
    || transaction.to?.toLowerCase() !== call.address.toLowerCase()
    || receipt.to?.toLowerCase() !== call.address.toLowerCase()
    || transaction.from.toLowerCase() !== account.toLowerCase() || receipt.from.toLowerCase() !== account.toLowerCase()
    || transaction.input.toLowerCase() !== encodeCamContractCall(call).toLowerCase()
    || transaction.value !== evmUint256Value(call.value === undefined ? "0" : call.value)) {
    throw new Error("The mined transaction does not match the reviewed call. Its result cannot be interpreted.")
  }
  const selected = receiptEventAbi(call, event)
  const topic = toEventSelector(selected)
  const logs = receipt.logs.filter(log => log.address.toLowerCase() === call.address.toLowerCase() && log.topics[0]?.toLowerCase() === topic.toLowerCase())
  if (logs.length === 0) return undefined
  if (logs.length !== 1) throw new Error(`The transaction emitted multiple ${event} events; its result is ambiguous.`)
  const log = logs[0]!
  if (log.topics.length !== 1 + selected.inputs.filter(input => input.indexed).length) throw new Error(`The ${event} event has an unexpected topic count.`)
  const decoded = decodeEventLog({ abi: [selected], data: log.data, topics: log.topics, strict: true })
  const args = decoded.args as Record<string, unknown>
  const indexed = selected.inputs.filter(input => input.indexed)
  if (indexed.some((input, index) => encodeAbiParameters([input], [args[input.name!]]).toLowerCase() !== log.topics[index + 1]?.toLowerCase())) throw new Error(`The ${event} event has noncanonical indexed arguments.`)
  const nonindexed = selected.inputs.filter(input => !input.indexed)
  if (encodeAbiParameters(nonindexed, nonindexed.map(input => args[input.name!])).toLowerCase() !== log.data.toLowerCase()) throw new Error(`The ${event} event has noncanonical argument data.`)
  const values = normalizeRouteValues(selected.inputs.map(input => args[input.name!]), selected.inputs, event)
  return Object.fromEntries(selected.inputs.map((input, index) => [input.name!, values[index]!]))
}
