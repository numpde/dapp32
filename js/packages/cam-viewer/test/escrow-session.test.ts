import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import type { CamPublicClient } from "@cam/evm-viem"
import { toInertValue } from "@cam/protocol"
import { forEachResolvedUiNode, resolvedUiButtons } from "@cam/screen"
import { keccak256 } from "viem"
import type { Address } from "viem"

import { createCamViewerSession } from "../src/index.ts"
import type { CamViewerLoadedSnapshot } from "../src/index.ts"
import { createMockCamPublicClient, createMockResourceLoader } from "../../../../tests/fixtures/cam/mock.mts"

const CAM_DIRECTORY = new URL("../../../../dapps/escrow/cam/", import.meta.url)
const CAM_URI = "https://example.test/escrow/cam/main.json"
const ACCOUNT_A: Address = "0x0000000000000000000000000000000000000011"
const ACCOUNT_B: Address = "0x0000000000000000000000000000000000000022"
const HOST: Address = "0x0000000000000000000000000000000000000033"
const ESCROW: Address = "0x0000000000000000000000000000000000000044"
const UI: Address = "0x0000000000000000000000000000000000000055"

for (const [name, amountA, amountB] of [
  ["both accounts have different credits", 9007199254740993n, 37n],
  ["only the first account has credit", 19n, 0n],
  ["only the second account has credit", 0n, 23n],
  ["neither account has credit", 0n, 0n],
] as const) {
  test(`escrow operational credit follows the current account: ${name}`, async () => {
    const { session, reads } = await escrowSession(amountA, amountB)
    const creation = await session.load()
    const openCredit = requiredButton(creation, "accountCredit")
    assert.deepEqual(openCredit.call.args, toInertValue({}))
    const opened = await session.dispatchAction(openCredit)
    assert.equal(opened.type, "navigated")
    if (opened.type !== "navigated") throw new Error("Expected credit navigation")
    await assertCredit(session, opened.snapshot, ACCOUNT_A, amountA)

    await assertCredit(session, await session.setAccount({ address: ACCOUNT_B }), ACCOUNT_B, amountB)
    await assertCredit(session, await session.setAccount({ address: ACCOUNT_A }), ACCOUNT_A, amountA)
    assert.deepEqual(reads, [ACCOUNT_A, ACCOUNT_B, ACCOUNT_A])
  })
}

test("escrow credit rejects a caller-supplied account before reading contract state", async () => {
  const { session, reads } = await escrowSession(11n, 29n)
  const before = await session.load()
  await assert.rejects(
    () => session.navigate("accountCredit", { account: ACCOUNT_B }),
    /unexpected route input: account/,
  )
  assert.deepEqual(reads, [])
  assert.deepEqual(session.snapshot(), before)
})

test("failed credit-account reprojection preserves the last coherent account, credit and recipient", async () => {
  const { session, failCreditFor } = await escrowSession(41n, 53n)
  await session.load()
  await session.navigate("accountCredit", {})
  const before = session.updateState({ recipient: HOST })
  failCreditFor(ACCOUNT_B)
  await assert.rejects(() => session.setAccount({ address: ACCOUNT_B }), (error) => error instanceof Error && "cause" in error && error.cause instanceof Error && error.cause.message === "credit lookup unavailable")
  assert.deepEqual(session.snapshot(), before)
  assert.equal(session.snapshot().account?.address, ACCOUNT_A)
  assert.equal(session.snapshot().state?.recipient, HOST)
})

async function escrowSession(amountA: bigint, amountB: bigint) {
  const resources: Record<string, Uint8Array> = {}
  for (const path of ["main.json", "ui.json", "abi/CamEscrow.json", "abi/CamEscrowUI.json"]) {
    resources[new URL(path, CAM_URI).href] = new Uint8Array(await readFile(new URL(path, CAM_DIRECTORY)))
  }
  const rootBytes = resources[CAM_URI]
  assert.ok(rootBytes)
  const hostClient = createMockCamPublicClient({
    chainId: 31337,
    camURI: CAM_URI,
    camHash: keccak256(rootBytes),
    supportsCamInterface: true,
    addresses: { CamEscrow: ESCROW, CamEscrowUI: UI },
    routeResults: {},
  })
  const reads: unknown[] = []
  let failingAccount: Address | undefined
  const publicClient: CamPublicClient = {
    getChainId: hostClient.getChainId,
    readContract: async (request) => {
      if (request.functionName === "viewCreateAgreement") {
        return {
          viewId: "escrow.create",
          client: request.args?.[0],
          maxAgreementRefBytes: 128n,
          maxDocumentUriBytes: 512n,
          maxPhaseDuration: 31536000n,
          arbitrationTimeoutBeneficiaryIds: ["client", "contractor"],
          actions: ["createAgreement"],
        }
      }
      if (request.functionName === "viewAccountCredit") {
        assert.equal(request.address, UI)
        const account = request.args?.[0]
        reads.push(account)
        if (account === failingAccount) throw new Error("credit lookup unavailable")
        assert.ok(account === ACCOUNT_A || account === ACCOUNT_B)
        const amount = account === ACCOUNT_A ? amountA : amountB
        return {
          viewId: amount === 0n ? "escrow.credit.empty" : "escrow.credit.available",
          account,
          amount,
          actions: amount === 0n ? [] : ["withdrawTo"],
        }
      }
      return hostClient.readContract(request)
    },
  }
  return {
    session: createCamViewerSession({
      publicClient,
      host: { chainId: "eip155:31337", address: HOST },
      account: { address: ACCOUNT_A },
      inputs: {},
      allowUnsignedCamHash: false,
      loadResource: createMockResourceLoader(resources),
    }),
    reads,
    failCreditFor(account: Address) { failingAccount = account },
  }
}

async function assertCredit(
  session: ReturnType<typeof createCamViewerSession>,
  snapshot: CamViewerLoadedSnapshot,
  account: Address,
  amount: bigint,
) {
  assert.equal(snapshot.route, "accountCredit")
  assert.deepEqual(snapshot.inputs, toInertValue({}))
  assert.equal(snapshot.account?.address, account)
  let displayedAccount: unknown
  let displayedAmount: unknown
  let recipientDisabled: boolean | undefined
  forEachResolvedUiNode(snapshot.resolvedUi, (node) => {
    if (node.element === "Address" && node.props.label === "Account being viewed") displayedAccount = node.props.address
    if (node.element === "Status" && node.props.label === "Total withdrawable credit in wei") displayedAmount = node.props.value
    if (node.element === "TextField" && node.state.key === "recipient") recipientDisabled = node.disabled === true
  })
  assert.equal(displayedAccount, account)
  assert.equal(displayedAmount, String(amount))
  const withdrawals = resolvedUiButtons(snapshot.resolvedUi).filter((button) => button.call.function === "withdrawTo")
  assert.equal(withdrawals.length, 1)
  assert.equal(snapshot.state.recipient, account)
  assert.equal(recipientDisabled, amount === 0n)
  assert.equal(withdrawals[0]?.disabled === true, amount === 0n)
  if (amount === 0n) {
    await assert.rejects(() => session.dispatchAction(requiredButton(snapshot, "withdrawTo")), /disabled/)
    assert.throws(() => session.updateState({ recipient: HOST }), /disabled/)
    assert.deepEqual(session.snapshot(), snapshot)
    return
  }
  const prepared = await session.dispatchAction(requiredButton(snapshot, "withdrawTo"))
  assert.equal(prepared.type, "contractCall")
  if (prepared.type !== "contractCall") throw new Error("Expected withdrawal preparation")
  assert.equal(prepared.call.address, ESCROW)
  assert.equal(prepared.call.function, "withdrawTo")
  assert.deepEqual(prepared.call.args, toInertValue({ recipient: account }))
  assert.equal(prepared.call.then.function, "accountCredit")
  assert.deepEqual(prepared.call.then.args, toInertValue({}))
}

function requiredButton(snapshot: CamViewerLoadedSnapshot, route: string) {
  const button = resolvedUiButtons(snapshot.resolvedUi).find((candidate) => candidate.call.function === route)
  assert.ok(button, `Expected rendered ${route} action`)
  return button
}
