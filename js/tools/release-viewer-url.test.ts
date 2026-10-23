import assert from "node:assert/strict"
import test from "node:test"
import { releaseViewerURL } from "./release-viewer-url.ts"

const address = (n: number) => `0x${n.toString(16).padStart(40, "0")}`
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
const common = {
  sourceCommit: "a".repeat(40), chainId: 31338, deployer: address(1), camRoot: address(2),
  camURI: "https://raw.githubusercontent.com/org/repo/commit/dapps/example/cam/main.json",
  camHash: hash(1), intendedCamRootOwner: address(3), camRootCodeHash: hash(2),
  camRootCreationTransaction: hash(3),
}
const artifacts = {
  "pay-to-play": { ...common, schema: "pay-to-play.deployment.v1", intendedPaymentAdmin: address(4),
    nullClaimPeriod: 0, payToPlay: address(5), payToPlayCodeHash: hash(4),
    payToPlayCreationTransaction: hash(5), payToPlayCreationInputHash: hash(6) },
  escrow: { ...common, schema: "escrow.deployment.v2", ownershipTransferRequired: true,
    ownershipAccepted: false, camEscrow: address(4), camEscrowUI: address(5),
    camEscrowCodeHash: hash(4), camEscrowUICodeHash: hash(5),
    camEscrowCreationTransaction: hash(6), camEscrowUICreationTransaction: hash(7) },
  "bike-nft": { ...common, schema: "bike-nft.deployment.v2", tokenName: "Bike", tokenSymbol: "BIKE",
    baseTokenURI: "https://example.test/tokens/", collectionURI: "https://example.test/collection.json",
    intendedComponentsAdmin: address(4), componentsAdminDelay: 1, componentsPauser: address(5),
    componentsConfigurer: address(6), intendedManagerAdmin: address(7), managerAdminDelay: 1,
    managerPauser: address(8), managerConfigurer: address(9), registrars: [address(10)],
    components: address(11), manager: address(12), ui: address(13), componentsCodeHash: hash(4),
    managerCodeHash: hash(5), uiCodeHash: hash(6), componentsCreationTransaction: hash(7),
    managerCreationTransaction: hash(8), uiCreationTransaction: hash(9) },
}

for (const [app, artifact] of Object.entries(artifacts)) {
  test(`${app} public release uses the deployed chain and explicit browser RPC`, () => {
    const rpc = "https://api.avax-test.network/ext/bc/C/rpc"
    const url = new URL(releaseViewerURL(app, bytes({ ...artifact, chainId: 43113 }), "http://127.0.0.1:5174", "https://raw.githubusercontent.com", rpc))
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      chainId: "eip155:43113", host: common.camRoot, account: common.deployer, rpcUrl: rpc,
    })
    assert.throws(() => releaseViewerURL(app, bytes(artifact), url.origin, "https://raw.githubusercontent.com", "https://user:secret@example.test/rpc"), /username|password|credentials/)
    assert.throws(() => releaseViewerURL(app, bytes(artifact), url.origin, "https://other.example", rpc), /resource origin/)
  })
  test(`${app} attachment uses its canonical release artifact and ordinary viewer inputs`, () => {
    const url = new URL(releaseViewerURL(app, bytes(artifact), "http://127.0.0.1:5174", "https://raw.githubusercontent.com", "http://127.0.0.1:5174/rpc"))
    assert.equal(url.origin, "http://127.0.0.1:5174")
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      chainId: "eip155:31338", host: common.camRoot, account: common.deployer,
      rpcUrl: "http://127.0.0.1:5174/rpc",
    })
    assert.throws(() => releaseViewerURL(app, bytes(artifact), url.origin, "https://other.example", "http://127.0.0.1:5174/rpc"), /resource origin/)
    assert.doesNotThrow(() => releaseViewerURL(app, bytes({ ...artifact, camHash: hash(0) }), url.origin, "https://raw.githubusercontent.com", "http://127.0.0.1:5174/rpc"))
  })
}

test("attachment rejects unknown apps before interpreting an artifact", () => {
  assert.throws(() => releaseViewerURL("other", bytes({}), "http://127.0.0.1:5174", "https://raw.githubusercontent.com", "http://127.0.0.1:5174/rpc"), /bike-nft, escrow or pay-to-play/)
})
