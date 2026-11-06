# Pay-to-Play navigation plan

2026-11-04 · Baseline `f2e6e11c`. Implemented and qualified in PR #16
(`feature/pay-to-play-focused-navigation`). A disposable-chain scenario and
a 13-transaction headless-browser journey passed on 2026-11-06, including 1280px
and 320px layouts, receipt evidence, voucher-detail Back navigation, and the
selected-account task menu. These are fixture results, not a public deployment.

## Outcome and scope

Replace the overloaded balance page with six focused destinations:
**Balance, Deposit, Withdraw or move, Vouchers, Recovery, Channel settings**.
Keep the inspected balance owner and channel identifiable throughout.

This is app authoring in the CAM manifest and UI resources. Use existing read
calls, routes, `Include`, `Screen` and `Button`. No contract, ABI, UI schema or
generic viewer navigation feature is required. Keep write arguments, simulation,
review, receipt interpretation and contract-owned availability intact.

Before this change, `positionFields` stacked seven sections: balance overview,
channel facts, deposit, withdrawal/move, voucher key, voucher payments and
channel settings. The implementation replaces it with separate task routes and
reuses the existing app navigation and selected-balance identity.

Priorities below follow the supported funding/payment/withdrawal lifecycle.
There is no usage telemetry establishing which task is most frequent.

## Workflows and the information each needs

| Destination | User's task | Facts needed before acting |
| --- | --- | --- |
| Balance | Check a position and decide what to do next. | Owner/channel, current balance, historical voucher-paid total, withdrawal request/readiness, phase and relevant deadlines, current payee and channel wait. Keep the summary free of transaction editors. |
| Deposit | Add funds to the selected channel. | Owner/channel, current balance, current payee, phase/deadlines, and the existing explanation of funding's effect on recovery timing. Channel 0 cannot fund voucher payments. |
| Withdraw or move | Request funds, revisit readiness, then withdraw or move them. | Balance, requested amount, balance minus the request, ready time and destination channel. Explain replacement/cancellation timing and that vouchers can still be collected during the wait. |
| Vouchers | Set up a permanent signing key, inspect signing details, or collect an externally signed voucher. | Registered key and its irreversible nature, balance, lifetime paid total, current payee/collector and collection cutoff. Explain cumulative authorization totals and distinguish the digest from a signature. |
| Recovery | Renew funding eligibility, choose a refund recipient, wind down or obtain a refund. | Phase, scheduled and effective deadlines, actual refund recipient, balance and the consequences of each operation. Keep channel retirement distinct from winding down one position. |
| Channel settings | Change channel-wide payment or collection settings. | Channel ID/admin, current payee/collector, immutable wait and closure state. Changes can affect other customers and previously signed vouchers. |

Typical paths:

- Returning customer: Balance → Deposit → Balance; Vouchers when authorizing a
  payment. Checking a balance must not require connecting a wallet.
- New customer: verify channel terms and recipient, then use Vouchers to register
  a key and Deposit to fund. These are independent operations, not wizard steps.
- Exiting customer: Withdraw or move → revisit readiness → withdraw/move.
- Collector: select the customer's balance → Vouchers → inspect/review → collect.
  The inspected customer, signing key, collector and payee are different roles.
- Recovery or administration: enter the focused destination from the same balance
  context, rather than scanning unrelated funding and voucher forms.

Do not describe historical paid totals as funds still available. Balance minus
a withdrawal request is not a guarantee that an outstanding voucher can be paid.
Do not introduce an index of all user positions: the current app requires an
owner/channel selection and does not supply such an index.

## Navigation and context contract

Keep the existing top-level balance lookup and channel-creation entries.
Once a balance is selected, show the six task names in the same order across
roles and phases. Keep Change account or channel reachable. Read destinations
must remain inspectable when their write actions are unavailable.

Use one app-owned navigation composition. Do not infer destinations from section
headings or change the menu according to wallet role or contract actions.
Contract-returned `actions` continues to govern the existing write controls.
A readable destination is not evidence that its transaction is permitted.

The current destination must not silently start a fresh visit and clear a draft.
Prototype an inert current item using existing `Include` composition, preserving
labels and order and distinguishing it from the other task links. Verify its reading,
keyboard and narrow-screen behavior before settling the markup. Do not invent
an `active`, `reason` or `shownWhen` property to implement it.

Every task retains owner/channel identity. Editing lookup inputs must not
retarget context links until the new lookup succeeds. Put only the additional
facts needed for that task nearby; do not reproduce the complete balance page
on every route.
Channel 0 remains inspectable and its no-voucher limitation stays explicit.

## Manifest and UI composition

Keep `position(customer, channelId)` as the read-only Balance overview and retain
`recovery` and `voucherDigest`. Added task-specific read routes:

| Route | Destination |
| --- | --- |
| `depositForm` | Deposit |
| `withdrawalForm` | Withdraw or move |
| `voucherPaymentsForm` | Vouchers |
| `channelSettingsForm` | Channel settings |

Each added task read takes only `customer` and `channelId`, calls the existing
`viewPosition` with the active viewing account as `actor`, and renders the common
`app` wrapper with the selected screen and returned position. Preserve the
current distinction between the viewing actor and the inspected customer.

Extract the existing section bodies into named nodes: `balanceOverview`,
`channelDetails`, `depositFields`, `withdrawalFields`, `voucherKeyFields`,
`voucherPaymentFields` and `channelSettingsFields`. Extract a shared withdrawal
summary if both Balance and Withdraw or move need its facts. Compose those
nodes with `Include`; remove the displaced omnibus `positionFields` path.
Keep eligibility and consequence text with its task instead of adding general
instruction paragraphs to every page.

Vouchers contains separate key-registration and payment sections. Signing
Details remains its read-only subview. Back restores the voucher draft; an
explicit fresh-input link must identify that it starts a fresh form. This plan
does not add a signer, accept private keys or solve partial-collection reuse.

Keep existing write routes and continuations unchanged initially. Continuations
to `position` become a fresh overview with the resulting facts; recovery writes
that return to `recovery` stay there. Reconsider a continuation only if a concrete
workflow check shows the next step is lost. Any change must preserve deliberate
review and submission, and mined-result interpretation.

`Include` renders a supplied node selection; it does not compute eligibility or
explain a missing action by itself. General disabled-control explanations remain
separate work. Do not guess contract rejection reasons from labels or phases.

## Drafts, account changes and outcomes

- Task navigation performs a fresh read and starts that task's form normally.
  Browser/viewer Back refreshes facts and restores compatible saved drafts.
- Refresh preserves the current task's compatible draft.
- Connecting the same selected account preserves a prepared review, draft and
  history, as implemented in `f2e6e11c`. Sending still revalidates account/network
  and simulates. Connecting does not submit automatically.
- A different account invalidates preparation and clears account-specific saved
  drafts. Existing browser positions remain: Back reopens under the new account,
  without restoring the previous account's drafts.
- Preserve the current transaction-feedback lifecycle: successful explicit
  navigation clears the banner; failed navigation retains it. Do not resurrect
  old feedback or transaction reviews when traversing history.

## Implementation and verification

1. Map every existing field, fact and write action to its destination. Record the
   source nodes and keep the existing availability/review bindings. Resolve the
   current-item prototype before broad JSON movement.
2. Author the shared context/navigation and focused read routes. Reuse the
   extracted sections, switch the overview to facts, and remove the old omnibus
   composition. Every linked destination must exist before publication.
3. Update existing tests and scenario drivers that currently assume every editor
   is on `position`. Keep each implementation slice coherent with its tests;
   do not publish a partly migrated menu or preserve a legacy form path.
4. Refresh manifest integrity with `make cam/integrity/refresh`. Run
   `make cam/conformance/check` and `make js/tests` using the selected Docker
   context. Run the existing `make pay-to-play/local/scenario/run` campaign.
5. Exercise the real authored app in an isolated headless browser. Use the
   existing `make pay-to-play/live/browser/check` against an explicit disposable
   local fixture, supplying its `CDP_ORIGIN`, `VIEWER_URL`, `EXPECTED_CAM_URI` and
   `EXPECTED_CAM_HASH`. Despite the target name, this verification must not use
   Fuji, production wallets or the user's visible browser. Own and automatically
   clean up the browser, temporary profile and fixture resources. Also run the
   shared `make viewer/browser/check` when shared viewer behavior is affected.

Acceptance checks:

- Every destination preserves the selected owner/channel and makes a fresh
  authoritative read. Menu labels/order stay stable across customer, collector,
  administrator and public viewing, and across channel 0 and recovery phases.
- Each task contains its intended editors and excludes unrelated transaction
  forms. Balance is an overview, not another copy of every editor.
- Current-item activation cannot discard work. Back/Forward, refresh and
  signing-details round trips obey the draft rules above.
- Exact prepared write arguments, reviews, receipt-derived outcomes and
  availability match existing behavior. Read navigation never signs or sends.
- Deposit, request/replace/withdraw/move, permanent key registration, voucher
  signing-details/collection, channel settings and recovery remain reachable.
- At desktop and narrow widths, verify orientation, current-item presentation,
  focus/keyboard order, wrapping and absence of horizontal overflow. Distinguish
  source/conformance proof from rendered usability proof.

The implementation preserves meaningful test-first commits documenting each
ownership choice. The branch's navigation CI runs CAM conformance, JavaScript
tests, real-contract disposable local scenarios, and a separate Chrome/CDP
browser journey on a fresh local GUI fixture. The browser reported 13 local
transactions, tested at 1280px and 320px, and returned a successful E2E result:
https://github.com/numpde/dapp32/actions/runs/42308551898
The host-owned rootless Docker and public Fuji deployment paths are not exercised
by this navigation CI.

## Sources and related work

- [Current manifest](../dapps/pay-to-play/cam/main.json),
  [UI composition](../dapps/pay-to-play/cam/ui.json) and
  [contract](../dapps/pay-to-play/src/PayToPlay.sol).
- [Navigation exploration](023_workflow_navigation_options.html): broader options
  and the implemented browser-history follow-up; its baseline sections are
  historical, not a statement of the current renderer.
- [Pay-to-Play walkthrough](032_pay_to_play_walkthrough_issues_2026_10_29.txt):
  queued task navigation, reserve-channel prominence, signing handoff and voucher
  reuse. The old narrow-page measurement is evidence from that walkthrough,
  not a new measurement or proof of this proposal.
- [Viewer tests](../js/packages/cam-viewer/test/pay-to-play.test.ts),
  [local scenario](../js/tools/pay-to-play-local-scenario/runner.ts) and
  [browser checks](../js/apps/cam-web/test/pay-to-play-browser-check.mjs).
