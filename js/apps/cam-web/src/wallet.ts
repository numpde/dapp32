import {
  createWalletClient,
  custom,
} from "viem"
import type { Address } from "viem"
import {
  evmChainIdHex,
  evmChainIdNumber,
  requireEvmAddress,
} from "@cam/evm-viem"
import {
  requireHttpURL,
} from "@cam/protocol"
import {
  shortenAddress,
} from "./evm.ts"

export type WalletState =
  | { readonly status: "unavailable" }
  | { readonly status: "disconnected" }
  | { readonly status: "connected"; readonly address: Address }

export type WalletChainOptions = {
  readonly chainId: string
  readonly rpcUrl: string
}

export function walletChain(options: WalletChainOptions) {
  const id = evmChainIdNumber(options.chainId)
  const rpcUrl = requireHttpURL(options.rpcUrl, "rpcUrl").href
  return {
    id,
    name: `CAM ${options.chainId}`,
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [rpcUrl],
      },
    },
  } as const
}

export function initialWalletState(): WalletState {
  return window.ethereum === undefined
    ? { status: "unavailable" }
    : { status: "disconnected" }
}

export function walletLabel(wallet: WalletState): string {
  switch (wallet.status) {
    case "unavailable":
      return "Unavailable"
    case "disconnected":
      return "Disconnected"
    case "connected":
      return shortenAddress(wallet.address)
  }
}

export async function connectInjectedWallet(
  options: WalletChainOptions,
): Promise<Address> {
  const provider = requireEthereum()
  await ensureInjectedWalletChain(options)
  const accounts = await provider.request({ method: "eth_requestAccounts" })
  return requireAddressArray(accounts, "eth_requestAccounts")[0]
}

export async function ensureConnectedWalletAccount(expected: Address): Promise<void> {
  const accounts = await requireEthereum().request({ method: "eth_accounts" })
  const [current] = requireAddressArray(accounts, "eth_accounts")
  if (current.toLowerCase() !== expected.toLowerCase()) {
    throw new Error("Connected wallet account changed. Reconnect the wallet before sending.")
  }
}

export async function ensureInjectedWalletChain(options: WalletChainOptions): Promise<void> {
  const provider = requireEthereum()
  const chainId = evmChainIdHex(options.chainId)

  try {
    await switchInjectedWalletChain(provider, chainId)
  } catch (error) {
    if (walletErrorCode(error) !== 4902) {
      throw error
    }

    const chain = walletChain(options)
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls.default.http,
      }],
    })
    // EIP-3085 adds the chain; it does not guarantee selection. Treat the
    // expected wallet chain as a checked postcondition before any send path.
    await switchInjectedWalletChain(provider, chainId)
  }
  await assertInjectedWalletChain(provider, chainId)
}

export function createInjectedWalletClient(address: Address) {
  return createWalletClient({
    account: address,
    transport: custom(requireEthereum()),
  })
}

function requireEthereum(): EthereumProvider {
  if (window.ethereum === undefined) {
    throw new Error("No injected wallet was detected")
  }

  return window.ethereum
}

function walletErrorCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined

  let value: unknown
  try {
    value = (error as { readonly code?: unknown }).code
  } catch {
    // Provider error objects are not trusted data. A malformed `code` property
    // should behave like an ordinary switch failure, not crash error handling.
  }
  return typeof value === "number" ? value : undefined
}

async function switchInjectedWalletChain(provider: EthereumProvider, chainId: `0x${string}`): Promise<void> {
  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId }],
  })
}

async function assertInjectedWalletChain(provider: EthereumProvider, expectedChainId: `0x${string}`): Promise<void> {
  const actual = await provider.request({ method: "eth_chainId" })
  if (typeof actual !== "string" || actual.toLowerCase() !== expectedChainId.toLowerCase()) {
    throw new Error(`Injected wallet chain mismatch after switching: expected ${expectedChainId}`)
  }
}

function requireAddressArray(value: unknown, label: string): readonly [Address, ...Address[]] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${label}: expected at least one wallet account`)
  }

  const addresses = value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${label}.${index}: expected account address string`)
    }
    return requireEvmAddress(item, `${label}.${index}`)
  })
  const [first, ...rest] = addresses
  if (first === undefined) {
    throw new Error(`${label}: expected at least one wallet account`)
  }

  return [first, ...rest]
}
