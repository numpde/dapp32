import { readFileSync } from "node:fs"

type JsonObject = Record<string, unknown>
type BikeInvocationFixture = {
  readonly namespace: string
  readonly function: string
  readonly args: Record<string, unknown>
}
type BikeRouteFixture = {
  readonly inputs: readonly string[]
  readonly call: BikeInvocationFixture
  readonly then: BikeInvocationFixture
}
type BikeCamFixture = JsonObject & {
  readonly routes: Record<string, BikeRouteFixture> & {
    readonly entry: BikeRouteFixture
  }
}

export const bikeCamJson = readBikeCamJson("main.json") as BikeCamFixture
export const bikeUiAbi = readBikeCamJson("abi/BicycleComponentManagerUI.json") as readonly JsonObject[]
export const bikeManagerAbi = readBikeCamJson("abi/BicycleComponentManager.json") as readonly JsonObject[]
export const bikeUiJson = readBikeCamJson("ui.json") as JsonObject

function readBikeCamJson(relativePath: string): unknown {
  // Package tests exercise the checked-in CAM resources, not hand-copied
  // approximations. That keeps protocol tests aligned with the dapp manifest.
  const url = new URL(`../../../dapps/bike-nft/cam/${relativePath}`, import.meta.url)
  return JSON.parse(readFileSync(url, "utf8"))
}
