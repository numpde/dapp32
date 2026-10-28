import { resolveArgs } from "@cam/core"
import type { CamDocument, CamInvocation, CamWriteRoute } from "@cam/core"
import { interpretCamReceipt, receiptEventAbi, reviewCamContractCall } from "@cam/evm-viem"
import type { ResolvedCamContract } from "@cam/evm-viem"
import { forEachResolvedUiNode, resolveUiNode } from "@cam/screen"
import type { ResolvedUiNode, UiDocument } from "@cam/screen"
import type { CamRuntimeContext, InertValue } from "@cam/protocol"
import { assertActionIsRendered, renderedActionKind } from "./interactions.ts"
import type { CamViewerPreparedContractCall } from "./types.ts"

export function transactionPresentations({ call, declaration, cam, ui, context, contracts }: {
  readonly call: CamViewerPreparedContractCall
  readonly declaration: CamWriteRoute
  readonly cam: CamDocument
  readonly ui: UiDocument | undefined
  readonly context: CamRuntimeContext
  readonly contracts: Record<string, ResolvedCamContract>
}): Pick<CamViewerPreparedContractCall, "review" | "receipt"> {
  const { review, receipt } = declaration
  if (review === undefined && receipt === undefined) return {}
  if (ui === undefined) throw new Error("Transaction presentation requires the loaded UI resource.")

  function render(invocation: CamInvocation, outputs: readonly InertValue[], navigation: boolean): ResolvedUiNode {
    const phase = { ...context, outputs }
    const node = resolveUiNode(ui!, invocation.function, resolveArgs(invocation.args, phase), { ...phase, state: {} })
    forEachResolvedUiNode(node, child => {
      if (["Screen", "Fragment", "Text", "Address", "Status"].includes(child.element)) return
      if (navigation && child.element === "Button" && renderedActionKind(cam, child) === "navigate") return
      throw new Error(`Transaction presentation cannot contain ${child.element}; only facts and result navigation are supported.`)
    })
    return node
  }

  if (receipt !== undefined) receiptEventAbi(call, receipt.event)
  return {
    ...(review === undefined ? {} : { review: async (publicClient, account) => {
      const read = { ...review.call, args: resolveArgs(review.call.args, context) }
      const result = await reviewCamContractCall({ publicClient, account, call, read, context, contracts })
      return { blockNumber: result.blockNumber, ui: render(review.then, result.values, false) }
    } } satisfies Pick<CamViewerPreparedContractCall, "review">),
    ...(receipt === undefined ? {} : { receipt: (mined, transaction, account) => {
      const args = interpretCamReceipt({ call, event: receipt.event, receipt: mined, transaction, account })
      if (args !== undefined) return render(receipt.then, [args], true)
      if (receipt.empty === undefined) throw new Error(`The confirmed transaction did not emit ${receipt.event}; its result is unavailable.`)
      return render(receipt.empty, [], true)
    } } satisfies Pick<CamViewerPreparedContractCall, "receipt">),
  }
}

export function transactionPresentationNavigation(ui: ResolvedUiNode, action: import("@cam/screen").ResolvedButtonNode): { readonly route: string; readonly inputs: import("@cam/protocol").InertRecord } {
  const selected = assertActionIsRendered(ui, action)
  // Receipt resolution admits only read-route buttons. Membership prevents
  // a stale or fabricated action from borrowing that admission.
  return { route: selected.call.function, inputs: selected.call.args }
}
