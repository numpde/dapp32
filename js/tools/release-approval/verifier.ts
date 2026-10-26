import {
  encodeAbiParameters, getAddress, getContractAddress, keccak256, parseAbiParameters,
  parseTransaction, recoverTransactionAddress, serializeTransaction, toFunctionSelector,
  type AbiFunction, type Address, type Hex,
} from "viem"

import type { ReferenceSnapshot } from "./reference-snapshot.ts"
import type { ExpectedArgument, ExpectedStep } from "./reference.ts"

export type CreationReceipt = {
  transactionHash: Hex
  status: Hex
  contractAddress: Address | null
}

export type TransactionReview = {
  stepIndex: number
  step: ExpectedStep
  signed: {
    hash: Hex
    sender: Address
    chainId: number
    nonce: number
    to: Address | null
    valueWei: string
    gasLimit: string
    maxFeePerGasWei: string
    maxPriorityFeePerGasWei: string
    accessList: unknown
    calldata: Hex
    calldataHash: Hex
  }
  comparison: {
    targetRole: string | null
    targetAddress: Address | null
    creationBytecodeMatched: boolean | null
    predictedAddress: Address | null
    expectedArgs: readonly (string | Address)[]
    expectedCalldata: Hex
    artifactSha256: Hex
    compilerMetadataSha256: Hex
  }
}

type AcceptedCreation = { hash: Hex; predictedAddress: Address }
type Candidate = { raw: Hex; review: TransactionReview }

function argumentsFor(types: readonly string[], args: readonly (string | Address)[]): Hex {
  if (types.length !== args.length) throw new Error("Reference argument count differs from ABI")
  if (types.length === 0) return "0x"
  const values = args.map((arg, index) => /^u?int(?:[0-9]+)?$/.test(types[index]!) ? BigInt(arg) : arg)
  return encodeAbiParameters(parseAbiParameters(types.join(",")), values)
}

function isRoleReference(value: ExpectedArgument): value is { readonly createdContract: string } {
  return typeof value === "object" && value !== null && "createdContract" in value
}

export class ReleaseVerifier {
  private readonly snapshot: ReferenceSnapshot
  private readonly receipt: (hash: Hex) => Promise<CreationReceipt | null>
  private readonly creations = new Map<string, AcceptedCreation>()
  private index = 0
  private candidate: Candidate | null = null
  private inspecting: { raw: Hex; result: Promise<TransactionReview> } | null = null

  constructor(snapshot: ReferenceSnapshot, receipt: (hash: Hex) => Promise<CreationReceipt | null>) {
    if (snapshot.steps.length === 0 || snapshot.contracts.length === 0) throw new Error("Release reference has no steps or contracts")
    this.snapshot = snapshot
    this.receipt = receipt
  }

  stepIndex(): number { return this.index }

  async inspect(raw: Hex): Promise<TransactionReview> {
    if (this.index >= this.snapshot.steps.length) throw new Error("Release reference has no remaining transactions")
    const hash = keccak256(raw)
    if (this.candidate !== null) {
      if (this.candidate.review.signed.hash !== hash || this.candidate.raw !== raw) throw new Error("Another candidate occupies the current release step")
      return this.candidate.review
    }
    if (this.inspecting !== null) {
      if (this.inspecting.raw !== raw) throw new Error("Another candidate is being inspected")
      return this.inspecting.result
    }
    const result = this.compare(raw, hash).then((review) => {
      this.candidate = { raw, review }
      return review
    }).finally(() => { this.inspecting = null })
    this.inspecting = { raw, result }
    return result
  }

  accepted(hash: Hex): void {
    const candidate = this.candidate
    if (candidate === null || candidate.review.signed.hash.toLowerCase() !== hash.toLowerCase()) {
      throw new Error("Accepted hash does not match the inspected release candidate")
    }
    if (candidate.review.step.kind === "create") {
      const address = candidate.review.comparison.predictedAddress
      if (address === null) throw new Error("Creation candidate lacks predicted address")
      this.creations.set(candidate.review.step.role, { hash, predictedAddress: address })
    }
    this.index += 1
    this.candidate = null
  }

  notAccepted(hash: Hex): void {
    if (this.candidate !== null && this.candidate.review.signed.hash.toLowerCase() === hash.toLowerCase()) this.candidate = null
  }

  private async observedAddress(role: string): Promise<Address> {
    if (this.snapshot.schema === "release-approval.cam-reference.v1" && this.snapshot.root.kind === "existing" && role === "camRoot") {
      return getAddress(this.snapshot.root.contract.address)
    }
    const creation = this.creations.get(role)
    if (creation === undefined) throw new Error(`Reference role ${role} has no accepted creation`)
    const receipt = await this.receipt(creation.hash)
    if (receipt === null) throw new Error(`Successful creation receipt for ${role} is not available`)
    if (receipt.transactionHash.toLowerCase() !== creation.hash.toLowerCase() ||
        receipt.status !== "0x1" || receipt.contractAddress === null ||
        getAddress(receipt.contractAddress) !== getAddress(creation.predictedAddress)) {
      throw new Error(`Creation receipt for ${role} does not match a successful deployment`)
    }
    return getAddress(receipt.contractAddress)
  }

  private async expectedArgs(step: ExpectedStep): Promise<(string | Address)[]> {
    const args: (string | Address)[] = []
    for (const arg of step.args) args.push(isRoleReference(arg) ? await this.observedAddress(arg.createdContract) : arg)
    return args
  }

  private async compare(raw: Hex, hash: Hex): Promise<TransactionReview> {
    if (!/^0x02(?:[0-9a-fA-F]{2})+$/.test(raw) || raw.length > 262_146) throw new Error("Expected bounded signed type-2 transaction bytes")
    const parsed = parseTransaction(raw)
    if (parsed.type !== "eip1559" || parsed.r === undefined || parsed.s === undefined || parsed.yParity === undefined ||
        serializeTransaction(parsed).toLowerCase() !== raw.toLowerCase()) throw new Error("Expected canonical signed type-2 transaction")
    const sender = await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` })
    if (parsed.chainId !== this.snapshot.expectedChainId || getAddress(sender) !== getAddress(this.snapshot.expectedDeployer)) {
      throw new Error("Signed chain or sender differs from selected release reference")
    }
    const value = parsed.value === undefined ? 0n : parsed.value
    if (value !== 0n) throw new Error("Release transaction must send zero native value")
    if (parsed.nonce === undefined || parsed.gas === undefined || parsed.maxFeePerGas === undefined || parsed.maxPriorityFeePerGas === undefined) {
      throw new Error("Signed transaction lacks nonce, gas limit or fee fields")
    }
    const step = this.snapshot.steps[this.index]!
    const contract = this.snapshot.contracts.find((item) => item.role === step.role)
    if (contract === undefined) throw new Error(`Reference has no compiler contract for ${step.role}`)
    const expectedArgs = await this.expectedArgs(step)
    let expectedCalldata: Hex
    let targetAddress: Address | null = null
    let predictedAddress: Address | null = null
    let creationBytecodeMatched: boolean | null = null
    const actualCalldata = parsed.data === undefined ? "0x" : parsed.data

    if (step.kind === "create") {
      if (parsed.to !== undefined) throw new Error(`Release step ${this.index + 1} expects direct contract creation`)
      if (step.constructorTypes === undefined) throw new Error("Reference creation lacks constructor types")
      creationBytecodeMatched = actualCalldata.toLowerCase().startsWith(contract.creationBytecode.toLowerCase())
      if (!creationBytecodeMatched) throw new Error(`Creation bytecode differs from compiler reference for ${step.role}`)
      expectedCalldata = `${contract.creationBytecode}${argumentsFor(step.constructorTypes, expectedArgs).slice(2)}` as Hex
      predictedAddress = getContractAddress({ from: sender, nonce: BigInt(parsed.nonce) })
    } else {
      if (step.signature === undefined || parsed.to == null) throw new Error("Reference call or signed target is incomplete")
      targetAddress = await this.observedAddress(step.role)
      if (getAddress(parsed.to) !== targetAddress) throw new Error(`Call target differs from observed ${step.role} address`)
      const functionAbi = contract.abi.find((item): item is AbiFunction => item.type === "function" &&
        `${item.name}(${item.inputs.map((input) => input.type).join(",")})` === step.signature)
      if (functionAbi === undefined) throw new Error(`Compiler ABI lacks ${step.signature}`)
      expectedCalldata = `${toFunctionSelector(step.signature)}${argumentsFor(functionAbi.inputs.map((input) => input.type), expectedArgs).slice(2)}` as Hex
    }
    if (actualCalldata.toLowerCase() !== expectedCalldata.toLowerCase()) {
      throw new Error(`Calldata or constructor arguments differ from reference for step ${this.index + 1} ${step.name}`)
    }
    return {
      stepIndex: this.index, step,
      signed: {
        hash, sender, chainId: parsed.chainId, nonce: parsed.nonce, to: parsed.to == null ? null : parsed.to,
        valueWei: value.toString(), gasLimit: parsed.gas.toString(),
        maxFeePerGasWei: parsed.maxFeePerGas.toString(), maxPriorityFeePerGasWei: parsed.maxPriorityFeePerGas.toString(),
        accessList: parsed.accessList, calldata: actualCalldata, calldataHash: keccak256(actualCalldata),
      },
      comparison: {
        targetRole: step.kind === "call" ? step.role : null,
        targetAddress, creationBytecodeMatched, predictedAddress, expectedArgs, expectedCalldata,
        artifactSha256: contract.artifactSha256, compilerMetadataSha256: contract.compilerMetadataSha256,
      },
    }
  }
}
