import assert from "node:assert/strict"
import test from "node:test"
import { prepareReleaseViewer, releaseViewerURL } from "./release-viewer-url.ts"

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

test("viewer setup derives app and HTTPS origin from the artifact and offers only its chain's public RPC", async () => {
  const questions: string[] = []
  const settings = await prepareReleaseViewer({
    bytes: bytes({ ...artifacts["bike-nft"], chainId: 43113 }), viewerOrigin: "http://127.0.0.1:5174",
    catalog: { fuji: { name: "Fuji", chainId: 43113, services: { public: "https://public.example.test", alchemy: "https://secret.example.test/{API_KEY}" } } },
    ask: async (prompt: string) => { questions.push(prompt); return "" },
  })
  assert.equal(settings.app, "bike-nft")
  assert.equal(settings.resourceOrigin, "https://raw.githubusercontent.com")
  assert.equal(settings.rpcUrl, "https://public.example.test/")
  assert.equal(new URL(settings.url).searchParams.get("chainId"), "eip155:43113")
  assert.match(questions.join("\n"), /Fuji|43113/)
  assert.doesNotMatch(questions.join("\n"), /API_KEY|secret\.example/)
})

test("fully specified viewer setup is noninteractive and rejects contradictory artifact facts", async () => {
  const input = { bytes: bytes(artifacts.escrow), viewerOrigin: "http://127.0.0.1:5174", rpcUrl: "https://public.example.test", ask: async () => { throw new Error("must not prompt") } }
  assert.equal((await prepareReleaseViewer(input)).app, "escrow")
  await assert.rejects(() => prepareReleaseViewer({ ...input, app: "bike-nft" }), /APP|artifact/)
  assert.equal((await prepareReleaseViewer({ ...input, resourceOrigin: "https://other.example.test" })).resourceOrigin, "https://other.example.test/")
  await assert.rejects(() => prepareReleaseViewer({ bytes: input.bytes, viewerOrigin: input.viewerOrigin }), /PUBLIC_RPC_URL|interactive/)
})

test("release viewer setup preserves chosen prefixes and rejects malformed settings", async () => {
  const prefix = "https://raw.githubusercontent.com/org/repo/commit/dapps/example/cam/"
  const input = { bytes: bytes(artifacts.escrow), viewerOrigin: "http://127.0.0.1:5174", rpcUrl: "https://public.example.test" }
  assert.equal((await prepareReleaseViewer({ ...input, resourceOrigin: prefix })).resourceOrigin, prefix)
  assert.equal((await prepareReleaseViewer({ ...input, resourceOrigin: "https://raw.githubusercontent.com/org/other/" })).resourceOrigin, "https://raw.githubusercontent.com/org/other/")
  await assert.rejects(() => prepareReleaseViewer({ ...input, resourceOrigin: "not a URI" }), /absolute/)
})

test("a chain without a catalog public endpoint still names the required chain in its custom prompt", async () => {
  const prompts: string[] = []
  const settings = await prepareReleaseViewer({ bytes: bytes(artifacts.escrow), viewerOrigin: "http://127.0.0.1:5174", catalog: {},
    ask: async prompt => { prompts.push(prompt); return "https://public.example.test" },
  })
  assert.match(prompts[0], /31338/)
  assert.equal(new URL(settings.url).searchParams.get("chainId"), "eip155:31338")
})

test("IPFS viewer setup does not invent an HTTP pin and custom RPC mistakes can be corrected without restarting", async () => {
  const answers = ["9", "2", "not a URL", "https://public.example.test/path"]
  const settings = await prepareReleaseViewer({
    bytes: bytes({ ...artifacts["pay-to-play"], camURI: "ipfs://bafybeigdyrzt5sfp7udm7hu76zryo5bugubxgwf3d2wwuom2gkdcbx3zva/main.json" }),
    viewerOrigin: "http://127.0.0.1:5174", catalog: { fixture: { chainId: 31338, services: { public: "https://default.example.test" } } },
    ask: async () => answers.shift()!,
  })
  assert.equal(settings.resourceOrigin, undefined)
  assert.equal(settings.rpcUrl, "https://public.example.test/path")
  assert.deepEqual(answers, [])
})

for (const [app, artifact] of Object.entries(artifacts)) {
  test(`${app} IPFS releases use ordinary viewer connection coordinates`, () => {
    const camURI = "ipfs://bafybeigdyrzt5sfp7udm7hu76zryo5bugubxgwf3d2wwuom2gkdcbx3zva/main.json"
    const url = new URL(releaseViewerURL(app, bytes({ ...artifact, camURI }), "http://127.0.0.1:5174", "https://resources.example.test", "https://rpc.example.test"))
    assert.equal(url.searchParams.get("host"), common.camRoot)
    assert.throws(() => releaseViewerURL(app, bytes({ ...artifact, camURI: "ipfs://invalid/main.json" }), url.origin, "https://resources.example.test", "https://rpc.example.test"))
  })
  test(`${app} public release uses the deployed chain and explicit browser RPC`, () => {
    const rpc = "https://api.avax-test.network/ext/bc/C/rpc"
    const url = new URL(releaseViewerURL(app, bytes({ ...artifact, chainId: 43113 }), "http://127.0.0.1:5174", "https://raw.githubusercontent.com", rpc))
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      chainId: "eip155:43113", host: common.camRoot, account: common.deployer, rpcUrl: rpc,
    })
    assert.throws(() => releaseViewerURL(app, bytes(artifact), url.origin, "https://raw.githubusercontent.com", "https://user:secret@example.test/rpc"), /username|password|credentials/)
  })
  test(`${app} attachment uses its canonical release artifact and ordinary viewer inputs`, () => {
    const url = new URL(releaseViewerURL(app, bytes(artifact), "http://127.0.0.1:5174", "https://raw.githubusercontent.com", "http://127.0.0.1:5174/rpc"))
    assert.equal(url.origin, "http://127.0.0.1:5174")
    assert.deepEqual(Object.fromEntries(url.searchParams), {
      chainId: "eip155:31338", host: common.camRoot, account: common.deployer,
      rpcUrl: "http://127.0.0.1:5174/rpc",
    })
    assert.doesNotThrow(() => releaseViewerURL(app, bytes({ ...artifact, camHash: hash(0) }), url.origin, "https://raw.githubusercontent.com", "http://127.0.0.1:5174/rpc"))
  })
}

test("attachment rejects unknown apps before interpreting an artifact", () => {
  assert.throws(() => releaseViewerURL("other", bytes({}), "http://127.0.0.1:5174", "https://raw.githubusercontent.com", "http://127.0.0.1:5174/rpc"), /bike-nft, escrow or pay-to-play/)
})


test("release operator may select HTTPS/IPFS or IPFS-only without adding policy to the link", async () => {
  for (const [resourceOrigin, expected] of [["*", "*"], ["none", undefined]] as const) {
    const settings = await prepareReleaseViewer({
      bytes: bytes(artifacts.escrow), viewerOrigin: "http://127.0.0.1:5174",
      rpcUrl: "https://public.example.test", resourceOrigin,
    })
    assert.equal(settings.resourceOrigin, expected)
    assert.deepEqual([...new URL(settings.url).searchParams.keys()], ["chainId", "host", "account", "rpcUrl"])
  }
})
