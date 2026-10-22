import assert from "node:assert/strict"
import test from "node:test"
import { assertBikeActorFixture, assertBikeAuthority } from "./bike-actors.ts"

const seller = "0x0000000000000000000000000000000000000001"
const buyer = "0x0000000000000000000000000000000000000002"
const mechanic = "0x0000000000000000000000000000000000000003"

test("actor campaign requires the private Bike fixture and three distinct signers", () => {
  assert.doesNotThrow(() => assertBikeActorFixture("eip155:31337", "http://bike-nft-anvil:8545", [seller, buyer, mechanic]))
  for (const [chain, rpc] of [
    ["eip155:1", "http://bike-nft-anvil:8545"],
    ["eip155:31337", "https://mainnet.example"],
    ["eip155:31337", "http://bike-nft-anvil:8545.evil.example"],
    ["eip155:31337", "http://user:password@bike-nft-anvil:8545"],
    ["eip155:31337", "not a URL"],
  ]) assert.throws(() => assertBikeActorFixture(chain!, rpc!, [seller, buyer, mechanic]), /private Bike fixture/)
  assert.throws(() => assertBikeActorFixture("eip155:31337", "http://bike-nft-anvil:8545", [seller, buyer, seller]), /distinct/)
})

test("post-handover assertions reject stale seller and workshop authority", () => {
  const view = { owner: buyer, authorityId: "none", delegationActive: false, actions: ["lookupComponent", "delegation"] }
  assert.doesNotThrow(() => assertBikeAuthority([view], buyer, "none"))
  assert.throws(() => assertBikeAuthority([{ ...view, authorityId: "delegate", delegationActive: true }], buyer, "none"), /authority/)
  assert.throws(() => assertBikeAuthority([{ ...view, owner: seller }], buyer, "none"), /owner/)
  assert.throws(() => assertBikeAuthority([{ ...view, actions: ["updateComponentMetadata"] }], buyer, "none"), /write authority/)
  assert.throws(() => assertBikeAuthority([{ ...view, actions: ["transferComponent"] }], buyer, "none"), /write authority/)
  assert.throws(() => assertBikeAuthority([{ ...view, delegationActive: true }], buyer, "none"), /delegation/)
  assert.doesNotThrow(() => assertBikeAuthority([{ ...view, authorityId: "owner", actions: ["updateComponentMetadata", "transferComponent"] }], buyer, "owner"))
})

test("a transport failure is never counted as lost workshop authority", async () => {
  const { isUnauthorizedRevert } = await import("./bike-actors.ts")
  const { BaseError, ContractFunctionRevertedError, encodeErrorResult } = await import("viem")
  const abi = [{ type: "error", name: "Unauthorized", inputs: [] }] as const
  const reverted = new ContractFunctionRevertedError({ abi, data: encodeErrorResult({ abi, errorName: "Unauthorized" }), functionName: "updateComponentMetadata" })
  assert.equal(isUnauthorizedRevert(new Error("simulation", { cause: new BaseError("execution", { cause: reverted }) })), true)
  assert.equal(isUnauthorizedRevert(new Error("Unauthorized: connection failed")), false)
  assert.equal(isUnauthorizedRevert(new Error("simulation", { cause: new BaseError("RPC unavailable") })), false)
  const otherAbi = [{ type: "error", name: "Paused", inputs: [] }] as const
  const otherRevert = new ContractFunctionRevertedError({ abi: otherAbi, data: encodeErrorResult({ abi: otherAbi, errorName: "Paused" }), functionName: "updateComponentMetadata" })
  assert.equal(isUnauthorizedRevert(new Error("simulation", { cause: otherRevert })), false)
})
