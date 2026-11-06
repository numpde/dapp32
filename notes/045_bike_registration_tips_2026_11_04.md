# Bike registration tips

2026-11-04 · Baseline `04dcf44e` · Agreed policy; not implemented.

## Agreed behavior

Allow an optional native-coin tip during component registration, paid in the
same transaction. Zero is valid. Registration
permissions and component ownership do not change: the registering wallet pays,
which may be different from the address receiving the NFT.

Accrue tips in the registration contract. Do not forward funds to the recipient
while registering a component. A failed registration rolls back its tip along
with the registration. A recipient that rejects a later payout must not block
new registrations.

Users cannot choose the tip recipient. The existing `DEFAULT_ADMIN_ROLE` can
change it. A change applies to **all unwithdrawn tips**, including those received
before the change, and to future tips. Previously disbursed funds are unaffected.
There is one accrued tip balance, not credits assigned to earlier recipients.

Anyone can trigger disbursement. Funds always go to the recipient configured
when that payout executes; the caller cannot supply a destination. There is no
additional withdrawal/disbursement role. A public disbursement may execute before
an admin's pending recipient change; the change only redirects funds still held
when it executes.

Use these names:

- `setTipRecipient(address)` — admin changes the destination.
- `disburseTips()` — anyone triggers payment of accrued tips.
- `TipsDisbursed(recipient, amount)` — records the actual payout.

The recipient could be a project treasury controlled through a Safe. A Safe is
a contract wallet whose signers and approval threshold can change while its
address remains the same. It is a candidate, not a selected address or a required
dependency. Safe approvals govern spending after receipt; receipt of the tips
does not require owners to approve each incoming payment.

## Contract boundary

The owner of this behavior is
[`BicycleComponentManager`](../dapps/bike-nft/src/BicycleComponentManager.sol),
which already implements `registerComponent(owner, serialNumber, tokenURI_)`.
It is currently nonpayable and rejects ordinary native-coin transfers.
The NFT contract, CAM root and read-only UI helper do not hold the tip balance.

Implementation direction:

1. Make registration payable, using `msg.value` as the tip. No separate amount
   argument is needed. Preserve registrar and pause checks.
2. Track accrued tips explicitly and emit evidence associating positive tips
   with their registration. Preserve the existing registration result/event.
3. Expose the recipient (proposed getter: `tipRecipient()`) and accrued amount
   for app reads. Initialize a nonzero
   recipient; validate admin updates and emit the old and new destinations.
4. For disbursement, snapshot the recipient and amount, update accounting before
   the external call, and guard against reentrancy. A failed payment must revert
   accounting changes. Emit the snapshotted recipient and amount on success.
   Audit registration's existing safe-mint callback as part of this boundary.
5. Disburse the tracked tip balance. Do not silently treat unsolicited or forced
   native funds as registration tips.

The permissionless caller pays the disbursement transaction's gas. The donor
needs only the registration transaction. Tips can accumulate until someone
triggers a payout.

## App and deployment work

Add an optional tip, defaulting to zero, using the existing `AmountField`. Pass its exact base-unit
value through the registration CAM write route's existing top-level `value`
mechanism. Retain exact integer accounting and the normal transaction simulation
and wallet review.

Review must show the tip separately from gas, show the current recipient read
from the contract, and explain that the admin can redirect collected tips before
disbursement. Do not describe this recipient as immutable or promise that the
currently displayed wallet will necessarily receive the later payout.

Expose current recipient/accrued tips and a deliberate disbursement action.
An admin recipient-change form must use the existing role checks. No new CAM UI
schema field or special registration renderer is needed.

This requires contract, ABI, CAM resource and deployment work; adding an input
to the current app alone cannot make the deployed registration method payable.
Plan manager/UI-helper bindings, token-role grants, publication integrity and
continued access to existing component records before changing deployments.
No contract or deployment is changed by this note.

## Verification and remaining choices

Test at least:

- Zero and positive tips, correct registrar permissions and unchanged NFT owner.
- Failed registration, duplicate serial and paused registration leave no tip
  credit or tip event behind.
- A rejecting recipient does not prevent registration; failed disbursement
  preserves the accrued balance for a later attempt or recipient change.
- Only the default admin can change the recipient. Rotating it directs the
  entire outstanding balance to the new recipient, without reclaiming earlier
  payouts.
- Any caller can trigger payout, cannot redirect it, and cannot disburse the
  same credit twice, including through recipient and safe-mint callbacks.
- Payout events identify the actual recipient even if a privileged callback
  changes the destination for future payouts.
- App entry, simulation, review, mined registration and disbursement evidence
  agree on exact native amounts. Exercise UI checks in an isolated headless
  browser with automatic cleanup.

Before implementation, settle the initial recipient address, empty-balance
behavior, whether to reject the manager itself as recipient, whether registry
pause affects disbursement, and the treatment of unsolicited native funds.
These are open implementation choices, not additional agreed policy.

## References

- [Manager source](../dapps/bike-nft/src/BicycleComponentManager.sol) and
  [Bike CAM manifest](../dapps/bike-nft/cam/main.json).
- [Solidity withdrawal pattern](https://docs.soliditylang.org/en/latest/common-patterns.html#withdrawal-from-contracts):
  separate payment delivery from the operation that accrues it, so a recipient
  cannot block that operation by rejecting payment.
- [Safe account concepts](https://docs.safe.global/advanced/smart-account-concepts):
  owners, approval thresholds and contract-account transaction execution.
