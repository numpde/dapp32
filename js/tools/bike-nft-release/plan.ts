import { assertPublishedCamRootURI } from "../../packages/cam-protocol/dist/index.js"
import { inspectReleaseBundle } from "./bundle.ts"
import { RELEASE_PLAN_SCHEMA, requiredAddresses, requiredDelay } from "./shared.ts"
import type { ReleasePlan } from "./shared.ts"
import { writeNewJson } from "../release-files.ts"
import { requiredEnv, requiredNonzeroAddress, requiredReleaseChainId, requiredSingleLineString, requiredSourceCommit, runReleaseTool } from "../release-values.ts"

async function main(): Promise<void> {
  const env = process.env
  const camURI = requiredEnv(env, "BIKE_NFT_RELEASE_CAM_URI")
  assertPublishedCamRootURI(camURI, "BIKE_NFT_RELEASE_CAM_URI")
  const planPath = requiredEnv(env, "BIKE_NFT_RELEASE_PLAN_PATH")
  const bundle = await inspectReleaseBundle({
    dappsRootPath: requiredEnv(env, "BIKE_NFT_RELEASE_DAPPS_ROOT"), rootPath: requiredEnv(env, "BIKE_NFT_RELEASE_CAM_ROOT_PATH"),
    camURI,
  })
  const plan: ReleasePlan = {
    schema: RELEASE_PLAN_SCHEMA,
    sourceCommit: requiredSourceCommit(requiredEnv(env, "BIKE_NFT_RELEASE_SOURCE_COMMIT")), expectedChainId: requiredReleaseChainId(requiredEnv(env, "BIKE_NFT_RELEASE_EXPECTED_CHAIN_ID")), camURI,
    camHash: bundle.camHash,
    intendedCamRootOwner: requiredNonzeroAddress(requiredEnv(env, "BIKE_NFT_RELEASE_INTENDED_CAM_ROOT_OWNER"), "intended CAM root owner"),
    tokenName: requiredSingleLineString(requiredEnv(env, "BIKE_NFT_RELEASE_TOKEN_NAME"), "tokenName"),
    tokenSymbol: requiredSingleLineString(requiredEnv(env, "BIKE_NFT_RELEASE_TOKEN_SYMBOL"), "tokenSymbol"),
    baseTokenURI: requiredSingleLineString(requiredEnv(env, "BIKE_NFT_RELEASE_BASE_TOKEN_URI"), "baseTokenURI"),
    collectionURI: requiredSingleLineString(requiredEnv(env, "BIKE_NFT_RELEASE_COLLECTION_URI"), "collectionURI"),
    intendedComponentsAdmin: requiredNonzeroAddress(requiredEnv(env, "BIKE_NFT_RELEASE_INTENDED_COMPONENTS_ADMIN"), "intended components admin"), componentsAdminDelay: requiredDelay(requiredEnv(env, "BIKE_NFT_RELEASE_COMPONENTS_ADMIN_DELAY"), "components admin delay"),
    componentsPauser: requiredNonzeroAddress(requiredEnv(env, "BIKE_NFT_RELEASE_COMPONENTS_PAUSER"), "components pauser"), componentsConfigurer: requiredNonzeroAddress(requiredEnv(env, "BIKE_NFT_RELEASE_COMPONENTS_CONFIGURER"), "components configurer"),
    intendedManagerAdmin: requiredNonzeroAddress(requiredEnv(env, "BIKE_NFT_RELEASE_INTENDED_MANAGER_ADMIN"), "intended manager admin"), managerAdminDelay: requiredDelay(requiredEnv(env, "BIKE_NFT_RELEASE_MANAGER_ADMIN_DELAY"), "manager admin delay"),
    managerPauser: requiredNonzeroAddress(requiredEnv(env, "BIKE_NFT_RELEASE_MANAGER_PAUSER"), "manager pauser"), managerConfigurer: requiredNonzeroAddress(requiredEnv(env, "BIKE_NFT_RELEASE_MANAGER_CONFIGURER"), "manager configurer"),
    registrars: requiredAddresses(requiredEnv(env, "BIKE_NFT_RELEASE_REGISTRARS"), "registrars"),
  }
  await writeNewJson(planPath, plan, "release plan")
  process.stdout.write(`${JSON.stringify({ event: "bike_nft_release_plan", planPath, camHash: plan.camHash })}\n`)
}
runReleaseTool(main)
