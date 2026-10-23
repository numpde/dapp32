import {
  createWalletClient,
  custom,
} from "viem"
import type { Address, Chain } from "viem"
import {
  evmChainIdHex,
  evmChainIdNumber,
  requireEvmAddress,
} from "@cam/evm-viem"
import {
  isRecordObject,
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

export type InjectedWalletChange =
  | { readonly type: "accountsChanged"; readonly accounts: readonly Address[] }
  | { readonly type: "chainChanged"; readonly chainId: `0x${string}` }
  | { readonly type: "disconnect" }

export function subscribeInjectedWallet(
  onChange: (change: InjectedWalletChange) => void,
  onError: (error: unknown) => void,
): () => void {
  const provider = window.ethereum
  if (provider?.on === undefined || provider.removeListener === undefined) return () => {}
  const removeListener = provider.removeListener.bind(provider)
  let active = true
  const accountsChanged = (value: unknown) => {
    if (!active) return
    let accounts: readonly Address[]
    try {
      accounts = parseAddressArray(value, "accountsChanged")
    } catch (error) {
      onError(error)
      return
    }
    onChange({ type: "accountsChanged", accounts })
  }
  const chainChanged = (value: unknown) => {
    if (!active) return
    if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value) || BigInt(value) <= 0n) {
      onError(new Error("chainChanged: expected a positive hexadecimal chain ID"))
      return
    }
    onChange({ type: "chainChanged", chainId: value as `0x${string}` })
  }
  const disconnected = () => { if (active) onChange({ type: "disconnect" }) }
  provider.on("accountsChanged", accountsChanged)
  let chainRegistered = false
  try {
    provider.on("chainChanged", chainChanged)
    chainRegistered = true
    provider.on("disconnect", disconnected)
  } catch (error) {
    active = false
    removeListener("accountsChanged", accountsChanged)
    if (chainRegistered) removeListener("chainChanged", chainChanged)
    throw error
  }
  return () => {
    if (!active) return
    active = false
    removeListener("accountsChanged", accountsChanged)
    removeListener("chainChanged", chainChanged)
    removeListener("disconnect", disconnected)
  }
}

export async function walletNetworkToAdd(options: WalletChainOptions): Promise<Chain> {
  const id = evmChainIdNumber(options.chainId)
  const rpcUrl = requireHttpURL(options.rpcUrl, "rpcUrl").href
  // Only network registration needs this catalog; an installed custom network
  // can be selected and used for transactions without a catalog entry.
  const chains = await import("viem/chains")
  // The repository's release rehearsal uses a separate Anvil chain ID.
  const knownChains = Object.values(chains)
  const chain = id === 31338
    ? { ...chains.foundry, id, name: "CAM release rehearsal" }
    : knownChains.find(chain => "id" in chain && chain.id === id)
  if (chain === undefined || !("id" in chain)) {
    throw new Error(`Cannot add network ${id}: this viewer has no definition for its name and native currency. Add the network in your wallet manually, then connect again.`)
  }
  return {
    id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
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
      return "Not connected"
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

    const chain = await walletNetworkToAdd(options)
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

export function createInjectedWalletClient(
  address: Address,
  options: Pick<WalletChainOptions, "chainId">,
  shouldContinue: () => boolean,
) {
  const provider = requireEthereum()
  const chainId = evmChainIdHex(options.chainId)
  return createWalletClient({
    account: address,
    transport: custom({
      async request(request: Parameters<EthereumProvider["request"]>[0]) {
        if (request.method !== "eth_sendTransaction" && request.method !== "wallet_sendTransaction") {
          return provider.request(request)
        }
        let transaction: Record<string, unknown>
        try {
          const params = request.params
          if (!Array.isArray(params) || params.length !== 1 || !isRecordObject(params[0])) {
            throw new Error("The wallet send request must contain one transaction.")
          }
          transaction = params[0]
          if (transaction.chainId !== undefined && transaction.chainId !== chainId) {
            throw new Error(`The wallet request targets a different network than ${options.chainId}.`)
          }
          await assertInjectedWalletChain(provider, chainId)
          if (!shouldContinue()) throw new Error("The transaction review changed before the wallet request was submitted.")
        } catch (cause) {
          throw new WalletSubmissionBlockedError(cause)
        }
        // viem's null override delegates the chain check to this transport.
        // Bind the request too, so the wallet can reject a subsequent switch.
        return provider.request({ ...request, params: [{ ...transaction, chainId }] })
      },
    }),
  })
}

class WalletSubmissionBlockedError extends Error {
  // Keep proven non-submission recognizable through viem's RPC wrappers.
  readonly code = -32099
  readonly data = { submission: "not-submitted" } as const

  constructor(cause: unknown) {
    super(`The wallet request was not submitted: ${cause instanceof Error ? cause.message : "the wallet network could not be checked"}`, { cause })
  }
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
    throw new Error(`Injected wallet chain mismatch: expected ${expectedChainId}`)
  }
}

function requireAddressArray(value: unknown, label: string): readonly [Address, ...Address[]] {
  const addresses = parseAddressArray(value, label)
  const [first, ...rest] = addresses
  if (first === undefined) {
    throw new Error(`${label}: expected at least one wallet account`)
  }
  return [first, ...rest]
}

function parseAddressArray(value: unknown, label: string): Address[] {
  if (!Array.isArray(value)) throw new Error(`${label}: expected a wallet account array`)
  return Array.from(value, (item, index) => {
    if (typeof item !== "string") {
      throw new Error(`${label}.${index}: expected account address string`)
    }
    return requireEvmAddress(item, `${label}.${index}`)
  })
}
