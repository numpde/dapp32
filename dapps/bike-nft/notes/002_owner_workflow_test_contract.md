# Owner workflow test contract

This branch contains tests, not the feature implementation. It starts from
`df9602a3295ef45d336b94015899161c96973881`. New acceptance tests are expected to
fail until the corresponding behavior is implemented. A compilation failure or
an unrelated fixture error is not acceptable evidence of the intended red test.

## Product laws

- Current owners alone decommission/reactivate components. These operations
  are reversible and independent of missing reports. Metadata corrections and
  ordinary token transfers remain available in either lifecycle state.
- `inactiveStatus(string)` exposes the independent lifecycle flag. Unknown
  nonempty serials return false; empty serials retain the manager's input error.
  Unknown/empty writes fail. The old retirement write and capability bit 8 must
  not retain authority. Missing-report capabilities remain separate bits 2/4.
- An actual ownership change invalidates previous workshop grants permanently,
  even if the token returns to its former owner. Self-transfers do not count as
  ownership changes. Failed transfers have no effects. Tests assert authority,
  not a particular counter layout.
- Workshop access is address-based inspection, not a claim to enumerate all
  delegates. Named presets use masks 1, 2, 4, and 7; no raw mask input is needed.
  A duration preview returns an exact expiry for the existing grant write.
- Handover is a direct ERC-721 safe transfer, not payment escrow, recipient
  consent, physical-delivery verification, or a new manager transfer privilege.
  The token collection is resolved from the loaded record, not the collection
  configured for future registrations. Registry pause is not token pause.
- Old deployed `Retired` records are not relabeled as reversible inactivity.
  Legacy fixture compatibility remains explicitly read-only. The new lifecycle
  requires fresh contracts; migration is outside these tests.

## Proposed CAM boundary pinned by tests

The test-only successor document uses CAM `1.3.0`. A write route can have one
`resolve` invocation against a static host-bound contract namespace. That ABI
function must be read-only. Its outputs supply the final `call.target` and
arguments; the target must be a scalar address output, not editable UI input.
There are no resolver chains, resolver target overrides, or continuations.
Resolver outputs do not become write-continuation outputs.

For Bike, the read is `tokenReference(serialNumber)` and the write is
`safeTransferFrom(address,address,uint256)`. The fixture includes both ERC-721
overloads to prevent a false unambiguous-name shortcut. Once prepared, the
destination/arguments are frozen through simulation and submission. A late
result after account/navigation changes is discarded. Existing CAM 1.2 static
calls remain positive controls; 1.2 cannot silently accept the new fields.

The fixture is a proposed publication input, not a shipped protocol version.
There are no production parser, contract, viewer, manifest, ABI, or integrity
changes in this branch.

## Coverage and qualification

- Solidity unit/scenario files cover lifecycle, authorization, input errors,
  ownership changes, callbacks, failed transfers, and fresh-contract journeys.
- The ownership invariant uses a two-token ghost model and a seeded ownership
  round trip. Fuzz tests cover masks and lifecycle/report combinations.
- Core/conformance/viewer tests specify the resolved-target boundary and use
  real adapter simulation/submission boundaries with controlled RPC fixtures.
- Bike screen/session/wallet tests load the checked-in publication. They do
  not replace the missing feature with a synthetic passing Bike manifest.
- Existing wallet tests retain account/network/cancellation coverage; added
  retry/receipt tests distinguish submitted, pending, rejected, and reverted.

Run the normal repository lanes in a Docker-capable environment:

1. `make tests/checks`
2. `make dapps/format/check` and `make dapps/build`
3. `make dapps/tests` (unit/scenario, fuzz, and invariants)
4. `make js/tests` and `make js/ci`
5. `make tests` on the final implementation, followed by the documented
   disposable Bike demo/browser acceptance journey.

At test-authoring time, `make tests/checks` stopped with `docker: command not
found` (Make exit 2, recipe exit 127). No Docker compilation, test execution,
browser E2E, or fresh-deployment release qualification was performed. Static
review and `git diff --check` are not substitutes for those gates. The real
contract scenarios deploy in Foundry's test VM; they are not evidence that a
release deployment or browser journey has run. No separate Bike browser driver
is introduced by this branch.
