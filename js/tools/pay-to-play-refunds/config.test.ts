import assert from "node:assert/strict"
import test from "node:test"
import { parseConfig } from "./config.ts"
const config = {
  chainId: "31337", payment: `0x${"11".repeat(20)}`, codeHash: `0x${"ab".repeat(32)}`, channelId: "1",
  fromBlock: "0", toBlock: "10", confirmations: 1, blockChunk: 2, maxCustomers: 100, maxTransactions: 10,
  gasLimit: "300000", maxFeePerGas: "1000000000", maxPriorityFeePerGas: "100000000",
}
test("configuration has explicit scope and transaction fee bounds", () => {
  const result = parseConfig(config)
  assert.equal(result.channelId, 1n)
  assert.equal(result.maxFeePerGas, 1_000_000_000n)
  for (const change of [
    { extra: "unknown" }, { chainId: 1 }, { channelId: "-1" }, { gasLimit: "0" },
    { maxTransactions: 0 }, { maxCustomers: 1001 }, { confirmations: 0 },
    { maxPriorityFeePerGas: "2000000000" }, { toBlock: "100000" }, { fromBlock: "11" },
    { payment: `0x${"00".repeat(20)}` }, { codeHash: "0x" },
  ]) assert.throws(() => parseConfig({ ...config, ...change }))
})
