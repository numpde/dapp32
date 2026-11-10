---
title: "Use a payment fixture from another repository"
description: "Hand a verified disposable Pay-to-Play deployment to another test runner and retain explicit cleanup ownership."
outline: false
---

# Use a payment fixture from another repository

<div class="ported-guide">


<p>This repository owns a temporary chain and its contracts. Your test runner owns its services and tests. Both use the <strong>same local Docker engine</strong> and join an explicitly named internal network.</p>
<dl><dt>Requires</dt><dd>A prepared source checkout with locked Solidity dependencies. This fixture does not require the JavaScript workspace.</dd><dt>Changes</dt><dd>An exclusive chain-31337 fixture with public test accounts; no host RPC port.</dd><dt>Success</dt><dd>A verified JSON descriptor, followed by your service's own accounting/collection assertions and ordered cleanup.</dd></dl>
<h2 id="start">1. Choose a unique ID and start</h2>
<p>Set these values in the caller's shell. The output directory must already exist. IDs contain 1–48 lowercase letters, digits, underscores or hyphens, starting with a letter or digit; allocate a different ID for every concurrent run.</p>
<pre><code>CTX=your-local-context &amp;&amp;
DAPPS_CHECKOUT=/absolute/path/to/dapp32 &amp;&amp;
RUN_ID=unique-payment-test-001 &amp;&amp;
RUN_DIR=/absolute/existing/test-output &amp;&amp;
test -d "$RUN_DIR" &amp;&amp;
make --no-print-directory -C "$DAPPS_CHECKOUT" pay-to-play/local/fixture/up \
  DOCKER_CONTEXT="$CTX" FIXTURE_ID="$RUN_ID" \
  &gt; "$RUN_DIR/fixture.json" 2&gt; "$RUN_DIR/fixture-start.log"</code></pre>
<p>Consume the descriptor only after a successful exit. Immediately register your runner's cleanup for that successfully created fixture, before starting its clients. A failed or interrupted command may leave partial output; the file alone is not success.</p>
<p><code>up</code> refuses existing resources under the ID: it neither resumes nor redeploys into them. Omitting the ID generates one, but caller allocation makes recovery independent of receiving stdout. Projects use the separate <code>dapps-pay-to-play-fixture-</code> prefix, not the GUI/scenario project.</p>
<h2 id="descriptor">2. Use the returned facts, not assumed addresses</h2>
<p><code>up</code> and <code>info</code> emit one JSON line, bounded to 1 MiB, with diagnostics on stderr. <code>--no-print-directory</code> prevents Make's directory banner from corrupting stdout.</p>
<div class="table-scroll" role="region" aria-label="Table: Descriptor field / Use" tabindex="0">
<table><thead><tr><th>Descriptor field</th><th>Use</th></tr></thead><tbody>
<tr><td><code>schema</code>, <code>fixtureId</code></td><td>Require <code>pay-to-play.local-fixture.v1</code> and retain the exact lifecycle handle.</td></tr>
<tr><td><code>composeProject</code>, <code>dockerNetwork</code></td><td>Identify owned resources and the existing network your consumer joins.</td></tr>
<tr><td><code>rpcUrl</code>, <code>chainId</code></td><td>Configure the consumer inside that network; chain ID is 31337.</td></tr>
<tr><td><code>contracts.CamRoot</code>, <code>contracts.PayToPlay</code>, <code>contracts.PayToPlayUI</code></td><td>Each includes address, mined deployment block and creation transaction. PayToPlay also contains its matching <code>abi</code>.</td></tr>
<tr><td><code>publicFixtureAccounts</code></td><td>Admin, customer, relayer and payee addresses and deliberately public test keys.</td></tr>
</tbody></table>
</div>
<p>The exporter checks chain identity, successful deployment receipts at their recorded blocks, deployed code and the payment creation input. The ABI comes from the Forge invocation that deployed it, retained in the fixture volume—not a substituted current ABI. This is fixture provenance, not a general remote-code verification service.</p>
<h2 id="connect">3. Attach and run the actual service tests</h2>
<p>Declare an external Compose network whose name is the returned <code>dockerNetwork</code>, and give your test service the returned <code>rpcUrl</code>. No RPC port is exposed on the host. Network peers can invoke Anvil's test-only mutation methods; admit only trusted fixture clients.</p>
<p>Fresh deployments have reserve channel 0 and funded fixture accounts, not service channels or registered voucher keys. Create channels, register keys and fund through normal calls. Use <code>contracts.PayToPlay.address</code> for voucher signing and settlement; the CAM host and projection are not substitutes.</p>
<p>To recheck the running fixture:</p>
<pre><code>make --no-print-directory -C "$DAPPS_CHECKOUT" pay-to-play/local/fixture/info \
  DOCKER_CONTEXT="$CTX" FIXTURE_ID="$RUN_ID"</code></pre>
<p><code>info</code> uses a temporary reader and grants no cleanup ownership. Deployment readiness does not prove invoice acceptance, durability, delivery or collection allocation; assert those in <a href="../pay-to-play/integration.html">your integration</a>.</p>
<h2 id="cleanup">4. Stop clients, then remove only your fixture</h2>
<p>Your runner's finally/cleanup path must stop and disconnect its own containers first, then remove the fixture even when its tests or a later <code>info</code> call failed:</p>
<pre><code>make -C "$DAPPS_CHECKOUT" pay-to-play/local/fixture/down \
  DOCKER_CONTEXT="$CTX" FIXTURE_ID="$RUN_ID"</code></pre>
<p>Removal is safe to repeat for your owned ID. A rejected collision or info-only attachment does not authorize removing somebody else's resources. Trappable startup/verification/output failures attempt cleanup of that start attempt; SIGKILL, host loss or an unavailable engine can leave an uncertain outcome.</p>
<p>Retain the allocated ID and stderr log, which announces recovery coordinates before resource creation. Inspect an uncertain result before removal or another start. Do not infer ownership from a partially written descriptor or silently guess that cleanup succeeded.</p>
<p>Implementation: <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/tools/pay_to_play_fixture.sh">fixture lifecycle</a>. For self-contained campaigns, use <a href="app-checks.html">the app checks</a>.</p>

</div>
