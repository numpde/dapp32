---
title: "Release diagnostics"
description: "Locate private release logs, distinguish approval from execution and interpret bounded RPC/PTY evidence."
outline: false
---

# Release diagnostics

<div class="ported-guide">

Start with the records directory printed by the failed command. Diagnose the failing boundary before deciding whether to resume. Use [release recovery](../deployment/recovery.html) for the commands that act on the result.

## What does the observation establish? {#symptoms}

<div class="table-scroll" role="region" aria-label="Table: Observation / Interpretation and next check" tabindex="0">
<table><thead><tr><th>Observation</th><th>Interpretation and next check</th></tr></thead><tbody>
<tr><td>Waiting for approval</td><td>No automatic permission is granted. Check the displayed operation and private approval log; do not approve just to clear a stalled terminal.</td></tr>
<tr><td>A broadcast journal exists</td><td>It may exist after rejection. Check approval audit, sender nonce and actual chain outcome; the file alone proves no transmission.</td></tr>
<tr><td>An RPC submission returned a hash</td><td>Look for a successful mined receipt. Acceptance by an RPC is not contract execution.</td></tr>
<tr><td>A submission response was lost</td><td>The outcome is uncertain. Reconcile the retained transaction before approving another creation.</td></tr>
<tr><td><code>request not forwarded</code></td><td>Local admission or deadline failure occurred before forwarding. Check active/queued counts and the request's deadline.</td></tr>
<tr><td><code>upstream returned HTTP …</code></td><td>The provider returned an HTTP failure. Distinguish that from local capacity rejection.</td></tr>
<tr><td>Cleanup is unconfirmed</td><td>Inputs and diagnostic evidence are intentionally retained. Restore engine access and identify the owned project; do not report removal as successful.</td></tr>
</tbody></table>
</div>

## Private logs and their limits {#logs}

The ordinary release launcher collects `approval-diagnostics.log` before teardown: state and bounded tails for the approval tool and its signing/artifact RPC proxies. The file is capped at 64 KiB with at most 16 KiB per service. Collection is time-limited and cannot replace an existing file; a collection failure is reported separately from cleanup.

Automated approval rehearsals additionally retain:

<div class="table-scroll" role="region" aria-label="Table: File / Evidence" tabindex="0">
<table><thead><tr><th>File</th><th>Evidence</th></tr></thead><tbody>
<tr><td><code>approval-pty.log</code></td><td>Live private terminal transcript, at most 8 MiB. Exceeding the limit fails the rehearsal.</td></tr>
<tr><td><code>approval-rpc.log</code></td><td>Live RPC-only extract, at most 1 MiB.</td></tr>
<tr><td><code>approval-pty-tail.log</code></td><td>Final 512 KiB, including shutdown after a capture-limit failure.</td></tr>
<tr><td><code>approval-diagnostics.json</code></td><td>Prompt milestones, simulation mode, last RPC, counters and diagnostic result.</td></tr>
<tr><td><code>signer-tail.log</code>, <code>approval-tail.log</code></td><td>Best-effort state and last 80 output lines before teardown.</td></tr>
<tr><td><code>source-commit</code>, <code>simulation-mode</code></td><td>The exact private fixture candidate and chosen experiment.</td></tr>
</tbody></table>
</div>

The live PTY/RPC files are created exclusively with mode `0600`. Full logs can contain transaction details and approval challenges; do not post them publicly without review. Progress summaries omit those values. Capture exhaustion does not stop draining the PTY during cleanup. Container tails may be unavailable after the relevant container has already been removed.

## RPC capacity is part of the deadline {#rpc}

Each release RPC proxy executes at most two connections concurrently and queues up to 32. Queue waiting consumes the original 40-second connection deadline; starting a worker does not reset it. The approval tool allows 45 seconds for a proxy response. Its separate operator-decision timeout is 180 seconds. Each dispatched request has one upstream attempt: the proxy does not silently retry a transaction submission.

Listener-assigned connection/request numbers correlate reads, writes and elapsed time without logging caller IDs, parameters or response bodies. `write=flushed` says the socket callback completed, not that Forge consumed the reply. Five-second summaries distinguish empty connections from bytes that never formed a valid request.

Malformed frames report framing, size, UTF-8, JSON or admission stage. JSON failures also identify a fixed reason and location. Parameters/results accept finite JSON numbers, but request IDs must be strings, null or safe integers. Transaction quantities remain hexadecimal strings; diagnostic changes do not relax signed transaction validation.

Detail traces are bounded to 128 lines per second and 448 KiB per listener, with 64 KiB reserved for summaries. Backpressure drops trace lines rather than accumulating them. More than 256 connection attempts in one second closes admission and the approval owner with a connection-storm failure; it is not evidence that the client's underlying defect was repaired.

## Simulation experiments are fixture-only {#simulation}

An unsupported optional RPC method alone does not establish why a client stalled. Follow the standard reads and their responses in the correlated trace. For example, the pinned Foundry account loader can probe `eth_getAccountInfo` and fall back after an error; inspect what happened next rather than widening permissions.

Only after examining a failed normal approval-start rehearsal, compare a separate disposable run:

```sh
make escrow/release/approval/start/check \
  DOCKER_CONTEXT=your-local-context \
  RELEASE_APPROVAL_IMAGE=sha256:<reviewed-image-id> \
  RELEASE_APPROVAL_SIMULATION=skip
```

`normal` remains the default. The explicit `skip` experiment is admitted only by the startup check and changes one signer command in its new private fixture source. It does not edit the operator checkout or production launcher. Approval isolation, automatic fixture rejection and cleanup remain enforced.

A passing skip run identifies a dependency on normal simulation/preparation, not a root cause or a safe production workaround. Never add an automatic skip fallback or bypass approval to obtain a green result. Compare the two runs' `approval-diagnostics.json` and `approval-rpc.log`.

Source: [bounded rehearsal diagnostics](https://github.com/numpde/dapp32/tree/04a18763700bbaa25cad73b9806d236ab4d5e139/tests/fixtures/release-rehearsal), [RPC proxy implementation](https://github.com/numpde/dapp32/tree/04a18763700bbaa25cad73b9806d236ab4d5e139/containers/rpc-proxy) and [the account-loader fallback](https://github.com/foundry-rs/foundry-core/blob/fork-db-v0.26.0/crates/fork-db/src/backend.rs#L311-L398).

</div>
