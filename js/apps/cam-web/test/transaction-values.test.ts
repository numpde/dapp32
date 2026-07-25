import assert from "node:assert/strict"
import test from "node:test"

import type {
  CamViewerPreparedContractCall,
} from "@cam/viewer"
import type {
  Address,
} from "viem"

import {
  submitPreparedContractCall,
} from "../src/transactions.ts"
import type {
  PreparedCallSimulationClient,
  PreparedCallSubmitterPorts,
} from "../src/transactions.ts"
import type {
  StartupOptions,
} from "../src/startup.ts"

const walletAddress = "0x0000000000000000000000000000000000000001" as Address
const txHash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const
const call: CamViewerPreparedContractCall = {
  route: "fund",
  address: "0x0000000000000000000000000000000000000002",
  abi: [{
    type: "function",
    name: "fund",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  }],
  function: "fund",
  args: {},
  value: "1000000000000000000",
  then: {
    namespace: "routes",
    function: "entry",
    args: {},
  },
}

test("browser submission hands the same valued call to simulation and signing", async () => {
  let simulated: CamViewerPreparedContractCall | undefined
  let sent: CamViewerPreparedContractCall | undefined
  const ports: PreparedCallSubmitterPorts<string, string> = {
    async ensureAccount() {},
    async simulate(args) {
      simulated = args.call
    },
    async ensureChain() {},
    createWalletClient() {
      return "wallet"
    },
    chain() {
      return "chain"
    },
    async send(args) {
      sent = args.call
      return txHash
    },
  }

  assert.equal(await submitPreparedContractCall({
    ports,
    publicClient: {} as PreparedCallSimulationClient,
    walletAddress,
    startup: startup(),
    call,
    shouldContinue: () => true,
  }), txHash)

  assert.equal(simulated, call)
  assert.equal(sent, call)
  assert.equal(simulated?.value, "1000000000000000000")
  assert.equal(sent?.value, "1000000000000000000")
})

function startup(): StartupOptions {
  return {
    chainId: "eip155:31337",
    host: "0x0000000000000000000000000000000000000003",
    account: walletAddress,
    rpcUrl: "http://127.0.0.1:8545",
    resourceOrigin: "http://127.0.0.1:5173",
    allowUnsignedCamHash: false,
  }
}
