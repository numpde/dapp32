import { readFileSync } from "node:fs"
import { createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, parseAbiItem, type Abi } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { isRecordObject, parseJsonBytes, readBoundedResponseBytes, requireHttpURL } from "@cam/protocol"
import { requireEvmAddress } from "@cam/evm-viem"
import { discoverCustomers, runRefundBatch, type Address, type Hex, type Position, type Report, type SendResult } from "./core.ts"
import { parseConfig } from "./config.ts"
import { openJournal, readProtectedFile } from "./journal.ts"

const FUNDED = parseAbiItem("event Funded(address indexed customer,uint256 indexed channelId,uint256 amount)")
const MOVED = parseAbiItem("event Moved(address indexed customer,uint256 indexed sourceId,uint256 indexed targetId,uint256 amount)")
let phase = "configuration"
function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing ${name}`)
  return value
}
function position(value: unknown): Position {
  if (!isRecordObject(value)) throw new Error("Invalid position result")
  const fields = value
  function uint(name: string): bigint {
    const n = fields[name]
    if (typeof n !== "bigint" || n < 0n) throw new Error("Invalid position quantity")
    return n
  }
  const p = Number(value.phase)
  if (![0, 1, 2].includes(p) || typeof value.refundRecipient !== "string") throw new Error("Invalid position phase/recipient")
  return { balance: uint("balance"), scheduledRefundAt: uint("scheduledRefundAt"), requestedAmount: uint("requestedAmount"), refundAt: uint("refundAt"), refundRecipient: requireEvmAddress(value.refundRecipient, "refund recipient"), phase: p }
}

async function main() {
  const config = parseConfig(JSON.parse(readProtectedFile(required("REFUND_CONFIG_FILE"), 16_384)))
  const rpcURL = requireHttpURL(readProtectedFile(required("RPC_URL_FILE"), 8192).trim(), "RPC_URL_FILE").href
  // Intentional policy: absence of an execution grant selects a read-only plan.
  let mode = process.env.REFUND_EXECUTE
  if (mode === undefined) mode = "NO"
  if (mode !== "YES" && mode !== "NO") throw new Error("REFUND_EXECUTE must be YES or NO")
  const execute = mode === "YES"
  const abi = parseJsonBytes(new Uint8Array(readFileSync(new URL("../../../dapps/pay-to-play/cam/abi/PayToPlay.json", import.meta.url)))) as Abi
  const chain = { id: config.chainId, name: "Pinned refund deployment", nativeCurrency: { name: "Native", symbol: "NATIVE", decimals: 18 }, rpcUrls: { default: { http: [rpcURL] } } }
  const transport = http(rpcURL, {
    retryCount: 0, timeout: 10_000,
    // Bound response bodies as well as block ranges; do not follow redirects
    // that could forward an operator's RPC credentials to another origin.
    fetchFn: async (input, init) => {
      const response = await fetch(input, { ...init, redirect: "error" })
      const bytes = await readBoundedResponseBytes(response, "refund RPC", 2_097_152)
      return new Response(new Uint8Array(bytes), { status: response.status, headers: { "content-type": "application/json" } })
    },
  })
  const client = createPublicClient({ chain, transport })
  const identity = { chainId: String(config.chainId), payment: config.payment, codeHash: config.codeHash, channelId: config.channelId.toString() }
  const report: Report = entry => { process.stdout.write(JSON.stringify({ ...identity, ...entry }) + "\n") }
  async function pins() {
    if (await client.getChainId() !== config.chainId) throw new Error("Chain changed")
    const code = await client.getBytecode({ address: config.payment })
    if (!code || code === "0x" || keccak256(code).toLowerCase() !== config.codeHash) throw new Error("Payment code mismatch")
  }
  phase = "deployment pins"
  await pins()
  const horizon = await client.readContract({ address: config.payment, abi, functionName: "RECOVERY_HORIZON" })
  const maximum = await client.readContract({ address: config.payment, abi, functionName: "MAX_CLAIM_PERIOD" })
  if (horizon !== 31536000n || maximum !== 2592000n) throw new Error("Unexpected recovery policy")
  await client.readContract({ address: config.payment, abi, functionName: "channel", args: [config.channelId] })
  const head = await client.getBlockNumber({ cacheTime: 0 })
  if (head < config.toBlock + BigInt(config.confirmations - 1)) throw new Error("Discovery endpoint lacks requested confirmations")
  const anchor = await client.getBlock({ blockNumber: config.toBlock })
  if (!anchor.hash) throw new Error("Missing discovery block hash")
  async function checkAnchor() {
    if ((await client.getBlock({ blockNumber: config.toBlock })).hash !== anchor.hash) throw new Error("Discovery chain reorganized; repeat the scan")
  }
  phase = "event discovery"
  const customers = await discoverCustomers(async (fromBlock, toBlock) => {
    const funded = await client.getLogs({ address: config.payment, event: FUNDED, args: { channelId: config.channelId }, fromBlock, toBlock, strict: true })
    const moved = await client.getLogs({ address: config.payment, event: MOVED, args: { targetId: config.channelId }, fromBlock, toBlock, strict: true })
    if (funded.some(log => log.removed) || moved.some(log => log.removed)) throw new Error("Removed discovery log")
    return [...funded.map(log => log.args.customer), ...moved.map(log => log.args.customer)]
  }, config)
  await checkAnchor()
  report({ event: "discovered", customers: customers.length, fromBlock: config.fromBlock.toString(), toBlock: config.toBlock.toString(), anchor: anchor.hash, execute, maximumGasCostWei: (BigInt(config.maxTransactions) * config.gasLimit * config.maxFeePerGas).toString() })

  // A dry run never opens a signing key or a state directory.
  const journal = execute ? openJournal(required("REFUND_STATE_DIR"), identity) : undefined
  try {
    async function reconcile(hash: Hex): Promise<SendResult> {
      try {
        const receipt = await client.waitForTransactionReceipt({ hash, confirmations: config.confirmations, timeout: 60_000 })
        // Never silently adopt a replacement/cancellation at the same nonce.
        if (receipt.transactionHash.toLowerCase() !== hash.toLowerCase()) return { status: "pending", hash }
        const status = receipt.status === "success" ? "confirmed" : "reverted"
        journal!.recordReceipt(hash, status, receipt.blockNumber, receipt.blockHash)
        report({ event: "receipt", hash, status, blockNumber: receipt.blockNumber.toString(), blockHash: receipt.blockHash })
        return { status, hash }
      } catch { return { status: "pending", hash } }
    }
    const previous = journal?.pending
    if (previous) {
      phase = "pending transaction reconciliation"
      const result = await reconcile(previous.hash)
      if (result.status === "pending") {
        report({ event: "pending", hash: result.hash })
        process.exitCode = 2
        return
      }
    }
    phase = "signing setup"
    const account = execute ? privateKeyToAccount(readProtectedFile(required("REFUND_PRIVATE_KEY_FILE"), 128).trim() as Hex) : undefined
    const wallet = account ? createWalletClient({ account, chain, transport }) : undefined
    const summary = await runRefundBatch(customers, {
      readPosition: async customer => {
        phase = "position read"
        // A plan has no signing wallet; zero represents its read-only actor.
        let actor: Address = "0x0000000000000000000000000000000000000000"
        if (account !== undefined) actor = account.address
        return position(await client.readContract({ address: config.payment, abi, functionName: "viewPosition", args: [customer, config.channelId, actor] }))
      },
      sendRefund: async customer => {
        if (!wallet || !account || !journal) throw new Error("Signing not authorized")
        phase = "pre-sign verification"
        await pins()
        await checkAnchor()
        try {
          await client.simulateContract({ address: config.payment, abi, functionName: "refund", args: [customer, config.channelId], account: account.address, gas: config.gasLimit })
        } catch { return { status: "simulation_failed" } }
        const nonce = await client.getTransactionCount({ address: account.address, blockTag: "latest" })
        if (await client.getTransactionCount({ address: account.address, blockTag: "pending" }) !== nonce) throw new Error("Signing account has an untracked pending transaction")
        const request = await wallet.prepareTransactionRequest({
          account, chain, to: config.payment,
          data: encodeFunctionData({ abi, functionName: "refund", args: [customer, config.channelId] }),
          value: 0n, nonce, gas: config.gasLimit, type: "eip1559",
          maxFeePerGas: config.maxFeePerGas, maxPriorityFeePerGas: config.maxPriorityFeePerGas,
        })
        const serialized = await wallet.signTransaction(request)
        const hash = keccak256(serialized)
        phase = "durable broadcast intent"
        journal.recordPending({ customer, hash, nonce })
        report({ event: "broadcast_intent", customer, hash, nonce })
        phase = "broadcast and receipt"
        try {
          const returned = await client.request({ method: "eth_sendRawTransaction", params: [serialized] })
          if (returned.toLowerCase() !== hash.toLowerCase()) return { status: "pending", hash }
        } catch {
          // A transport error does not prove rejection. Reconcile the known
          // signed hash, never sign another transaction to retry this call.
        }
        return reconcile(hash)
      },
    }, { execute, maxTransactions: config.maxTransactions, report })
    phase = "completion accounting"
    const channel = await client.readContract({ address: config.payment, abi, functionName: "channel", args: [config.channelId] })
    if (!isRecordObject(channel) || typeof channel.escrowTotal !== "bigint") throw new Error("Invalid channel total")
    report({ event: "channel_balance", escrowTotal: channel.escrowTotal.toString() })
    if (summary.pending || summary.failed || summary.deferred) process.exitCode = 2
  } finally { journal?.close() }
}

main().catch(() => {
  // Errors from RPC/signing libraries may contain URLs or signed calldata.
  // Only the owned phase is safe to log; the journal preserves the known hash.
  process.stderr.write(`Refund worker stopped during ${phase}. Check configuration, RPC availability and the transaction journal; no automatic replacement was sent.\n`)
  process.exitCode = 1
})
