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

test("escrow tasks own their screen titles and place ID lookup after the task", async () => {
  const ui = await escrowUi()
  for (const [view, title, primaryField] of [
    [createView(), "Create and fund an escrow agreement", "agreementRef"],
    [agreementView({ viewId: "escrow.agreement.active", stateId: "submitted", transitionIds: [] }), "View and manage an escrow agreement", "submissionUri"],
    [agreementView({ viewId: "escrow.agreement.terminal", stateId: "released.clientApproval", transitionIds: [] }), "View a closed escrow agreement", "submissionUri"],
    [{ viewId: "escrow.credit.empty", account: ACCOUNT, amount: "0", actions: [] }, "Withdraw account credit", "recipient"],
    [{ viewId: "escrow.credit.available", account: ACCOUNT, amount: "1", actions: ["withdrawTo"] }, "Withdraw account credit", "recipient"],
  ] as const) {
    const { resolvedUi } = resolveInitialUiNode(ui, "app", args(view), CONTEXT)
    assert.equal(resolvedUi.element, "Screen")
    assert.equal(resolvedUi.props.title, title)
    const fields: string[] = []
    forEachResolvedUiNode(resolvedUi, (node) => {
      if ("state" in node) fields.push(node.state.key)
    })
    assert.ok(fields.indexOf(primaryField) < fields.indexOf("agreementId"), `${view.viewId} leads with its task`)
  }
})

test("creation distinguishes client-reference lookup from independent ID lookup and preparing funding", async () => {
  const { resolvedUi } = resolveInitialUiNode(await escrowUi(), "app", args(createView()), CONTEXT)
  const labels: string[] = []
  const texts: string[] = []
  forEachResolvedUiNode(resolvedUi, (node) => {
    if (node.element === "Address") labels.push(String(node.props.label))
    if (node.element === "Text") texts.push(String(node.props.text))
  })
  assert.ok(labels.includes("Proposed client (address being viewed)"))
  assert.match(String(requiredButton(resolvedUi, "lookupAgreement").props.label), /client and reference/i)
  assert.deepEqual(plain(requiredButton(resolvedUi, "lookupAgreement").call.args), { client: ACCOUNT, agreementRef: "" })
  assert.match(String(requiredButton(resolvedUi, "agreement").props.label), /by ID/)
  assert.match(String(requiredButton(resolvedUi, "createAgreement").props.label), /Prepare/)
  assert.ok(texts.some((text) => text.includes("submit it separately") && text.includes("confirmed transaction")))
})

test("creation explains required party, reference and document inputs beside their fields", async () => {
  const { resolvedUi } = resolveInitialUiNode(await escrowUi(), "app", args(createView()), CONTEXT)
  const reference = precedingHelp(resolvedUi, "agreementRef")
  assert.match(reference, /required/i)
  assert.match(reference, /unique for this client/i)
  assert.match(reference, /case and spaces/)
  assert.match(reference, /separate agreement ID/)
  const parties = precedingHelp(resolvedUi, "contractor")
  assert.match(parties, /40 hexadecimal/)
  assert.match(parties, /all-zero placeholders/)
  assert.match(parties, /must differ/)
  assert.match(precedingHelp(resolvedUi, "amount"), /positive amount/)
  assert.match(precedingHelp(resolvedUi, "amount"), /1,000,000,000,000,000,000 wei/)
  const terms = precedingHelp(resolvedUi, "termsUri")
  assert.match(terms, /both fields are required/i)
  assert.match(terms, /exact document bytes/)
  assert.match(terms, /local file or a browser-readable URL/)
  assert.match(terms, /enter it manually/)
  assert.match(terms, /not uploaded or checked against the URI/)
  assert.match(precedingHelp(resolvedUi, "agreementId"), /0x followed by 64 hexadecimal/)
  assert.match(precedingHelp(resolvedUi, "agreementId"), /differs from the client’s reference/)
})

test("each creation duration explains its start and timeout beneficiary beside the field", async () => {
  const { resolvedUi } = resolveInitialUiNode(await escrowUi(), "app", args(createView()), CONTEXT)
  assert.match(precedingHelp(resolvedUi, "acceptanceDuration"), /required whole seconds/)
  assert.match(precedingHelp(resolvedUi, "acceptanceDuration"), /do not execute automatically/)
  const nodes: ResolvedUiNode[] = []
  forEachResolvedUiNode(resolvedUi, (node) => nodes.push(node))
  for (const [field, start, recipient] of [
    ["acceptanceDuration", "creation", "client"],
    ["workDuration", "acceptance", "client"],
    ["reviewDuration", "submission", "contractor"],
    ["arbitrationDuration", "dispute", "chosen timeout recipient"],
  ]) {
    const index = nodes.findIndex((node) => "state" in node && node.state.key === field)
    const help = nodes[index + 1]
    assert.ok(help?.element === "Text", `${field} has adjacent phase help`)
    const text = String(help.props.text)
    assert.ok(text.includes(`Starts at ${start}.`))
    assert.ok(text.includes(`At or after it, anyone can finalize full credit to the ${recipient}`))
  }
})

test("agreement evidence fields explain explicit calculation and required pairs even when disabled", async () => {
  const { resolvedUi } = resolveInitialUiNode(await escrowUi(), "app", args(agreementView({
    viewId: "escrow.agreement.terminal", stateId: "released.clientApproval", transitionIds: [],
  })), CONTEXT)
  for (const field of ["submissionUri", "disputeUri"]) {
    const help = precedingHelp(resolvedUi, field)
    assert.match(help, /both fields are required/i)
    assert.match(help, /512 UTF-8 bytes/)
    assert.match(help, /exact file bytes or a browser-readable URL/)
    assert.match(help, /enter the digest manually/)
    assert.match(help, /not uploaded or checked against the URI/)
  }
  const texts: string[] = []
  forEachResolvedUiNode(resolvedUi, (node) => {
    if (node.element === "Text") texts.push(String(node.props.text))
  })
  assert.ok(texts.some((text) => /0 means closed, with no timeout/.test(text)))
  assert.ok(texts.some((text) => /claimed SHA-256 fingerprint/.test(text) && /do not fetch or verify/.test(text)))
  assert.ok(texts.some((text) => /empty evidence URI and all-zero digest/.test(text)))
})

test("credit distinguishes the credit owner, full amount and withdrawal destination", async () => {
  for (const amount of ["0", "1000000000000000000"]) {
    const { resolvedUi } = resolveInitialUiNode(await escrowUi(), "app", args({
      viewId: amount === "0" ? "escrow.credit.empty" : "escrow.credit.available",
      account: ACCOUNT, amount, actions: amount === "0" ? [] : ["withdrawTo"],
    }), CONTEXT)
    const help = precedingHelp(resolvedUi, "recipient")
    assert.match(help, /may differ from the credit owner/)
    assert.match(help, /defaults to the account being viewed/)
    assert.match(help, /0x followed by 40 hexadecimal/)
    assert.match(help, /zero address and this escrow contract are rejected/)
    const recipient = requiredField(resolvedUi, "recipient")
    const withdrawal = requiredButton(resolvedUi, "withdrawTo")
    assert.equal(isDisabled(recipient), amount === "0")
    assert.equal(isDisabled(withdrawal), amount === "0")
    const texts: string[] = []
    const statusLabels: string[] = []
    forEachResolvedUiNode(resolvedUi, (node) => {
      if (node.element === "Text") texts.push(String(node.props.text))
      if (node.element === "Status") statusLabels.push(String(node.props.label))
    })
    assert.ok(statusLabels.includes("Total withdrawable credit for this account (wei)"))
    assert.ok(texts.some((text) => /payments and refunds from all agreements for the account being viewed, less previous withdrawals/.test(text)))
    assert.ok(texts.some((text) => /1 native asset = 1,000,000,000,000,000,000 wei/.test(text)))
    assert.ok(texts.some((text) => /When credit is available, send the withdrawal transaction from the account shown/.test(text)))
    assert.ok(texts.some((text) => /full balance; partial withdrawals are unavailable/.test(text)))
    if (amount === "0") {
      assert.ok(texts.includes("No credit is available to withdraw."))
      assert.ok(!texts.some((text) => /Review the prepared transaction/.test(text)))
    } else {
      assert.ok(texts.some((text) => /Review the prepared transaction, then submit it separately with your wallet./.test(text)))
    }
  }
})

test("agreement copy describes the viewed role and arbitrator non-consent without contradictory acknowledgement rows", async () => {
  const { resolvedUi } = resolveInitialUiNode(await escrowUi(), "app", args(agreementView({
    viewId: "escrow.agreement.terminal", stateId: "released.clientApproval", transitionIds: [],
  })), CONTEXT)
  const labels: string[] = []
  const texts: string[] = []
  forEachResolvedUiNode(resolvedUi, (node) => {
    if (node.element === "Status") labels.push(String(node.props.label))
    if (node.element === "Text") texts.push(String(node.props.text))
  })
  assert.ok(labels.includes("Role of the address being viewed"))
  assert.ok(!labels.some((label) => /acknowledgement/i.test(label)))
  assert.ok(texts.some((text) => /arbitrator.*does not confirm.*consent/.test(text)))
  assert.ok(texts.some((text) => text.startsWith("Agreement-changing actions") && text.includes("Submit it separately")))
  assert.ok(texts.some((text) => text.includes("closed") && text.includes("no further agreement-changing actions")))
})

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
  assert.equal(displayed.get("Allowed arbitration timeout recipients"), "client, contractor")
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
  assert.equal(displayed.get("Original escrow amount in wei"), "1000000000000000000")
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
    "createAgreement",
    "lookupAgreement",
    "agreement",
    "accountCredit",
  ])

  const create = requiredButton(resolvedUi, "createAgreement")
  assert.deepEqual(plain(create.call.args), {
    params: {
      agreementRef: "",
      contractor: "0x0000000000000000000000000000000000000000",
      arbitrator: "0x0000000000000000000000000000000000000000",
      arbitrationTimeoutBeneficiary: "1",
      amount: null,
      acceptanceDuration: null,
      workDuration: null,
      reviewDuration: null,
      arbitrationDuration: null,
      terms: {
        uri: "",
        sha256Digest: ZERO_DIGEST,
      },
    },
  })
  assert.equal(state.amount, null)
  for (const name of ["acceptanceDuration", "workDuration", "reviewDuration", "arbitrationDuration"]) {
    assert.equal(state[name], null)
    const field = requiredField(resolvedUi, name)
    assert.ok(field.element === "NonNegativeIntegerField")
    assert.deepEqual(field.draft, { text: "", status: "empty" })
    assert.equal(field.props.min, "1")
    assert.equal(field.props.max, "31536000")
  }
  const amounts: ResolvedUiNode[] = []
  forEachResolvedUiNode(resolvedUi, (node) => {
    if (node.element === "AmountField") amounts.push(node)
  })
  assert.equal(amounts.length, 1)
  const amount = amounts[0]
  assert.ok(amount?.element === "AmountField")
  assert.deepEqual(amount.draft, { representation: "base", baseText: "", displayText: "", status: "empty" })
  assert.deepEqual(amount.unit, { assetId: "native", baseLabel: "wei", displayLabel: "Native asset", decimals: 18 })
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
    "approveAgreement",
    "disputeAgreement",
    "accountCredit",
    "createAgreementForm",
    "agreement",
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
    "accountCredit",
    "createAgreementForm",
    "agreement",
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
    "withdrawTo",
    "createAgreementForm",
    "agreement",
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
    if ((node.element === "TextField" || node.element === "DocumentHashField" || node.element === "AmountField" || node.element === "NonNegativeIntegerField") && node.state.key === name) field = node
  })
  assert.notEqual(field, undefined, `missing resolved field: ${name}`)
  return field as ResolvedUiNode
}

function precedingHelp(resolvedUi: ResolvedUiNode, name: string): string {
  const nodes: ResolvedUiNode[] = []
  forEachResolvedUiNode(resolvedUi, (node) => nodes.push(node))
  const index = nodes.findIndex((node) => "state" in node && node.state.key === name)
  assert.ok(index > 0, `missing field or preceding help: ${name}`)
  const help = nodes[index - 1]
  assert.ok(help?.element === "Text", `${name} has adjacent help`)
  return String(help.props.text)
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
