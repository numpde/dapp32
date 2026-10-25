import assert from "node:assert/strict"
import test from "node:test"
import { CamEvmError, sendCamContractCall, simulateCamContractCall } from "@cam/evm-viem"
import type { CamSimulationClient, CamWalletClient } from "@cam/evm-viem"
import { resolvedUiButtons } from "@cam/screen"
import { createCamViewerSession } from "@cam/viewer"
import { UserRejectedRequestError } from "viem"
import {
  BIKE_ACCOUNT_ADDRESS, BIKE_COMPONENTS_ADDRESS, BIKE_HOST_ADDRESS, BIKE_TOKEN_ID,
} from "../../../../tests/fixtures/cam/bike.mts"
import {
  BUYER, CURRENT_COLLECTION, ownerWorkflowSessionOptions,
} from "../../../../tests/fixtures/cam/bike-owner-workflows.mts"
import { preparedCallFields } from "../src/prepared-call.ts"
import { submitPreparedContractCall } from "../src/transactions.ts"
import type { PreparedCallSubmitterPorts } from "../src/transactions.ts"

const chain = {
  id: 31337, name: "Bike fixture",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
}
const hash = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const

test("Bike handover review and rejected-wallet retry preserve the record collection, owner and recipient", async () => {
  const fixture = ownerWorkflowSessionOptions()
  const session = createCamViewerSession(fixture.options)
  await session.load()
  const snapshot = session.updateState({ to: BUYER })
  const action = resolvedUiButtons(snapshot.resolvedUi).find(button => button.call.function === "transferComponent")
  assert.ok(action, "published Bike owner screen must expose handover review")
  assert.equal(session.actionKind(action), "contractCall", "the manifest identifies handover as transaction preparation")
  const prepared = await session.dispatchAction(action)
  assert.equal(prepared.type, "contractCall")
  if (prepared.type !== "contractCall") assert.fail("handover must prepare a contract call")
  const fields = preparedCallFields(prepared.call)
  assert.equal(fields.find(field => field.label === "Contract address")?.value, BIKE_COMPONENTS_ADDRESS)
  assert.notEqual(prepared.call.address, CURRENT_COLLECTION)
  assert.equal(prepared.call.function, "safeTransferFrom(address,address,uint256)")
  assert.deepEqual({ ...prepared.call.args }, { from: BIKE_ACCOUNT_ADDRESS, to: BUYER, tokenId: BIKE_TOKEN_ID.toString() })

  const simulations: Parameters<CamSimulationClient["simulateContract"]>[0][] = []
  const submissions: Parameters<CamWalletClient["writeContract"]>[0][] = []
  const publicClient: CamSimulationClient = {
    async simulateContract(request) { simulations.push(request) },
  }
  const rejection = new UserRejectedRequestError(new Error("User canceled handover"))
  const walletClient: CamWalletClient = {
    async writeContract(request) {
      submissions.push(request)
      if (submissions.length === 1) throw rejection
      return hash
    },
  }
  const ports: PreparedCallSubmitterPorts<CamWalletClient, typeof chain> = {
    async ensureAccount(address) { assert.equal(address, BIKE_ACCOUNT_ADDRESS) },
    simulate: simulateCamContractCall,
    async ensureChain(startup) { assert.equal(startup.chainId, "eip155:31337") },
    createWalletClient: () => walletClient,
    chain: () => chain,
    send: sendCamContractCall,
  }
  const submit = () => submitPreparedContractCall({
    ports, publicClient, walletAddress: BIKE_ACCOUNT_ADDRESS,
    startup: {
      chainId: "eip155:31337", host: BIKE_HOST_ADDRESS, account: BIKE_ACCOUNT_ADDRESS,
      rpcUrl: "http://127.0.0.1:8545", inputs: {},
    },
    call: prepared.call, shouldContinue: () => true,
  })
  const reviewed = session.snapshot()
  await assert.rejects(submit, error => error instanceof CamEvmError && error.code === "CAM_WRITE_FAILED" && error.cause === rejection)
  assert.equal(submissions.length, 1, "wallet cancellation must not automatically resubmit")
  assert.deepEqual(session.snapshot(), reviewed, "wallet cancellation must not navigate or claim a changed owner")
  assert.equal(await submit(), hash)
  assert.equal(simulations.length, 2, "explicit retry must simulate the reviewed handover again")
  assert.equal(submissions.length, 2)
  for (const request of [...simulations, ...submissions]) {
    assert.equal(request.address, BIKE_COMPONENTS_ADDRESS)
    assert.equal(request.functionName, "safeTransferFrom")
    assert.deepEqual(request.args, [BIKE_ACCOUNT_ADDRESS, BUYER, BIKE_TOKEN_ID])
    assert.equal(request.value, undefined)
  }
  assert.equal(fixture.reads.filter(read => read.functionName === "tokenReference").length, 1,
    "wallet retry must not silently resolve a different NFT than the reviewed handover")
  assert.deepEqual(session.snapshot(), reviewed, "a transaction hash alone must not refresh to a new owner")
})
