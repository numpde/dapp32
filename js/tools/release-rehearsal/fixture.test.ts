import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import test from "node:test"
import { fixtureEnvironment, owners, rehearsalApp, rehearsalConfiguration, shellAssignments } from "./fixture.ts"

test("fixture environment publication preserves literal values without shell execution", () => {
  for (const value of ["", "space separated", "quote'and\\slash", "$(exit 42)", "`exit 42`", "line\nbreak"]) {
    const assignments = shellAssignments({ FIXTURE_VALUE: value })
    const actual = execFileSync("sh", ["-eu", "-c", assignments + 'printf %s "$FIXTURE_VALUE"'], { encoding: "utf8" })
    assert.equal(actual, value)
  }
  assert.throws(() => shellAssignments({ "INVALID;exit": "x" }), /Invalid fixture variable/)
})

test("rehearsal selection refuses unfinished or unknown apps", () => {
  for (const app of ["bike-nft", "escrow", "pay-to-play"]) assert.equal(rehearsalApp(app), app)
  for (const app of ["deposit", "", "../escrow"]) assert.throws(() => rehearsalApp(app), /No release rehearsal/)
})

test("fixture shell inputs contain only credential paths and the local chain", () => {
  assert.deepEqual(fixtureEnvironment("/tmp/fixture"), {
    RPC_URL_FILE: "/tmp/fixture/control/rpc-url",
    DEPLOYER_PRIVATE_KEY_FILE: "/tmp/fixture/control/deployer-key",
    REHEARSAL_CHAIN_ID: "31338",
  })
})

test("ordinary rehearsal configuration prepares components before a publication URI exists", () => {
  for (const app of ["bike-nft", "escrow", "pay-to-play"] as const) {
    const config = rehearsalConfiguration(app, "/tmp/fixture", "a".repeat(40), `sha256:${"b".repeat(64)}`, "fixture-network")
    assert.equal(config.settings.OUTPUT_DIR, "/tmp/fixture/deployment")
    assert.equal(config.settings.EXPECTED_CHAIN_ID, "31338")
    assert.equal(config.settings.CAM_URI, undefined)
    assert.equal(config.settings.INTENDED_CAM_ROOT_OWNER, owners.root.address)
    assert.equal(config.settings.CAM_HASH, "auto")
    if (app === "pay-to-play") assert.equal(config.settings.NULL_CLAIM_PERIOD, "60")
    if (app === "bike-nft") {
      assert.equal(config.settings.TOKEN_NAME, "Rehearsal components")
      assert.equal(config.settings.BASE_TOKEN_URI, "")
      assert.equal(config.settings.COMPONENTS_ADMIN_DELAY, "3600")
    }
    assert.equal(config.localNetwork, "fixture-network")
    assert.equal(config.deployerPrivateKey, `0x${"ba".repeat(32)}`)
  }
})
