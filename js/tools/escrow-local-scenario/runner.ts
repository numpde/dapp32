import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import {
  createPublicClient,
  createWalletClient,
  http,
} from "viem"
import type {
  Address,
  Chain,
  Hex,
} from "viem"
import {
  privateKeyToAccount,
} from "viem/accounts"

import {
  createHttpCamPublicClient,
  requireEvmAddress,
  sendCamContractCall,
  simulateCamContractCall,
} from "../../packages/cam-evm-viem/dist/index.js"
import type {
  CamHost,
} from "../../packages/cam-evm-viem/dist/index.js"
import {
  createCamViewerSession,
} from "../../packages/cam-viewer/dist/index.js"
import type {
  CamViewerLoadedSnapshot,
  CamViewerPreparedContractCall,
  CamViewerSession,
} from "../../packages/cam-viewer/dist/index.js"
import {
  resolvedUiButtons,
} from "../../packages/cam-screen/dist/index.js"
import {
  createSameOriginHttpResourceLoader,
  isRecordObject,
  parseJsonBytes,
  toInertValue,
} from "../../packages/cam-protocol/dist/index.js"
import type {
  InertRecord,
  InertValue,
} from "../../packages/cam-protocol/dist/index.js"

const AGREEMENT_AMOUNT = "1000000000000000"
const PHASE_DURATION = "60"
const TERMS_DIGEST = `0x${"11".repeat(32)}`
const SUBMISSION_DIGEST = `0x${"22".repeat(32)}`
const DISPUTE_DIGEST = `0x${"33".repeat(32)}`
const RECEIPT_TIMEOUT_MS = 20_000

const ROLE_ENV = {
  client: "ESCROW_CLIENT_PRIVATE_KEY",
  contractor: "ESCROW_CONTRACTOR_PRIVATE_KEY",
  arbitrator: "ESCROW_ARBITRATOR_PRIVATE_KEY",
  finalizer: "ESCROW_FINALIZER_PRIVATE_KEY",
} as const

type Role = keyof typeof ROLE_ENV

type Deployment = {
  readonly camRoot: Address
  readonly escrow: Address
}

type Fixture = {
  readonly rpcURL: string
  readonly resourceOrigin: string
  readonly deployment: Deployment
  readonly host: CamHost
  readonly accounts: Record<Role, ReturnType<typeof privateKeyToAccount>>
  readonly privateKeys: Record<Role, Hex>
  readonly chain: Chain
  readonly publicClient: ReturnType<typeof createHttpCamPublicClient>
  readonly fullPublicClient: ReturnType<typeof createPublicClient>
  readonly session: CamViewerSession
}

async function main(): Promise<void> {
  const fixture = await createFixture()
  const scenarios: readonly [string, () => Promise<void>][] = [
    ["client cancellation", () => cancellationScenario(fixture)],
    ["client approval", () => approvalScenario(fixture)],
    ["acceptance timeout", () => acceptanceTimeoutScenario(fixture)],
    ["work timeout", () => workTimeoutScenario(fixture)],
    ["review timeout", () => reviewTimeoutScenario(fixture)],
    ["arbitrator refunds client", () => resolveForClientScenario(fixture)],
    ["arbitrator releases contractor", () => resolveForContractorScenario(fixture)],
    ["arbitration timeout to client", () => arbitrationTimeoutScenario(fixture, "client")],
    ["arbitration timeout to contractor", () => arbitrationTimeoutScenario(fixture, "contractor")],
  ]

  for (const [name, run] of scenarios) {
    await run()
    process.stdout.write(`${JSON.stringify({ event: "scenario_ok", name })}\n`)
  }

  const escrowBalance = await fixture.fullPublicClient.getBalance({
    address: fixture.deployment.escrow,
  })
  assert.equal(escrowBalance, 0n, "all escrow and withdrawal liabilities must be discharged")

  process.stdout.write(`${JSON.stringify({
    event: "ok",
    scenarios: scenarios.length,
    escrow: fixture.deployment.escrow,
  })}\n`)
}

async function createFixture(): Promise<Fixture> {
  const rpcURL = requiredEnv("ESCROW_SCENARIO_RPC_URL")
  const resourceOrigin = requiredEnv("ESCROW_SCENARIO_RESOURCE_ORIGIN")
  const deployment = deploymentFromBroadcast(requiredEnv("ESCROW_SCENARIO_BROADCAST_PATH"))
  const privateKeys = Object.fromEntries(
    Object.entries(ROLE_ENV).map(([role, envName]) => [role, requiredPrivateKey(envName)]),
  ) as Record<Role, Hex>
  const accounts = Object.fromEntries(
    Object.entries(privateKeys).map(([role, key]) => [role, privateKeyToAccount(key)]),
  ) as Record<Role, ReturnType<typeof privateKeyToAccount>>

  const chain = {
    id: 31337,
    name: "Escrow local fixture",
    nativeCurrency: {
      name: "Ether",
      symbol: "ETH",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [rpcURL],
      },
    },
  } satisfies Chain
  const publicClient = createHttpCamPublicClient({ rpcURL })
  const fullPublicClient = createPublicClient({
    chain,
    transport: http(rpcURL),
  })
  assert.equal(await fullPublicClient.getChainId(), 31337)

  const loadResource = createSameOriginHttpResourceLoader({
    originInput: resourceOrigin,
    originLabel: "ESCROW_SCENARIO_RESOURCE_ORIGIN",
    fetchResource: fetch,
    loadFailurePrefix: "escrow local scenario failed to load CAM resource",
  })
  const host = {
    chainId: "eip155:31337",
    address: deployment.camRoot,
  } satisfies CamHost
  const session = createCamViewerSession({
    publicClient,
    host,
    account: { address: accounts.client.address },
    inputs: inertRecord({}),
    allowUnsignedCamHash: false,
    loadResource,
  })
  await session.load()

  return {
    rpcURL,
    resourceOrigin,
    deployment,
    host,
    accounts,
    privateKeys,
    chain,
    publicClient,
    fullPublicClient,
    session,
  }
}

async function cancellationScenario(fixture: Fixture): Promise<void> {
  const agreementId = await createAgreement(fixture, "local-cancel", "client")
  await executeAction(fixture, "client", "cancelAgreement")
  assertProjectedState(fixture.session, "cancelled.client")
  await withdrawCredit(fixture, "client")
  await assertTerminalNoMachineActions(fixture, agreementId)
}

async function approvalScenario(fixture: Fixture): Promise<void> {
  const agreementId = await createAgreement(fixture, "local-approve", "client")
  await assertAcceptanceNeedsNoArbitratorAcknowledgement(fixture)
  await executeAction(fixture, "contractor", "acceptAgreement")
  assertProjectedState(fixture.session, "accepted")
  await submitAgreement(fixture)
  await executeAction(fixture, "client", "approveAgreement")
  assertProjectedState(fixture.session, "released.clientApproval")
  await withdrawCredit(fixture, "contractor")
  await assertTerminalNoMachineActions(fixture, agreementId)
}

async function acceptanceTimeoutScenario(fixture: Fixture): Promise<void> {
  const agreementId = await createAgreement(fixture, "local-acceptance-timeout", "client")
  await advanceToCurrentDeadline(fixture)
  await executeAction(fixture, "finalizer", "finalizeAcceptanceTimeout")
  assertProjectedState(fixture.session, "refunded.acceptanceTimeout")
  await withdrawCredit(fixture, "client")
  await assertTerminalNoMachineActions(fixture, agreementId)
}

async function workTimeoutScenario(fixture: Fixture): Promise<void> {
  const agreementId = await createAgreement(fixture, "local-work-timeout", "client")
  await executeAction(fixture, "contractor", "acceptAgreement")
  await advanceToCurrentDeadline(fixture)
  await executeAction(fixture, "finalizer", "finalizeWorkTimeout")
  assertProjectedState(fixture.session, "refunded.workTimeout")
  await withdrawCredit(fixture, "client")
  await assertTerminalNoMachineActions(fixture, agreementId)
}

async function reviewTimeoutScenario(fixture: Fixture): Promise<void> {
  const agreementId = await createAgreement(fixture, "local-review-timeout", "client")
  await executeAction(fixture, "contractor", "acceptAgreement")
  await submitAgreement(fixture)
  await advanceToCurrentDeadline(fixture)
  await executeAction(fixture, "finalizer", "finalizeReviewTimeout")
  assertProjectedState(fixture.session, "released.reviewTimeout")
  await withdrawCredit(fixture, "contractor")
  await assertTerminalNoMachineActions(fixture, agreementId)
}

async function resolveForClientScenario(fixture: Fixture): Promise<void> {
  const agreementId = await createAgreement(fixture, "local-resolve-client", "client")
  await enterDispute(fixture)
  await executeAction(fixture, "arbitrator", "resolveForClient")
  assertProjectedState(fixture.session, "refunded.arbitratorToClient")
  await withdrawCredit(fixture, "client")
  await assertTerminalNoMachineActions(fixture, agreementId)
}

async function resolveForContractorScenario(fixture: Fixture): Promise<void> {
  const agreementId = await createAgreement(fixture, "local-resolve-contractor", "client")
  await enterDispute(fixture)
  await executeAction(fixture, "arbitrator", "resolveForContractor")
  assertProjectedState(fixture.session, "released.arbitratorToContractor")
  await withdrawCredit(fixture, "contractor")
  await assertTerminalNoMachineActions(fixture, agreementId)
}

async function arbitrationTimeoutScenario(fixture: Fixture, beneficiary: "client" | "contractor"): Promise<void> {
  const agreementId = await createAgreement(
    fixture,
    `local-arbitration-timeout-${beneficiary}`,
    beneficiary,
  )
  await enterDispute(fixture)
  await advanceToCurrentDeadline(fixture)
  await executeAction(fixture, "finalizer", "finalizeArbitrationTimeout")
  assertProjectedState(
    fixture.session,
    beneficiary === "client"
      ? "refunded.arbitrationTimeout"
      : "released.arbitrationTimeout",
  )
  await withdrawCredit(fixture, beneficiary)
  await assertTerminalNoMachineActions(fixture, agreementId)
}

async function createAgreement(
  fixture: Fixture,
  agreementRef: string,
  timeoutBeneficiary: "client" | "contractor",
): Promise<string> {
  await setRole(fixture, "client")
  await fixture.session.navigate("createAgreementForm", inertRecord({}))
  fixture.session.updateState(inertRecord({
    agreementRef,
    contractor: fixture.accounts.contractor.address,
    arbitrator: fixture.accounts.arbitrator.address,
    arbitrationTimeoutBeneficiary: timeoutBeneficiary === "client" ? "1" : "2",
    amount: AGREEMENT_AMOUNT,
    acceptanceDuration: PHASE_DURATION,
    workDuration: PHASE_DURATION,
    reviewDuration: PHASE_DURATION,
    arbitrationDuration: PHASE_DURATION,
    termsUri: `fixture://escrow/${agreementRef}/terms`,
    termsDigest: TERMS_DIGEST,
  }))

  const call = await preparedAction(fixture.session, "createAgreement")
  assert.equal(call.value, AGREEMENT_AMOUNT)
  const params = requiredRecord(requiredRecord(call.args, "create call args").params, "create params")
  assert.equal(params.amount, AGREEMENT_AMOUNT)
  assert.equal(params.agreementRef, agreementRef)

  await submitPreparedCall(fixture, "client", call)
  const snapshot = loadedSnapshot(fixture.session)
  assert.equal(snapshot.route, "lookupAgreement")
  assertProjectedState(fixture.session, "funded")
  const agreementId = requiredString(
    requiredRecord(projectedView(snapshot).machine, "projected machine").instanceId,
    "agreement ID",
  )
  assert.match(agreementId, /^0x[0-9a-fA-F]{64}$/)
  return agreementId
}

async function assertAcceptanceNeedsNoArbitratorAcknowledgement(fixture: Fixture): Promise<void> {
  await setRole(fixture, "contractor")
  const view = projectedView(loadedSnapshot(fixture.session))
  assert.equal(view.arbitratorAcknowledgementRequired, false)
  assert.equal(
    view.arbitratorAcknowledgementDisclosure,
    "not required and not recorded on-chain",
  )
  assert.equal(view.arbitrationTimeoutBeneficiaryId, "client")
  assertRenderedAction(fixture.session, "acceptAgreement")
}

async function submitAgreement(fixture: Fixture): Promise<void> {
  await executeAction(fixture, "contractor", "submitAgreement", {
    submissionUri: "fixture://escrow/submission",
    submissionDigest: SUBMISSION_DIGEST,
  })
  assertProjectedState(fixture.session, "submitted")
}

async function enterDispute(fixture: Fixture): Promise<void> {
  await executeAction(fixture, "contractor", "acceptAgreement")
  await submitAgreement(fixture)
  await executeAction(fixture, "client", "disputeAgreement", {
    disputeUri: "fixture://escrow/dispute",
    disputeDigest: DISPUTE_DIGEST,
  })
  assertProjectedState(fixture.session, "disputed")
}

async function executeAction(
  fixture: Fixture,
  role: Role,
  route: string,
  statePatch?: Record<string, InertValue>,
): Promise<CamViewerLoadedSnapshot> {
  await setRole(fixture, role)
  if (statePatch !== undefined) {
    fixture.session.updateState(inertRecord(statePatch))
  }
  const call = await preparedAction(fixture.session, route)
  return await submitPreparedCall(fixture, role, call)
}

async function preparedAction(session: CamViewerSession, route: string): Promise<CamViewerPreparedContractCall> {
  const button = assertRenderedAction(session, route)
  const result = await session.dispatchAction(button)
  if (result.type !== "contractCall") {
    throw new Error(`expected rendered action to prepare a contract call: ${route}`)
  }
  assert.equal(result.call.route, route)
  return result.call
}

async function submitPreparedCall(
  fixture: Fixture,
  role: Role,
  call: CamViewerPreparedContractCall,
): Promise<CamViewerLoadedSnapshot> {
  const account = fixture.accounts[role]
  await simulateCamContractCall({
    publicClient: fixture.fullPublicClient,
    account: account.address,
    call,
  })

  const walletClient = createWalletClient({
    account,
    chain: fixture.chain,
    transport: http(fixture.rpcURL),
  })
  const hash = await sendCamContractCall({
    walletClient,
    chain: fixture.chain,
    call,
  })
  const receipt = await fixture.fullPublicClient.waitForTransactionReceipt({
    hash,
    timeout: RECEIPT_TIMEOUT_MS,
  })
  assert.equal(receipt.status, "success", `${call.route} transaction failed`)
  assert.equal(call.then.namespace, "routes")

  const snapshot = await fixture.session.navigate(call.then.function, call.then.args)
  process.stdout.write(`${JSON.stringify({
    event: "write_ok",
    role,
    route: call.route,
    hash,
    nextRoute: snapshot.route,
  })}\n`)
  return snapshot
}

async function withdrawCredit(fixture: Fixture, beneficiary: "client" | "contractor"): Promise<void> {
  const account = fixture.accounts[beneficiary].address
  await setRole(fixture, beneficiary)
  await fixture.session.navigate("accountCredit", inertRecord({ account }))
  const available = projectedView(loadedSnapshot(fixture.session))
  assert.equal(available.viewId, "escrow.credit.available")
  assert.equal(requiredUint(available.amount, "withdrawable amount"), BigInt(AGREEMENT_AMOUNT))

  await executeAction(fixture, beneficiary, "withdrawTo", {
    recipient: account,
  })
  const empty = projectedView(loadedSnapshot(fixture.session))
  assert.equal(empty.viewId, "escrow.credit.empty")
  assert.equal(requiredUint(empty.amount, "withdrawable amount after withdrawal"), 0n)
}

async function assertTerminalNoMachineActions(fixture: Fixture, agreementId: string): Promise<void> {
  await fixture.session.navigate("agreement", inertRecord({ agreementId }))
  const view = projectedView(loadedSnapshot(fixture.session))
  assert.equal(view.viewId, "escrow.agreement.terminal")
  const machine = requiredRecord(view.machine, "terminal machine")
  assert.deepEqual(machine.transitionIds, [])
}

async function advanceToCurrentDeadline(fixture: Fixture): Promise<void> {
  const deadline = requiredUint(
    requiredRecord(projectedView(loadedSnapshot(fixture.session)).agreement, "projected agreement").deadline,
    "agreement deadline",
  )
  const block = await fixture.fullPublicClient.getBlock()
  if (block.timestamp < deadline) {
    const delta = deadline - block.timestamp
    assert.ok(delta <= BigInt(Number.MAX_SAFE_INTEGER), "deadline delta exceeds local RPC integer range")
    await rawRpc(fixture.rpcURL, "evm_increaseTime", [Number(delta)])
  }
  await rawRpc(fixture.rpcURL, "evm_mine", [])
}

async function setRole(fixture: Fixture, role: Role): Promise<void> {
  await fixture.session.setAccount({
    address: fixture.accounts[role].address,
  })
}

function assertProjectedState(session: CamViewerSession, expected: string): void {
  const machine = requiredRecord(projectedView(loadedSnapshot(session)).machine, "projected machine")
  assert.equal(machine.stateId, expected)
}

function assertRenderedAction(session: CamViewerSession, route: string) {
  const snapshot = loadedSnapshot(session)
  const matches = resolvedUiButtons(snapshot.resolvedUi)
    .filter((button) => button.call.function === route)
  assert.equal(matches.length, 1, `expected exactly one rendered action: ${route}`)
  return matches[0]
}

function projectedView(snapshot: CamViewerLoadedSnapshot): Record<string, unknown> {
  const view = snapshot.values[0]
  return requiredRecord(view, "projected view")
}

function loadedSnapshot(session: CamViewerSession): CamViewerLoadedSnapshot {
  const snapshot = session.snapshot()
  if (
    snapshot.route === undefined
    || snapshot.state === undefined
    || snapshot.uiURI === undefined
    || snapshot.resolvedUi === undefined
    || snapshot.values === undefined
  ) {
    throw new Error("escrow local scenario viewer session is not loaded")
  }
  return snapshot as CamViewerLoadedSnapshot
}

function deploymentFromBroadcast(path: string): Deployment {
  const root = requiredRecord(
    parseJsonBytes(new Uint8Array(readFileSync(path))),
    "Forge broadcast",
  )
  const transactions = root.transactions
  if (!Array.isArray(transactions)) {
    throw new Error("Forge broadcast must contain a transactions array")
  }

  return {
    camRoot: createdContract(transactions, "CamRoot"),
    escrow: createdContract(transactions, "CamEscrow"),
  }
}

function createdContract(transactions: readonly unknown[], contractName: string): Address {
  const matches = transactions.filter((item) => (
    isRecordObject(item)
    && item.transactionType === "CREATE"
    && item.contractName === contractName
    && typeof item.contractAddress === "string"
  ))
  if (matches.length !== 1) {
    throw new Error(`Forge broadcast must create ${contractName} exactly once`)
  }
  const address = requiredString(matches[0]?.contractAddress, `${contractName} address`)
  return requireEvmAddress(address, `${contractName} address`)
}

async function rawRpc(rpcURL: string, method: string, params: readonly unknown[]): Promise<unknown> {
  const response = await fetch(rpcURL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  })
  if (!response.ok) {
    throw new Error(`local RPC ${method} failed with HTTP ${response.status}`)
  }
  const payload: unknown = await response.json()
  const record = requiredRecord(payload, `local RPC ${method} response`)
  if (record.error !== undefined) {
    throw new Error(`local RPC ${method} failed: ${JSON.stringify(record.error)}`)
  }
  return record.result
}

function inertRecord(value: Record<string, unknown>): InertRecord {
  const inert = toInertValue(value)
  if (!isRecordObject(inert)) {
    throw new Error("expected inert record")
  }
  return inert as InertRecord
}

function requiredRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecordObject(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`)
  }
  return value
}

function requiredUint(value: unknown, label: string): bigint {
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value)
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value)
  }
  throw new Error(`${label} must be an unsigned integer`)
}

function requiredEnv(name: string): string {
  const value = process.env[name]
  if (value === undefined || value.length === 0) {
    throw new Error(`missing required environment variable: ${name}`)
  }
  return value
}

function requiredPrivateKey(name: string): Hex {
  const value = requiredEnv(name)
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be a 32-byte hex private key`)
  }
  return value as Hex
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
