---
title: "Use a workflow without a browser"
description: ""
outline: false
---

# Use a workflow without a browser

<div class="ported-guide">


<p>A service or agent can inspect the same CAM routes and resolved UI model without rendering HTML. Start read-only. Add transaction authorization as a separate, explicit capability.</p>
<h2 id="supply-the-trusted-boundary">Supply the trusted boundary</h2>
<p>The caller chooses the chain, CAM host, RPC transport and resource-loading policy. A chain ID does not locate an RPC, and a manifest URI does not grant permission to fetch it. Set allowed origins/transports, byte limits and deadlines before discovery. Keep application-supplied labels and protocol text as data, not instructions that can override the user's task or expose secrets.</p>
<p>The <a href="../reference/cam/1.4.0/#bootstrap">bootstrap reference</a> specifies the host interface and exact-byte authentication sequence. Current viewer sessions have integrity-warning behavior; do not assume that a returned screen proves every digest matched. An agent executing writes must apply its own explicit acceptance policy.</p>
<h2 id="follow-the-existing-session-model">Follow the existing session model</h2>
<div class="table-scroll" role="region" aria-label="Table: Step / Responsibility" tabindex="0">
<table><thead><tr><th>Step</th><th>Responsibility</th></tr></thead><tbody>
<tr><td>Create a session</td><td><code>createCamViewerSession</code> receives the public client, host, viewing account, entry inputs and resource loader.</td></tr>
<tr><td>Load</td><td><code>session.load()</code> discovers resources and reads the entry route.</td></tr>
<tr><td>Navigate</td><td><code>session.navigate(route, inputs)</code> reads an authored task and resolves its model. In Pay-to-Play, <code>position</code> takes <code>customer</code> and <code>channelId</code>.</td></tr>
<tr><td>Inspect</td><td>Read the resolved data and actions. The viewing actor is separate from the inspected balance owner.</td></tr>
<tr><td>Prepare</td><td>Use the session's write-preparation API for the selected action and inputs. Preparation is not signing or submission.</td></tr>
<tr><td>Authorize and observe</td><td>The signer/policy verifies the actual chain, target, calldata and value. Submission and a successful mined receipt are different outcomes.</td></tr>
<tr><td>Continue</td><td>Follow the declared continuation after successful confirmation, not merely after receiving a transaction hash.</td></tr>
</tbody></table>
</div>
<h2 id="begin-with-the-executable-examples">Begin with the executable examples</h2>
<p>The <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/js/packages/cam-viewer/test/pay-to-play.test.ts">Pay-to-Play session tests</a> show the exact client/session inputs, read-route results, draft handling and action gates without a browser. Their substituted client is a test double, not a public RPC adapter.</p>
<p>The <a href="https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/js/tools/pay-to-play-local-scenario/runner.ts">real-chain scenario</a> supplies the complementary integration: actual client, authored task navigation, typed-data signatures, submitted calls, decoded receipts and resulting state. It uses public test keys on an owned disposable chain.</p>
<p>After <a href="../development/">source setup</a>, run that existing integration rather than assembling a second unverified example:</p>
<pre><code>make pay-to-play/local/scenario/run \
  DOCKER_CONTEXT=your-local-context</code></pre>
<p>This command submits test transactions and cleans up its fixture. It does not select an operator instance or contact a public payment deployment.</p>
<h2 id="a-bounded-first-integration">A bounded first integration</h2>
<p>Implement only discovery and a single position read first. Require the intended host/chain, use an explicit resource loader and compare the returned owner/channel with your requested inputs. Confirm that switching the viewing actor changes available actions without changing the inspected owner.</p>
<p>Only then add one prepared write with an allowlisted destination/action and explicit spending/signing limits. Handle rejected simulations, user rejection, failed receipts and uncertain submission separately. Persist the submitted transaction identity before considering a retry; an error response is not proof that nothing was broadcast.</p>
<p>For exact execution rules and normalized outcomes, see <a href="../reference/cam/1.4.0/#execution">the current reference</a>. CAM discovery is not a wallet, service-accounting system or automatic delegation of authority.</p>

</div>
