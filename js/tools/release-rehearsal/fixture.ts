import { privateKeyToAccount } from "viem/accounts"

export const chainId = 31338
export const rpcURL = "http://release-anvil:8545"
export const camOrigin = "http://release-cam:8080"
// Public, repeated-pattern keys belong only to the isolated rehearsal chain.
export const deployerKey = `0x${"ba".repeat(32)}` as const
export const owners = {
  root: privateKeyToAccount(`0x${"ca".repeat(32)}`),
  payment: privateKeyToAccount(`0x${"da".repeat(32)}`),
  manager: privateKeyToAccount(`0x${"fa".repeat(32)}`),
}

export type RehearsalApp = "bike-nft" | "escrow" | "pay-to-play"

export function rehearsalApp(value: string): RehearsalApp {
  if (value === "bike-nft" || value === "escrow" || value === "pay-to-play") return value
  throw new Error(`No release rehearsal is defined for ${value}`)
}

export function releaseInputs(app: RehearsalApp, directory: string): Record<string, string> {
  const prefix = app.toUpperCase().replaceAll("-", "_")
  const settings: Record<string, string> = {
    RPC_URL_FILE: `${directory}/control/rpc-url`,
    DEPLOYER_PRIVATE_KEY_FILE: `${directory}/control/deployer-key`,
    [`${prefix}_RELEASE_EXPECTED_DEPLOYER_ADDRESS`]: privateKeyToAccount(deployerKey).address,
    [`CONFIRM_${prefix}_RELEASE_DEPLOY`]: "YES",
    [`${prefix}_RELEASE_EXPECTED_CHAIN_ID`]: String(chainId),
    [`${prefix}_RELEASE_CAM_URI`]: `${camOrigin}/${app}/main.json`,
    [`${prefix}_RELEASE_INTENDED_CAM_ROOT_OWNER`]: owners.root.address,
    [`${prefix}_RELEASE_OUTPUT_DIR`]: `${directory}/deployment`,
    [`${prefix}_DEPLOYMENT_ARTIFACT_FILE`]: `${directory}/deployment/artifact/deployment.json`,
  }
  if (app === "pay-to-play") {
    settings.PAY_TO_PLAY_RELEASE_INTENDED_PAYMENT_ADMIN = owners.payment.address
    settings.PAY_TO_PLAY_RELEASE_NULL_CLAIM_PERIOD = "60"
  }
  if (app === "bike-nft") {
    Object.assign(settings, {
      BIKE_NFT_RELEASE_TOKEN_NAME: "Rehearsal components", BIKE_NFT_RELEASE_TOKEN_SYMBOL: "TEST",
      BIKE_NFT_RELEASE_BASE_TOKEN_URI: "",
      BIKE_NFT_RELEASE_COLLECTION_URI: "data:application/json,%7B%22name%22%3A%22Rehearsal%20components%22%7D",
      BIKE_NFT_RELEASE_INTENDED_COMPONENTS_ADMIN: owners.payment.address,
      BIKE_NFT_RELEASE_COMPONENTS_ADMIN_DELAY: "3600",
      BIKE_NFT_RELEASE_COMPONENTS_PAUSER: owners.root.address,
      BIKE_NFT_RELEASE_COMPONENTS_CONFIGURER: owners.root.address,
      BIKE_NFT_RELEASE_INTENDED_MANAGER_ADMIN: owners.manager.address,
      BIKE_NFT_RELEASE_MANAGER_ADMIN_DELAY: "3600",
      BIKE_NFT_RELEASE_MANAGER_PAUSER: owners.root.address,
      BIKE_NFT_RELEASE_MANAGER_CONFIGURER: owners.root.address,
      BIKE_NFT_RELEASE_REGISTRARS: owners.root.address,
    })
  }
  return settings
}

export function shellAssignments(inputs: Readonly<Record<string, string>>): string {
  return Object.entries(inputs).map(([name, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Invalid fixture variable: ${name}`)
    return `${name}='${value.replaceAll("'", "'\\''")}'`
  }).join("\n") + "\n"
}
