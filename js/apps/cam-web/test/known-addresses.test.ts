import assert from "node:assert/strict"
import test from "node:test"
import { addressSuggestions, currentViewAddresses, enteredAddresses } from "../src/known-addresses.ts"
import type { ResolvedUiNode } from "@cam/screen"

const alice = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"
const bob = "0x1111111111111111111111111111111111111111"

test("known addresses retain supplied roles without inventing identities or duplicate choices", () => {
  assert.deepEqual(addressSuggestions([
    { address: alice, label: "Signing wallet" },
    { address: alice.toUpperCase().replace("0X", "0x"), label: "Current view: Owner" },
    { address: bob, label: "Loaded contract: contracts.Registry" },
    { address: `0x${"0".repeat(40)}`, label: "Unassigned" },
    { address: `0x${"1".repeat(64)}`, label: "Digest" },
  ]), [
    { address: alice, label: "Signing wallet; Current view: Owner" },
    { address: bob, label: "Loaded contract: contracts.Registry" },
  ])
})

test("only typed Address facts contribute names; current roles are not retained across views", () => {
  const view = (owner: string): ResolvedUiNode => ({ element: "Fragment", props: {}, children: [
    { element: "Address", props: { label: "Owner", address: owner }, children: [] },
    { element: "Status", props: { label: "Not an address declaration", value: alice }, children: [] },
    { element: "TextField", props: { label: "Address-like text" }, state: { key: "text" }, children: [] },
  ] })
  assert.deepEqual(currentViewAddresses(view(alice)), [{ address: alice, label: "Current view: Owner" }])
  assert.deepEqual(currentViewAddresses(view(bob)), [{ address: bob, label: "Current view: Owner" }])
})

test("entered-address history is bounded, case-insensitive and does not learn partial or zero values", () => {
  const first = [{ address: alice, label: "Entered in: Contractor" }]
  assert.equal(enteredAddresses(first, { address: "0xabc", label: "Incomplete" }), first)
  assert.equal(enteredAddresses(first, { address: `0x${"0".repeat(40)}`, label: "Zero" }), first)
  assert.equal(enteredAddresses(first, { address: alice, label: "Entered in: Arbitrator" }).length, 1)
  let history: readonly { address: string; label: string }[] = first
  for (let i = 1; i <= 25; i++) history = enteredAddresses(history, { address: `0x${i.toString(16).padStart(40, "0")}`, label: "Entered in: Recipient" })
  assert.equal(history.length, 20)
  assert.equal(history[0]?.address, `0x${(25).toString(16).padStart(40, "0")}`)
  assert(!history.some(item => item.address === alice))
})
