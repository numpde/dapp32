# Deferred

This note keeps follow-ups outside the current composable deployment delivery.
Ordinary CAM preparation/publication/recovery, full-release and update reuse,
operator documentation, and their required qualification remain in scope.

- **Fuji Bike UI release:** deploying the held read-only UI, updating its root
  binding, and publishing coherent resources still require separate authority.
  Refresh chain, owner, nonce, code, and manifest facts when that release is
  authorized; the earlier unsigned preparation is not an executable release.
- **Public PayToPlay replacement:** downstream observer/client migration remains
  a prerequisite. Check the collector/position layout and capped collection ABI.
  A replacement address changes the EIP-712 verifying contract; old vouchers
  do not transfer to it. Local workflow qualification does not close this hold.
- **Additional historical toolchains:** archived-source exports have demonstrated
  the selected Solc 0.8.35 snapshots, not every older compiler/dependency set.
  Qualify another toolchain when a real selected deployment needs it; do not add
  a standing version matrix to this delivery.
- **Internal naming:** retain the existing `expectedDeployer` and corresponding
  environment/wire keys. A broad rename is unnecessary for showing an accurate
  signer label in call-only publication flows.

No real Fuji deployment or public publication is authorized by this note.
