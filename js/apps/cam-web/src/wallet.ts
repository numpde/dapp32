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
  shortenAddress,
} from "./evm"

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
        http: [options.rpcUrl],
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

export async function ensureInjectedWalletChain(options: WalletChainOptions): Promise<void> {
  const provider = requireEthereum()
  const chainId = evmChainIdHex(options.chainId)

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    })
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
  }
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
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "number"
    ? error.code
    : undefined
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
