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
  forEachResolvedUiNode,
  resolvedUiButtons,
  resolvedUiInputNames,
  resolveInitialUiNode,
  resolveUiNode,
} from "../src/index.ts"
import type {
  ResolvedButtonNode,
  ResolvedUiNode,
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
    "agreementId",
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
    "agreement",
    "createAgreement",
    "lookupAgreement",
    "accountCredit",
  ])

  const create = requiredButton(resolvedUi, "createAgreement")
  assert.deepEqual(plain(create.call.args), {
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

test("known agreement ID opens the agreement route without create-form inputs", async () => {
  const ui = await escrowUi()
  const { state } = resolveInitialUiNode(ui, "app", args(createView()), CONTEXT)
  const resolvedUi = resolveUiNode(
    ui,
    "app",
    args(createView()),
    { ...CONTEXT, state: { ...state, agreementId: AGREEMENT_ID } },
  )

  const open = requiredButton(resolvedUi, "agreement")
  assert.equal(open.call.namespace, "routes")
  assert.deepEqual(plain(open.call.args), { agreementId: AGREEMENT_ID })
})

test("escrow active screen enables only projected transitions", async () => {
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

  assert.deepEqual(availableButtonFunctions(resolvedUi), [
    "agreement",
    "approveAgreement",
    "disputeAgreement",
    "accountCredit",
    "createAgreementForm",
  ])
  assert.deepEqual(resolvedUiInputNames(resolvedUi), [
    "agreementId",
    "disputeDigest",
    "disputeUri",
    "submissionDigest",
    "submissionUri",
  ])

  assert.deepEqual(plain(requiredButton(resolvedUi, "approveAgreement").call.args), {
    agreementId: AGREEMENT_ID,
  })
  assert.deepEqual(plain(requiredButton(resolvedUi, "disputeAgreement").call.args), {
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

  assert.deepEqual(availableButtonFunctions(resolvedUi), [
    "agreement",
    "accountCredit",
    "createAgreementForm",
  ])
  assert.deepEqual(resolvedUiInputNames(resolvedUi), [
    "agreementId", "disputeDigest", "disputeUri", "submissionDigest", "submissionUri",
  ])
  for (const action of AGREEMENT_ACTIONS) {
    assert.equal(isDisabled(requiredButton(resolvedUi, action)), true, `${action} remains visible but unavailable`)
  }
  for (const [name] of EVIDENCE_FIELDS) {
    assert.equal(isDisabled(requiredField(resolvedUi, name)), true, `${name} remains visible but unavailable`)
  }
})

const AGREEMENT_ACTIONS = [
  "cancelAgreement",
  "acceptAgreement",
  "submitAgreement",
  "approveAgreement",
  "disputeAgreement",
  "finalizeAcceptanceTimeout",
  "finalizeWorkTimeout",
  "finalizeReviewTimeout",
  "resolveForClient",
  "resolveForContractor",
  "finalizeArbitrationTimeout",
] as const

const EVIDENCE_FIELDS = [
  ["submissionUri", "submitAgreement"],
  ["submissionDigest", "submitAgreement"],
  ["disputeUri", "disputeAgreement"],
  ["disputeDigest", "disputeAgreement"],
] as const

for (const projected of [
  [],
  ["finalizeAcceptanceTimeout"],
  ["submitAgreement"],
  ["disputeAgreement"],
  // This combined projection exercises composition, not contract reachability.
  ["submitAgreement", "disputeAgreement"],
] as readonly (readonly string[])[]) {
  test(`escrow active controls remain visible and follow projected availability: ${projected.join(",") || "none"}`, async () => {
    const { resolvedUi } = resolveInitialUiNode(
      await escrowUi(),
      "app",
      args(agreementView({
        viewId: "escrow.agreement.active",
        stateId: "submitted",
        transitionIds: projected,
      })),
      CONTEXT,
    )

    assert.deepEqual(resolvedUiInputNames(resolvedUi), [
      "agreementId", "disputeDigest", "disputeUri", "submissionDigest", "submissionUri",
    ])
    const buttons = resolvedUiButtons(resolvedUi)
    assert.deepEqual(
      buttons.filter((button) => AGREEMENT_ACTIONS.some((action) => action === button.call.function))
        .map((button) => button.call.function).sort(),
      [...AGREEMENT_ACTIONS].sort(),
    )
    for (const action of AGREEMENT_ACTIONS) {
      const button = requiredButton(resolvedUi, action)
      assert.equal(isDisabled(button), !projected.includes(action), `${action} availability`)
      assert.equal(button.call.args.agreementId, AGREEMENT_ID, `${action} agreement target`)
    }
    for (const [name, action] of EVIDENCE_FIELDS) {
      assert.equal(isDisabled(requiredField(resolvedUi, name)), !projected.includes(action), `${name} editability`)
    }
    assert.equal(isDisabled(requiredField(resolvedUi, "agreementId")), false)
    for (const navigation of ["agreement", "accountCredit", "createAgreementForm"]) {
      assert.equal(isDisabled(requiredButton(resolvedUi, navigation)), false, `${navigation} navigation`)
    }
  })
}

test("escrow availability changes preserve evidence drafts and the viewed agreement target", async () => {
  const ui = await escrowUi()
  const initial = resolveInitialUiNode(ui, "app", args(agreementView({
    viewId: "escrow.agreement.active",
    stateId: "submitted",
    transitionIds: ["submitAgreement", "disputeAgreement"],
  })), CONTEXT)
  const draft = {
    ...initial.state,
    agreementId: `0x${"cd".repeat(32)}`,
    submissionUri: "ipfs://draft-submission",
    submissionDigest: `0x${"12".repeat(32)}`,
    disputeUri: "ipfs://draft-dispute",
    disputeDigest: `0x${"34".repeat(32)}`,
  }
  const before = plain(draft)
  for (const projected of [[], ["submitAgreement", "disputeAgreement"]]) {
    const resolvedUi = resolveUiNode(ui, "app", args(agreementView({
      viewId: "escrow.agreement.active",
      stateId: "submitted",
      transitionIds: projected,
    })), { ...CONTEXT, state: draft })
    for (const [name, action] of EVIDENCE_FIELDS) {
      assert.equal(isDisabled(requiredField(resolvedUi, name)), !projected.includes(action))
    }
    assert.deepEqual(plain(requiredButton(resolvedUi, "submitAgreement").call.args), {
      agreementId: AGREEMENT_ID,
      submission: { uri: draft.submissionUri, sha256Digest: draft.submissionDigest },
    })
    assert.deepEqual(plain(requiredButton(resolvedUi, "disputeAgreement").call.args), {
      agreementId: AGREEMENT_ID,
      dispute: { uri: draft.disputeUri, sha256Digest: draft.disputeDigest },
    })
    assert.equal(requiredButton(resolvedUi, "agreement").call.args.agreementId, draft.agreementId)
    assert.deepEqual(plain(draft), before)
  }
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
    "agreement",
    "withdrawTo",
    "createAgreementForm",
  ])
  assert.deepEqual(resolvedUiInputNames(resolvedUi), ["agreementId", "recipient"])
  assert.equal(state.recipient, ACCOUNT)
  assert.deepEqual(plain(requiredButton(resolvedUi, "withdrawTo").call.args), {
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

function availableButtonFunctions(resolvedUi: ResolvedUiNode): readonly string[] {
  return resolvedUiButtons(resolvedUi).filter((button) => !isDisabled(button)).map((button) => button.call.function)
}

function isDisabled(node: ResolvedUiNode): boolean {
  return "disabled" in node && node.disabled === true
}

function requiredField(resolvedUi: ResolvedUiNode, name: string): ResolvedUiNode {
  let field: ResolvedUiNode | undefined
  forEachResolvedUiNode(resolvedUi, (node) => {
    if (node.element === "TextField" && node.state.key === name) field = node
  })
  assert.notEqual(field, undefined, `missing resolved field: ${name}`)
  return field as ResolvedUiNode
}

function requiredButton(
  resolvedUi: Parameters<typeof resolvedUiButtons>[0],
  functionName: string,
): ResolvedButtonNode {
  const button = resolvedUiButtons(resolvedUi).find((candidate) => candidate.call.function === functionName)
  assert.notEqual(button, undefined, `missing resolved button: ${functionName}`)
  return button as ResolvedButtonNode
}

function plain(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}
