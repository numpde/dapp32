import {
  requireEvmAddress,
} from "../../packages/cam-evm-viem/dist/index.js"
import type {
  CamHost,
} from "../../packages/cam-evm-viem/dist/index.js"

export type TerminalAccountSelection =
  | { readonly kind: "none" }
  | {
    readonly kind: "account"
    readonly address: CamHost["address"]
  }

export function parseTerminalAccount(args: readonly string[]): TerminalAccountSelection {
  const [value, ...extra] = args
  if (value === undefined || extra.length > 0) {
    throw new Error("usage: account <address|none>")
  }
  if (value === "none") {
    return { kind: "none" }
  }

  return {
    kind: "account",
    address: requireEvmAddress(value, "terminal account"),
  }
}
