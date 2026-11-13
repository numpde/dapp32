---
title: "Recover an interrupted release"
description: "Resume retained deployment work, reconcile mined transactions and recover missing records without accidentally redeploying contracts."
outline: false
---

# Recover an interrupted release

<div class="ported-guide">

Keep the original instance directory. Find out what completed before approving another transaction. A failed terminal command does not mean every transaction failed.

<dl><dt>Run on</dt><dd>The release workstation, in the source checkout selected by the saved operation.</dd><dt>Requires</dt><dd>The whole private instance, its referenced configuration and chain access. Signing continuations also require the recorded approval image and authorized signer.</dd><dt>Changes</dt><dd>Read-only reconciliation writes evidence locally. Resuming an unfinished signing phase can submit the remaining transactions, with fresh approval.</dd><dt>Success</dt><dd>The selected operation has verified final artifacts, or an unresolved outcome is identified without creating a replacement deployment.</dd></dl>
<nav aria-label="Guide sections"><a href="#choose">Choose the failure</a> · <a href="#inspect">Inspect</a> · <a href="#records">Finish records</a> · <a href="#resume">Resume</a> · <a href="#stop">Stop</a></nav>

## Choose the failure, not a new deployment {#choose}

<div class="table-scroll" role="region" aria-label="Table: What happened? / Next action" tabindex="0">
<table><thead><tr><th>What happened?</th><th>Next action</th></tr></thead><tbody>
<tr><td>The command printed a bundle directory and stopped for its URL.</td><td>This is the <a href="new-instance.html">hosting pause</a>. Host those exact files, repeat the same command and select the saved work.</td></tr>
<tr><td>A transaction hash exists but its outcome is unknown.</td><td>Inspect its chain receipt and retained broadcast/approval records. Do not approve a replacement creation merely because the RPC response was lost.</td></tr>
<tr><td>Transactions succeeded but the final artifact is absent.</td><td>Use <a href="#records">keyless artifact completion</a>, not another deploy command.</td></tr>
<tr><td>Some CAM changes succeeded and others remain.</td><td><a href="#resume">Resume the original intent</a>. A confirmed partial root is evidence for continuation, not permission to replay its creation.</td></tr>
<tr><td>The saved approval image is missing.</td><td>Restore that exact image before signing. Read-only verification does not need it.</td></tr>
<tr><td>Source verification failed after deployment.</td><td>Retry <code>release/source/publish</code>. This does not require contract replacement.</td></tr>
<tr><td>Cleanup could not finish.</td><td>Keep the reported project identity, private inputs and logs. Restore access to that engine before attempting owned cleanup.</td></tr>
</tbody></table>
</div>

## 1. Inspect the retained operation {#inspect}

Use the same context and instance as the failed command. These examples use Pay-to-Play; substitute `escrow` or `bike-nft` for that app's commands.

```sh
CTX=your-local-context &&
INSTANCE=/absolute/private/pay-to-play-instance &&
make pay-to-play/release/verify DOCKER_CONTEXT="$CTX" INSTANCE="$INSTANCE"
```

Select the relevant saved operation, not whichever directory looks newest. Verification does not sign, deploy or submit sources to an external service. It checks retained evidence against the chain. It does not establish current ownership, current balances or current pause state.

Retain `instance.json`, `selection.json`, configurations, source inputs, broadcasts, approval audits and artifacts together. Editing today's default configuration does not alter a saved operation's selected source, approval image or intended handoffs. See the [record layout](manual.html#release-records).

## 2. Complete records without signing {#records}

Choose the command for the missing artifact. Each command offers retained work; it does not create replacement contracts or send missing initialization transactions.

```sh
make pay-to-play/release/contracts/artifact DOCKER_CONTEXT="$CTX" INSTANCE="$INSTANCE"
```

```sh
make pay-to-play/release/ui/artifact DOCKER_CONTEXT="$CTX" INSTANCE="$INSTANCE"
```

```sh
make pay-to-play/release/cam/artifact DOCKER_CONTEXT="$CTX" INSTANCE="$INSTANCE"
```

Existing final artifacts are checked and kept unchanged. Saved evidence chooses the original sources. JavaScript dependencies must match that source's lockfile; `RELEASE_ARTIFACT_NODE_MODULES_DIR` can select a separately installed matching tree. A records-only machine can use protected read-only configurations at the paths referenced by the saved operation; no signing key must be staged for this step.

Completing the selected pending publication can clear its pending reference. Verifying unrelated historical work does not switch the selected deployment. Do not delete an incomplete attempt simply because another attempt completed.

## 3. Resume only what remains {#resume}

Repeat the exact command that began the operation and choose **Resume**. A saved signing phase requires its selected source revision and approval image. Review the requested remaining transactions against the original intent before approving.

For a hosting pause, upload or pin only the prepared `bundle/` contents. Preserve paths and exact bytes, check browser access, then repeat the same operation and supply the hosted manifest URL. Do not upload the instance or its credentials.

A confirmed partial CAM attempt can retain `cam/artifact/cam-attempt.json`; its continuation is recorded under `cam/continuation/`. Already-accepted nominees remain accepted. An edited configuration cannot silently authorize a different handoff.

When root creation has no confirmed outcome, investigate first. The workflow does not automatically replay it. An explicit separate attempt can create additional contracts; select that only after resolving the old outcome. A repaired CAM publication can reuse compatible saved business contracts and the prepared bundle.

## Stop or cancel {#stop}

Ctrl-C, SIGHUP and SIGTERM initiate owned cleanup. Let it finish; closing the browser tab is not cleanup. A release removes its private ceremony resources, not a separately started shared local network. A successfully cleaned-up operation still retains its deployment evidence.

SIGKILL, host loss or an inaccessible Docker daemon cannot guarantee cleanup. An unconfirmed cleanup must remain a failure, with its reported records retained. Do not delete arbitrary similarly named projects or weaken private-file permissions to get past the error.

Inspect [diagnostic logs](manual.html#progress-and-bounded-diagnostics) when the failing phase is unclear. For a deliberate new version rather than recovery, return to [Update an existing app](update.html).

Implementation: [instance selections and recovery](https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/tools/release_instance.py), [instance command launcher](https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/tools/release_instance.sh) and [owned Compose cleanup](https://github.com/numpde/dapp32/blob/04a18763700bbaa25cad73b9806d236ab4d5e139/tools/compose_cleanup.sh).

</div>
