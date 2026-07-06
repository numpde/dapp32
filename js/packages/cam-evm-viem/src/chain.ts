import type { Address, Hex } from "viem"
import { isAddress } from "viem"

import { CamEvmError } from "./errors.ts"

const EVM_CHAIN_PREFIX = "eip155:"

type ChainIdentityClient = {
  readonly getChainId: () => Promise<number>
}

type ChainIdentityHost = {
  readonly chainId: string
}

export function requireEvmAddress(value: string, label: string): Address {
  if (!isAddress(value)) {
    throw new Error(`${label}: expected 20-byte hex address`)
  }

  return value
}

export function requireEvmChainId(value: string): string {
  chainIdDecimal(value)
  return value
}

export function evmChainIdHex(chainId: string): Hex {
  const decimal = chainIdDecimal(chainId)
  return `0x${BigInt(decimal).toString(16)}`
}

export function evmChainIdNumber(chainId: string): number {
  return Number(chainIdDecimal(chainId))
}

function chainIdDecimal(value: string): string {
  if (!/^eip155:[1-9][0-9]*$/.test(value)) {
    throw new Error("chainId: expected CAIP-2 EVM chain id, for example eip155:31337")
  }

  const decimal = value.slice(EVM_CHAIN_PREFIX.length)
  const numeric = Number(decimal)
  if (!Number.isSafeInteger(numeric)) {
    throw new Error("chainId: expected a safe integer chain id")
  }

  return decimal
}

export async function assertClientChain(
  publicClient: ChainIdentityClient,
  host: ChainIdentityHost,
): Promise<void> {
  const actual = await publicClient.getChainId()
  const expected = evmChainIdNumber(host.chainId)
  if (actual !== expected) {
    throw new CamEvmError("CAM_CHAIN_MISMATCH", `CAM host chain mismatch: expected ${host.chainId}, got eip155:${actual}`)
  }
}
