import {
  createWalletClient,
  custom,
} from "viem"
import type { Address } from "viem"

export type WalletState =
  | { readonly status: "unavailable" }
  | { readonly status: "disconnected" }
  | { readonly status: "connected"; readonly address: Address }

export type WalletChainOptions = {
  readonly chainId: string
  readonly rpcUrl: string
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
      return shorten(wallet.address)
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
  const chainId = hexChainId(options.chainId)

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId }],
    })
  } catch (error) {
    if (walletErrorCode(error) !== 4902) {
      throw error
    }

    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: `Local ${options.chainId}`,
        nativeCurrency: {
          name: "Ether",
          symbol: "ETH",
          decimals: 18,
        },
        rpcUrls: [options.rpcUrl],
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

function hexChainId(chainId: string): `0x${string}` {
  if (!/^eip155:[1-9][0-9]*$/.test(chainId)) {
    throw new Error("chainId: expected CAIP-2 EVM chain id, for example eip155:31337")
  }

  const decimal = chainId.slice("eip155:".length)
  return `0x${BigInt(decimal).toString(16)}`
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

  return value.map((item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${label}.${index}: expected account address string`)
    }
    return requireAddress(item, `${label}.${index}`)
  }) as [Address, ...Address[]]
}

function requireAddress(value: string, label: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error(`${label}: expected 20-byte hex address`)
  }

  return value as Address
}

function shorten(address: string): string {
  return address.length > 14 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address
}
