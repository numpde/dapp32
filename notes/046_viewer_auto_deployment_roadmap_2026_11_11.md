# Viewer automatic deployment roadmap

2026-11-11. All five slices are implemented. A manual production update through
`viewer/update` succeeded, and the installed user timer has completed scheduled
unchanged-release attempts successfully. The original server checkout remains
in place. See the [operator guide](../docs/viewer/deploy.md#automatic-updates)
for the maintained interface, failure behavior and recovery commands.

## Goal and completed foundation

Advancing `deploy/viewer` authorizes a viewer release to `app.dapp32.com`.
The server should notice the change, build the selected revision, replace the
viewer, and automatically retire obsolete resources that this repo owns.
Keep the current release and one known-good rollback release. The VPS has
limited space and good networking, so prefer reacquisition over retaining
disposable material.

Completed: `deploy/viewer` exists; `base-images/pull` uses native Buildx
discovery and Docker pulls; dependency/compiler helpers clean their generated
images; final images carry viewer identity and project ownership; `viewer/update`
owns update, rollback and obsolete release retirement; systemd invokes it.
Base acquisition neither builds images nor cleans them up. There is no
dependency on the separate auto-cleanup daemon.

The following records the delivered slices and their acceptance criteria.
Failure paths have focused offline regressions; successful build, replacement,
public-revision observation, helper cleanup and scheduled no-op behavior were
also observed on the server. No failure was deliberately injected into production.

## 1. Make creating commands clean up their own obsolete resources

Inventory the resources created by the relevant dependency and viewer build
commands. Retain their existing per-run teardown of temporary containers,
networks, volumes and working directories; close demonstrated gaps at the
creating command. Stop consumers before deleting their resources.

Give repo-generated images explicit ownership where it is missing, then
automatically remove obsolete, unreferenced owned images after their consumers
finish. Protect current and rollback viewer releases, container references,
and unrelated resources. Pulling an upstream base does not confer ownership.

Use native Docker removal and BuildKit cache management. Set an aggressive
native cache budget on the VPS only after establishing that the builder's
ownership permits it. Do not run engine-wide prune on a shared engine or build
a parallel cache manager. Cleanup failures must report what remains.

Done when disposable resources and obsolete owned images are reclaimed while
current, rollback and unrelated resources survive, including failed runs.

## 2. Give the viewer image its own source identity

Stamp the final image with the full viewer source revision and clean/modified
status using the build facts already computed by `viewer_image_build.sh`.
Previously, the final image inherited nginx's revision label.

Read deployment identity from the running container's immutable image ID and
that image's metadata. Mutable tags and a saved last-deployed SHA cannot be
the authority. Automated releases must come from an unmodified revision.

Done when an inspected image identifies the same viewer revision as its
served build information, and modified builds cannot masquerade as releases.

## 3. Add `make viewer/update` as one bounded update attempt

Serialize manual and scheduled attempts with ordinary `flock`. Fetch
`deploy/viewer`, select its exact commit, and compare it with the healthy
running viewer. Return successfully without rebuilding when already current;
an unhealthy matching revision still needs recovery. Reject checkout edits.

Use the existing acquisition, locked dependency, build and runtime commands.
Adopt the documented server-build path: the VPS builds the image. This changes
the previous manual local-build and SSH image-transfer workflow.
Keep updater execution stable while changing the checkout it operates on.

Retain release identity and rollback images through Docker labels and tags.
Keep runtime settings in the service configuration; refuse automatic changes
to the runtime Compose model or bind/port settings so rollback needs no saved
configuration. Create no deployment receipts, SHA files, settings snapshots or
release directories. Start the new image with the existing settings; observe container health
and the public viewer's revision before accepting it. Replacement may briefly
interrupt service.

Preparation failure leaves the running service unchanged. Activation failure
attempts rollback with the retained inputs and reports the failed update.
Failed or uncertain rollback preserves recovery inputs and reports the actual
state. Cleanup failure must not undo a healthy release. Do not promise recovery
from every process kill or host failure; keep the retained release usable for
manual recovery. Apply cleanup and retention after the outcome is known.

Done when unchanged, successful, preparation-failure and activation-failure
paths behave as stated, with bounded execution and useful failure output.

## 4. Prepare the deployment checkout and perform one manual update

On `dapp32@agentic`, create `/home/dapp32/deploy/dapp32`. Preserve
`/home/dapp32/repos/dapp32`; do not move it. Refresh the selected rootless
Docker endpoint, installed prerequisites, proxy routing, runtime settings and
available space before making changes. Earlier host observations are dated.

Keep production's existing Compose project and bind address unless a concrete
routing change requires otherwise. Inspect branch permissions and document
who may advance `deploy/viewer`; its existence does not establish protection
or CI qualification. Publish the reviewed implementation and promote the
intended release deliberately.

Done when a manual `viewer/update` serves the intended public revision, its
rollback inputs are usable, and obsolete owned material has been reclaimed.

## 5. Install the thin systemd user service and timer

Have the service invoke the same Make target from the deployment checkout.
Poll one minute after each completed attempt. Bound execution, keep logs
bounded, and verify user lingering so the timer survives logout. The shared
lock also covers manual invocations.

A failed attempt is visible in systemd/journal and is retried on the next
activation. Stop the timer before an operator rollback, or it will reapply the
branch. Document status, logs, stop/start and recovery commands.

Done when one timer-triggered attempt succeeds and its public revision and
cleanup outcome are observed. This roadmap does not change contracts, CAM
deployments, documentation publishing, or the paused architecture refactors.
