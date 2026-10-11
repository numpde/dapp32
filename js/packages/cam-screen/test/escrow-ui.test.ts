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

test("escrow limits declare exact readable units without changing contract values", async () => {
  const { resolvedUi } = resolveInitialUiNode(await escrowUi(), "app", args(createView()), CONTEXT)
  const displayed = new Map<string, string>()
  const texts: string[] = []
  forEachResolvedUiNode(resolvedUi, (node) => {
    if (node.element === "Text") texts.push(String(node.props.text))
    if (node.element === "Status" && "formattedValue" in node) {
      displayed.set(String(node.props.label), String(node.formattedValue))
    }
  })
  assert.ok(texts.includes("Contract limits"))
  assert.equal(displayed.get("Reference limit"), "128 bytes")
  assert.equal(displayed.get("Document URI limit"), "512 bytes")
  assert.equal(displayed.get("Maximum phase duration"), "365 days (31,536,000 seconds)")
  assert.equal(displayed.get("Arbitration timeout recipients"), "client, contractor")
})

test("agreement durations use declared units while monetary values remain exact wei", async () => {
  const { resolvedUi } = resolveInitialUiNode(await escrowUi(), "app", args(agreementView({
    viewId: "escrow.agreement.active", stateId: "submitted", transitionIds: [],
  })), CONTEXT)
  const displayed = new Map<string, string>()
  forEachResolvedUiNode(resolvedUi, (node) => {
    if (node.element === "Status") {
      displayed.set(String(node.props.label), "formattedValue" in node ? String(node.formattedValue) : String(node.props.value))
    }
  })
  assert.equal(displayed.get("Acceptance duration"), "1 hour (3,600 seconds)")
  assert.equal(displayed.get("Work duration"), "2 hours (7,200 seconds)")
  assert.equal(displayed.get("Review duration"), "1 hour (3,600 seconds)")
  assert.equal(displayed.get("Arbitration duration"), "1 day (86,400 seconds)")
  assert.equal(displayed.get("Amount in wei"), "1000000000000000000")
})

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

for (const viewId of [
  "escrow.agreement.active",
  "escrow.agreement.terminal",
  "escrow.agreement.absent",
]) {
  test(`${viewId} starts lookup from the selected agreement without retargeting transitions`, async () => {
    const ui = await escrowUi()
    const view = agreementView({ viewId, stateId: "submitted", transitionIds: [] })
    const initial = resolveInitialUiNode(ui, "app", args(view), CONTEXT)
    assert.equal(initial.state.agreementId, AGREEMENT_ID)
    assert.equal(requiredButton(initial.resolvedUi, "agreement").call.args.agreementId, AGREEMENT_ID)

    const otherId = `0x${"cd".repeat(32)}`
    const edited = resolveUiNode(ui, "app", args(view), {
      ...CONTEXT, state: { ...initial.state, agreementId: otherId },
    })
    assert.equal(requiredButton(edited, "agreement").call.args.agreementId, otherId)
    for (const button of resolvedUiButtons(edited)) {
      if (AGREEMENT_ACTIONS.some((action) => action === button.call.function)) {
        assert.equal(button.call.args.agreementId, AGREEMENT_ID, `${button.call.function} retains the selected target`)
      }
    }
  })
}

test("each selected agreement initializes its own lookup; restored drafts remain independent", async () => {
  const ui = await escrowUi()
  const firstView = agreementView({
    viewId: "escrow.agreement.active", stateId: "submitted", transitionIds: [],
  })
  const first = resolveInitialUiNode(ui, "app", args(firstView), CONTEXT)
  const draftId = `0x${"cd".repeat(32)}`
  const draft = { ...first.state, agreementId: draftId }
  const secondId = `0x${"ef".repeat(32)}`
  const secondView = {
    ...firstView,
    machine: { ...firstView.machine, instanceId: secondId },
    agreement: { ...firstView.agreement, agreementId: secondId },
  }
  const second = resolveInitialUiNode(ui, "app", args(secondView), CONTEXT)
  assert.equal(first.state.agreementId, AGREEMENT_ID)
  assert.equal(second.state.agreementId, secondId)
  const restored = resolveUiNode(ui, "app", args(firstView), { ...CONTEXT, state: draft })
  assert.equal(requiredButton(restored, "agreement").call.args.agreementId, draftId)
  assert.equal(draft.agreementId, draftId)
  assert.equal(second.state.agreementId, secondId)
})

for (const view of [
  createView(),
  { viewId: "escrow.credit.empty", account: ACCOUNT, amount: "0", actions: [] },
  { viewId: "escrow.credit.available", account: ACCOUNT, amount: "1", actions: ["withdrawTo"] },
]) {
  test(`${view.viewId} starts with no selected agreement ID`, async () => {
    const { state, resolvedUi } = resolveInitialUiNode(await escrowUi(), "app", args(view), CONTEXT)
    assert.equal(state.agreementId, "")
    assert.equal(requiredButton(resolvedUi, "agreement").call.args.agreementId, "")
  })
}

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
