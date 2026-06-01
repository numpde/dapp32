import type { Address, Hex } from "viem"
import { isAddress } from "viem"

const EVM_CHAIN_PREFIX = "eip155:"

export function requireEvmAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label}: expected 20-byte hex address`)
  }

  return value
}

export function requireEvmChainId(value: string): string {
  if (!/^eip155:[1-9][0-9]*$/.test(value)) {
    throw new Error("chainId: expected CAIP-2 EVM chain id, for example eip155:31337")
  }

  return value
}

export function evmChainIdHex(chainId: string): Hex {
  const decimal = requireEvmChainId(chainId).slice(EVM_CHAIN_PREFIX.length)
  return `0x${BigInt(decimal).toString(16)}`
}

export function evmChainIdNumber(chainId: string): number {
  const decimal = requireEvmChainId(chainId).slice(EVM_CHAIN_PREFIX.length)
  const numeric = Number(decimal)
  if (!Number.isSafeInteger(numeric)) {
    throw new Error("chainId: expected a safe integer chain id")
  }

  return numeric
}
