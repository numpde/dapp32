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

export function fixtureEnvironment(directory: string): Record<string, string> {
  return {
    RPC_URL_FILE: `${directory}/control/rpc-url`,
    DEPLOYER_PRIVATE_KEY_FILE: `${directory}/control/deployer-key`,
    REHEARSAL_CHAIN_ID: String(chainId),
  }
}

/** The initial ordinary full release has no URI until its exact bundle is hosted. */
export function rehearsalConfiguration(app: RehearsalApp, directory: string, sourceCommit: string, approvalImageId: string, localNetwork: string) {
  const settings: Record<string, string> = {
    EXPECTED_DEPLOYER_ADDRESS: privateKeyToAccount(deployerKey).address,
    EXPECTED_CHAIN_ID: String(chainId),
    INTENDED_CAM_ROOT_OWNER: owners.root.address,
    OUTPUT_DIR: `${directory}/deployment`,
    CAM_HASH: "auto",
  }
  if (app === "pay-to-play") {
    settings.INTENDED_PAYMENT_ADMIN = owners.payment.address
    settings.NULL_CLAIM_PERIOD = "60"
  }
  if (app === "bike-nft") {
    Object.assign(settings, {
      TOKEN_NAME: "Rehearsal components", TOKEN_SYMBOL: "TEST",
      BASE_TOKEN_URI: "",
      COLLECTION_URI: "data:application/json,%7B%22name%22%3A%22Rehearsal%20components%22%7D",
      INTENDED_COMPONENTS_ADMIN: owners.payment.address,
      COMPONENTS_ADMIN_DELAY: "3600",
      COMPONENTS_PAUSER: owners.root.address,
      COMPONENTS_CONFIGURER: owners.root.address,
      INTENDED_MANAGER_ADMIN: owners.manager.address,
      MANAGER_ADMIN_DELAY: "3600",
      MANAGER_PAUSER: owners.root.address,
      MANAGER_CONFIGURER: owners.root.address,
      REGISTRARS: owners.root.address,
    })
  }
  return { schemaVersion: 3, app, sourceCommit, approvalImageId, localNetwork,
    rpcUrl: rpcURL, deployerPrivateKey: deployerKey, confirmDeploy: true, settings }
}

export function shellAssignments(inputs: Readonly<Record<string, string>>): string {
  return Object.entries(inputs).map(([name, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error(`Invalid fixture variable: ${name}`)
    return `${name}='${value.replaceAll("'", "'\\''")}'`
  }).join("\n") + "\n"
}
