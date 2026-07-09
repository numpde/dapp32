# DRY / SSoT Follow-Ups

Checklist from the July 9 read-only DRY/SSoT audit. Completed items record the
small local drift fixes made before publication. Do not reopen paused
architecture lanes from this note.

## Checklist

- [x] Fix the gh-pages Bike NFT route checker on the gh-pages branch.
  `/tmp/dapp32-gh-pages/check_pages.py` should derive expected routes and
  continuations from `dapps/bike-nft/cam/main.json`, not from a hard-coded list.
  Acceptance: the hard-coded route list is gone, the current page passes when
  `DAPP32_REPO_ROOT` points at this checkout, and omitting a manifest route or
  changing a route continuation would fail. This was landed in the separate
  gh-pages checkout/commit, not in this main-branch commit.

- [x] Update the Makefile operator guide for current `package-ci`.
  `notes/000_makefile_operator_guide.html` should list the Makefile target's
  prerequisites, including `cam-integration-fuzz-check`. Acceptance: the
  guide's `make ci` package fact matches `Makefile`.

- [x] Clarify the TypeScript Bike NFT fixture boundary.
  `tests/fixtures/cam/bike.mts` is a happy-path test fixture, not a complete
  mirror of `BicycleComponentManagerUI` pause projection. Say that in place.
  Acceptance: no new projection logic unless an existing TS test needs paused
  state; fixture comments no longer imply full UI parity.

## Stop Points

- Do not extract ABI declaration parsing from this note. The ABI inventory says
  characterization is complete; parser/helper work needs a new production
  change that creates repeated metadata traversal.
- Do not add a protocol integrity-string helper from this note. Add one only
  while deleting at least two local `sha256:0x...` constructions in a real
  change.
- Do not move `tests/fixtures/cam/checked-resources.mts` onto protocol facts
  unless a real fixture bug appears and the provisional fact-consumer boundary
  remains intact.
- Do not add route/action/view ID generators or guards unless a concrete drift
  recurs. Current copies match.
