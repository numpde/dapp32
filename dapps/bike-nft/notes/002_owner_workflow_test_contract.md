# Owner workflow test contract

Bike implements reversible owner lifecycle, workshop grants invalidated by an
ownership change, and direct ERC-721 handover through the checked-in CAM 1.3.0
publication. This note defines the product laws and the boundaries exercised
by the contract, protocol, adapter, viewer, and publication tests.

The current Docker-backed JS, repository, and integration-tool checks passed,
as did the isolated fresh-chain Bike write campaign. Solidity sources are
unchanged; the earlier 82-test qualification was not rerun. A browser journey
and full public-release qualification remain outstanding.

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
  A duration preview uses the chain clock to return an exact expiry for the
  existing grant write. Only the current owner can grant or revoke access.
  Manager pause disables those writes; collection pause does not. The preview
  rejects zero/over-limit durations and expiries outside uint48.
- Handover is a direct ERC-721 safe transfer, not payment escrow, recipient
  consent, physical-delivery verification, or a new manager transfer privilege.
  The token collection is resolved from the loaded record, not the collection
  configured for future registrations. Registry pause is not token pause.
- Old deployed `Retired` records are not relabeled as reversible inactivity.
  Legacy fixture compatibility remains explicitly read-only. The new lifecycle
  requires fresh contracts; migration is outside these tests.

## CAM boundary

The production publication uses CAM `1.3.0`. A write route can have one
`resolve` invocation against a static host-bound contract namespace. That ABI
function must be read-only. Its outputs supply the final `call.target` and
arguments; the target must be a scalar address output, not editable UI input.
There are no resolver chains, resolver target overrides, or continuations.
Resolver outputs do not become write-continuation outputs.

For Bike, the read is `tokenReference(serialNumber)` and the write is
`safeTransferFrom(address,address,uint256)`. The published ABI includes both
ERC-721 overloads to prevent a false unambiguous-name shortcut. Once prepared, the
destination/arguments are frozen through simulation and submission. A late
result after account/navigation changes is discarded. Existing CAM 1.2 static
calls remain supported and tested; 1.2 rejects the new fields.

Local and release deployments bind `BicycleComponents` alongside the manager
and UI. The release approval reference includes that exact binding call, and
the artifact reader and release verifier check it. Existing component records
continue to resolve their own collection after the manager changes the
collection configured for future registrations.

## Coverage and qualification

- Solidity unit/scenario files cover lifecycle, authorization, input errors,
  ownership changes, callbacks, failed transfers, fresh-contract journeys,
  workshop action availability, pause ownership, and expiry boundaries.
- The ownership invariant uses a two-token ghost model and a seeded ownership
  round trip. Fuzz tests cover masks and lifecycle/report combinations.
- Core/conformance/viewer tests exercise the resolved-target boundary and use
  real adapter simulation/submission boundaries with controlled RPC fixtures.
- Bike screen/session/wallet tests load the checked-in publication.
- Existing wallet tests retain account/network/cancellation coverage; added
  retry/receipt tests distinguish submitted, pending, rejected, and reverted.

Current qualification covers the working tree based on `477f9228` with the four
follow-up audit fixes. All four lanes exited successfully:

- `make js/tests`: 833 JS tests.
- `make tests/checks`: 316 repository checks.
- `make cam/integration/fuzz/check`: 33 tests.
- `make bike-nft/local/integration/fuzz/fixture-writes/run`: the deterministic seller/buyer/mechanic
  campaign and the 16-step generic walker, with 15 successful receipts across
  both campaigns. Cleanup verified no fixture containers, networks, or volumes
  remained.

The earlier qualification at `e931fb8b` passed all 82 Bike Solidity
unit/scenario and invariant tests through `make dapps/tests`. Solidity sources
are unchanged, and that lane was not rerun for the current qualification.
`make dapps/format/check`, `make cam/conformance/check`,
`make bike-nft/release/check`, and `make viewer/terminal/check` also retain their
earlier baseline results; they were not rerun in this qualification.

The local write lane runs the deterministic seller/buyer/mechanic campaign
before the generic random walk. Three distinct signing accounts establish a
real ownership change to the buyer. Actual contract `eth_call` results decoded
as `Unauthorized` prove the old seller and mechanic lose write authority; the
campaign also exercises the new owner's write authority. Funding and signing
are restricted to the private Bike Anvil service. The generic walker remains
single-account; the separate deterministic campaign supplies the distinct-actor
evidence.

Input inference now consumes direct state bindings from actual enabled rendered
actions, not unrelated nodes in the UI document. Focused regressions cover shared
route/state-key names across separate screens, legitimate same-screen conflicts,
disabled actions, and Include instances.

The Foundry scenarios deploy real contracts inside the test VM. Adapter and
viewer tests use controlled RPC fixtures. The fresh-chain campaigns add bounded
evidence from the isolated local deployment. These checks do not establish a
completed browser wallet journey or full public release ceremony. Run the
remaining full repository and documented browser/release journeys before
claiming those qualifications.
