import { isAbiAddressValue } from "@cam/protocol"
import { forEachResolvedUiNode } from "@cam/screen"
import type { ResolvedUiNode } from "@cam/screen"

export type KnownAddress = { readonly address: string; readonly label: string }
const MAX_ENTERED_ADDRESSES = 20

export function enteredAddresses(previous: readonly KnownAddress[], entry: KnownAddress): readonly KnownAddress[] {
  if (!isReusableAddress(entry.address)) return previous
  return [entry, ...previous.filter(item => item.address.toLowerCase() !== entry.address.toLowerCase())].slice(0, MAX_ENTERED_ADDRESSES)
}

export function currentViewAddresses(root: ResolvedUiNode): readonly KnownAddress[] {
  const addresses: KnownAddress[] = []
  forEachResolvedUiNode(root, node => {
    if (node.element === "Address" && typeof node.props.address === "string" && typeof node.props.label === "string") {
      addresses.push({ address: node.props.address, label: `Current view: ${node.props.label}` })
    }
  })
  return addresses
}

export function addressSuggestions(sources: readonly KnownAddress[]): readonly KnownAddress[] {
  const addresses = new Map<string, { address: string; labels: string[] }>()
  for (const { address, label } of sources) {
    if (!isReusableAddress(address)) continue
    const key = address.toLowerCase()
    const existing = addresses.get(key)
    if (existing === undefined) addresses.set(key, { address, labels: [label] })
    else if (!existing.labels.includes(label)) existing.labels.push(label)
  }
  return [...addresses.values()].map(({ address, labels }) => ({ address, label: labels.join("; ") }))
}

function isReusableAddress(value: string): boolean {
  return isAbiAddressValue(value) && BigInt(value) !== 0n
}
