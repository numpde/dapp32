import type { Address, Hex } from "./core.ts"
export interface Config {
  chainId: number
  payment: Address
  codeHash: Hex
  channelId: bigint
  fromBlock: bigint
  toBlock: bigint
  confirmations: number
  blockChunk: number
  maxCustomers: number
  maxTransactions: number
  gasLimit: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
}
export function parseConfig(value: unknown): Config {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected refund configuration object")
  const input = value as Record<string, unknown>
  const names = ["chainId", "payment", "codeHash", "channelId", "fromBlock", "toBlock", "confirmations", "blockChunk", "maxCustomers", "maxTransactions", "gasLimit", "maxFeePerGas", "maxPriorityFeePerGas"]
  if (Object.keys(input).length !== names.length || names.some(name => !Object.hasOwn(input, name))) throw new Error("Unexpected or missing configuration fields")
  function uint(name: string, max = (1n << 256n) - 1n): bigint {
    const raw = input[name]
    if (typeof raw !== "string" || !/^(0|[1-9][0-9]*)$/.test(raw)) throw new Error(`Invalid unsigned decimal: ${name}`)
    const n = BigInt(raw)
    if (n > max) throw new Error(`Out of range: ${name}`)
    return n
  }
  function count(name: string, max: number): number {
    const n = input[name]
    if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(`Invalid bound: ${name}`)
    return n
  }
  if (typeof input.payment !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(input.payment) || /^0x0{40}$/i.test(input.payment)) throw new Error("Invalid payment address")
  if (typeof input.codeHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(input.codeHash)) throw new Error("Invalid runtime-code hash")
  const config: Config = {
    chainId: Number(uint("chainId", BigInt(Number.MAX_SAFE_INTEGER))), payment: input.payment.toLowerCase() as Address, codeHash: input.codeHash.toLowerCase() as Hex,
    channelId: uint("channelId"), fromBlock: uint("fromBlock"), toBlock: uint("toBlock"),
    confirmations: count("confirmations", 1000), blockChunk: count("blockChunk", 10_000), maxCustomers: count("maxCustomers", 1000), maxTransactions: count("maxTransactions", 100),
    gasLimit: uint("gasLimit", 2_000_000n), maxFeePerGas: uint("maxFeePerGas"), maxPriorityFeePerGas: uint("maxPriorityFeePerGas"),
  }
  if (config.chainId === 0 || config.gasLimit < 21_000n || config.maxFeePerGas === 0n || config.maxPriorityFeePerGas > config.maxFeePerGas) throw new Error("Invalid chain or gas budget")
  if (config.toBlock < config.fromBlock || config.toBlock - config.fromBlock >= 100_000n) throw new Error("Discovery must cover 1 to 100000 blocks")
  return config
}
