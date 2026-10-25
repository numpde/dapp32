import { evmChainIdNumber } from "@cam/evm-viem"
import { requireHttpURL } from "@cam/protocol"
import catalog from "./rpc-catalog.json" with { type: "json" }

export function evmNetworkChoices(): readonly { readonly name: string; readonly chainId: string }[] {
  return Object.values(catalog)
    .filter(network => !("retired" in network && network.retired))
    .map(network => ({ name: network.name, chainId: `eip155:${network.chainId}` }))
}

export function publicRpcEndpoints(chainId: string): readonly { readonly name: string; readonly url: string }[] {
  const id = evmChainIdNumber(chainId)
  const network = Object.values(catalog).find(entry => entry.chainId === id)
  if (network === undefined || ("retired" in network && network.retired)) return []
  return Object.entries(network.services)
    .filter(([, endpoint]) => !/[{}]/u.test(endpoint))
    .map(([service, endpoint]) => ({ name: `${network.name} — ${service}`, url: requireHttpURL(endpoint, "catalog RPC URL").href }))
}
