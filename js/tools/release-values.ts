import { requireEvmAddress } from "../packages/cam-evm-viem/dist/index.js"
import type { CamHost } from "../packages/cam-evm-viem/dist/index.js"
import { isRecordObject, parseJsonBytes } from "../packages/cam-protocol/dist/index.js"

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"

export function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required environment variable: ${name}`)
  }
  return value
}

export function requiredSourceCommit(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{40}$/.test(value)) {
    throw new Error("source commit must be exactly 40 lowercase hexadecimal characters")
  }
  return value
}

export function requiredReleaseChainId(value: string): number {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error("expected chain ID must be a positive decimal integer")
  }
  return checkedReleaseChainId(Number(value))
}

export function checkedReleaseChainId(chainId: number): number {
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("expected chain ID must be a positive safe integer")
  }
  if (chainId === 1337 || chainId === 31337) {
    throw new Error(`release deployment rejects local fixture chain ID: ${chainId}`)
  }
  return chainId
}

export function requiredNonzeroAddress(value: unknown, label: string): CamHost["address"] {
  if (typeof value !== "string") {
    throw new Error(`${label}: expected 20-byte hex address`)
  }
  const address = requireEvmAddress(value, label)
  if (address.toLowerCase() === ZERO_ADDRESS) {
    throw new Error(`${label} must not be the zero address`)
  }
  return address
}

export function requiredBytes32(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${label} must be a 32-byte hexadecimal value`)
  }
  return value as `0x${string}`
}

export function requiredNonzeroBytes32(value: unknown, label: string): `0x${string}` {
  const bytes = requiredBytes32(value, label)
  if (/^0x0{64}$/i.test(bytes)) {
    throw new Error(`${label} must not be zero`)
  }
  return bytes
}

export function requiredTransactionHash(value: unknown, label: string): `0x${string}` {
  return requiredNonzeroBytes32(value, label)
}

export function requiredBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean`)
  }
  return value
}

export function requiredSafeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`${label} must be a safe integer`)
  }
  return value
}

export function requiredNonemptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

export function requiredSingleLineString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0 || /[\r\n]/.test(value)) {
    throw new Error(`${label} must be a non-empty single-line string`)
  }
  return value
}

export function requiredJsonRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecordObject(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

export function parseJsonRecord(bytes: Uint8Array, label: string): Record<string, unknown> {
  return requiredJsonRecord(parseJsonBytes(bytes), label)
}

export function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value)
  const expectedSet = new Set(expected)
  const missing = expected.filter((key) => !Object.prototype.hasOwnProperty.call(value, key))
  const unexpected = actual.filter((key) => !expectedSet.has(key))
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label} fields disagree: missing=[${missing.join(",")}] unexpected=[${unexpected.join(",")}]`,
    )
  }
}

export function requireDistinctHexValues(values: readonly `0x${string}`[], label: string): void {
  if (new Set(values.map((value) => value.toLowerCase())).size !== values.length) {
    throw new Error(`${label} must be distinct`)
  }
}

export function runReleaseTool(main: () => Promise<void>): void {
  main().catch((error: unknown) => {
    const message = error instanceof Error && error.stack !== undefined && error.stack.length > 0
      ? error.stack
      : error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  })
}
