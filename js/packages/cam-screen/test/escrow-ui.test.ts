import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import {
  parseJsonBytes,
  toInertValue,
} from "@cam/protocol"
import type {
  InertRecord,
} from "@cam/protocol"

import {
  parseUi,
  resolvedUiButtons,
  resolvedUiInputNames,
  resolveInitialUiNode,
} from "../src/index.ts"
import type {
  ResolvedButtonNode,
  UiRuntimeContext,
} from "../src/index.ts"

const ESCROW_UI_URL = new URL("../../../../dapps/escrow/cam/ui.json", import.meta.url)
const ACCOUNT = "0x0000000000000000000000000000000000000011"
const CONTRACTOR = "0x0000000000000000000000000000000000000022"
const ARBITRATOR = "0x0000000000000000000000000000000000000033"
const AGREEMENT_ID = `0x${"ab".repeat(32)}`
const ZERO_DIGEST = `0x${"00".repeat(32)}`

const EMPTY_RECORD = {} as InertRecord

const CONTEXT: UiRuntimeContext = {
  host: {
    chainId: "eip155:31337",
    address: "0x0000000000000000000000000000000000000044",
  },
  account: {
    address: ACCOUNT,
  },
  inputs: EMPTY_RECORD,
  outputs: [],
  state: EMPTY_RECORD,
}

test("escrow creation screen resolves nested payable calldata from one form", async () => {
  const { state, resolvedUi } = resolveInitialUiNode(
    await escrowUi(),
    "app",
    args(createView()),
    CONTEXT,
  )

  assert.deepEqual(resolvedUiInputNames(resolvedUi), [
    "acceptanceDuration",
    "agreementRef",
    "amount",
    "arbitrationDuration",
    "arbitrationTimeoutBeneficiary",
    "arbitrator",
    "contractor",
    "reviewDuration",
    "termsDigest",
    "termsUri",
    "workDuration",
  ])
  assert.deepEqual(buttonFunctions(resolvedUi), [
    "createAgreement",
    "lookupAgreement",
    "accountCredit",
  ])

  const create = requiredButton(resolvedUi, "createAgreement")
  assert.deepEqual(create.call.args, {
    params: {
      agreementRef: "",
      contractor: "0x0000000000000000000000000000000000000000",
      arbitrator: "0x0000000000000000000000000000000000000000",
      arbitrationTimeoutBeneficiary: "1",
      amount: "0",
      acceptanceDuration: "0",
      workDuration: "0",
      reviewDuration: "0",
      arbitrationDuration: "0",
      terms: {
        uri: "",
        sha256Digest: ZERO_DIGEST,
      },
    },
  })
  assert.equal(state.amount, "0")
  assert.equal(state.arbitrationTimeoutBeneficiary, "1")
})

test("escrow active screen renders only projected transitions", async () => {
  const { resolvedUi } = resolveInitialUiNode(
    await escrowUi(),
    "app",
    args(agreementView({
      viewId: "escrow.agreement.active",
      stateId: "submitted",
      transitionIds: ["approveAgreement", "disputeAgreement"],
    })),
    CONTEXT,
  )

  assert.deepEqual(buttonFunctions(resolvedUi), [
    "approveAgreement",
    "disputeAgreement",
    "accountCredit",
    "createAgreementForm",
  ])
  assert.deepEqual(resolvedUiInputNames(resolvedUi), [
    "disputeDigest",
    "disputeUri",
    "submissionDigest",
    "submissionUri",
  ])

  assert.deepEqual(requiredButton(resolvedUi, "approveAgreement").call.args, {
    agreementId: AGREEMENT_ID,
  })
  assert.deepEqual(requiredButton(resolvedUi, "disputeAgreement").call.args, {
    agreementId: AGREEMENT_ID,
    dispute: {
      uri: "",
      sha256Digest: ZERO_DIGEST,
    },
  })
})

test("escrow terminal screen resolves with no machine transition", async () => {
  const { resolvedUi } = resolveInitialUiNode(
    await escrowUi(),
    "app",
    args(agreementView({
      viewId: "escrow.agreement.terminal",
      stateId: "released.clientApproval",
      transitionIds: [],
    })),
    CONTEXT,
  )

  assert.deepEqual(buttonFunctions(resolvedUi), [
    "accountCredit",
    "createAgreementForm",
  ])
  assert.deepEqual(resolvedUiInputNames(resolvedUi), [])
})

test("escrow available-credit screen binds withdrawal recipient to the account", async () => {
  const { state, resolvedUi } = resolveInitialUiNode(
    await escrowUi(),
    "app",
    args({
      viewId: "escrow.credit.available",
      account: ACCOUNT,
      amount: "1000000000000000000",
      actions: ["withdrawTo"],
    }),
    CONTEXT,
  )

  assert.deepEqual(buttonFunctions(resolvedUi), [
    "withdrawTo",
    "createAgreementForm",
  ])
  assert.deepEqual(resolvedUiInputNames(resolvedUi), ["recipient"])
  assert.equal(state.recipient, ACCOUNT)
  assert.deepEqual(requiredButton(resolvedUi, "withdrawTo").call.args, {
    recipient: ACCOUNT,
  })
})

async function escrowUi() {
  const bytes = new Uint8Array(await readFile(ESCROW_UI_URL))
  return parseUi(parseJsonBytes(bytes))
}

function createView() {
  return {
    viewId: "escrow.create",
    client: ACCOUNT,
    maxAgreementRefBytes: "128",
    maxDocumentUriBytes: "512",
    maxPhaseDuration: "31536000",
    arbitrationTimeoutBeneficiaryIds: ["client", "contractor"],
    actions: ["createAgreement"],
  }
}

function agreementView({
  viewId,
  stateId,
  transitionIds,
}: {
  readonly viewId: string
  readonly stateId: string
  readonly transitionIds: readonly string[]
}) {
  return {
    viewId,
    machine: {
      machineId: "escrow.agreement.v1",
      instanceId: AGREEMENT_ID,
      instantiated: true,
      stateId,
      transitionIds,
    },
    actor: ACCOUNT,
    actorRoleId: "client",
    agreement: {
      agreementId: AGREEMENT_ID,
      state: "3",
      client: ACCOUNT,
      contractor: CONTRACTOR,
      arbitrator: ARBITRATOR,
      arbitrationTimeoutBeneficiary: "1",
      amount: "1000000000000000000",
      acceptanceDuration: "3600",
      workDuration: "7200",
      reviewDuration: "3600",
      arbitrationDuration: "86400",
      deadline: "2000000000",
      agreementRef: "screen-smoke",
      terms: document("ipfs://terms", "11"),
      submission: document("ipfs://submission", "22"),
      dispute: document("", "00"),
    },
    arbitrationTimeoutBeneficiaryId: "client",
    arbitratorAcknowledgementRequired: false,
    arbitratorAcknowledgementDisclosure: "not required and not recorded on-chain",
  }
}

function document(uri: string, byte: string) {
  return {
    uri,
    sha256Digest: `0x${byte.repeat(32)}`,
  }
}

function args(view: unknown): InertRecord {
  return {
    view: toInertValue(view),
  }
}

function buttonFunctions(resolvedUi: Parameters<typeof resolvedUiButtons>[0]): readonly string[] {
  return resolvedUiButtons(resolvedUi).map((button) => button.call.function)
}

function requiredButton(
  resolvedUi: Parameters<typeof resolvedUiButtons>[0],
  functionName: string,
): ResolvedButtonNode {
  const button = resolvedUiButtons(resolvedUi).find((candidate) => candidate.call.function === functionName)
  assert.notEqual(button, undefined, `missing resolved button: ${functionName}`)
  return button as ResolvedButtonNode
}
