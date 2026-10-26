import { bikeCamBindings } from "../bike-nft-release/reference.ts"
import { escrowCamBindings } from "../escrow-release/reference.ts"
import { payToPlayCamBindings } from "../pay-to-play-release/reference.ts"
import { createdContract } from "../release-approval/reference.ts"
import type { ReleaseApp } from "../release-approval/reference-read.ts"

/** App-owned recipes retain their role references until selected components resolve them. */
export function camBindingRecipe(app: ReleaseApp) {
  if (app === "bike-nft") return bikeCamBindings({ camRoot: createdContract("camRoot"),
    manager: createdContract("manager"), ui: createdContract("ui"), components: createdContract("components") })
  if (app === "escrow") return escrowCamBindings({ escrow: createdContract("escrow"), ui: createdContract("ui") })
  return payToPlayCamBindings({ payments: createdContract("payments"), ui: createdContract("ui") })
}
