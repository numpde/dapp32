import assert from "node:assert/strict"
import test from "node:test"
import { publicRpcEndpoints } from "../src/rpc-catalog.ts"

test("public RPC choices belong to the requested chain and require no key expansion", () => {
  const endpoints = publicRpcEndpoints("eip155:43113")
  assert(endpoints.some(endpoint => new URL(endpoint.url).hostname === "api.avax-test.network"))
  assert(endpoints.every(endpoint => !/[{}]/u.test(endpoint.url) && new URL(endpoint.url).protocol === "https:"))
  assert(!endpoints.some(endpoint => new URL(endpoint.url).hostname === "api.avax.network"), "Fuji must not use the mainnet service")
  const ethereum = publicRpcEndpoints("eip155:1")
  assert(ethereum.some(endpoint => new URL(endpoint.url).hostname === "ethereum-rpc.publicnode.com"))
  assert(!ethereum.some(endpoint => new URL(endpoint.url).hostname === "eth-mainnet.g.alchemy.com"), "a credential template is not an anonymous browser endpoint")
})

test("unknown and retired chains require custom RPC instead of borrowing another chain", () => {
  assert.deepEqual(publicRpcEndpoints("eip155:31337"), [])
  assert.deepEqual(publicRpcEndpoints("eip155:534351"), [])
})
