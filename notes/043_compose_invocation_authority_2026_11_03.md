# Compose invocation authority workshop — 2026-11-03

## Problem and scope

`COMPOSE_ENV` and related Make variables expand to shell assignments before
Docker Compose. GNU Make accepts command-line overrides for them. The lane
guard checks the exported `LOCAL_UID`, `LOCAL_GID`, and project names, but a
later assignment in one of these strings can give Compose different values.
For example, `COMPOSE_ENV='LOCAL_UID=0 LOCAL_GID=0 ...'` can make the
integrity-refresh container run as root even when the guard saw nonzero IDs.
This happened in this session. Rootless engine mapping and dropped capabilities
limit consequences but do not make the validated identity effective.

The requested change is to remove redundant base forwarding and make lane
identity and per-invocation project/configuration choices explicit, while
preserving operator inputs, engine selection, Compose interpolation and the
exact same project for startup, status, and cleanup. This is a Make/Compose
invocation boundary, not a redesign of container permissions or lifecycle.

## Inventory and initial decisions

- The base UID, GID, and project are already exported by Make. Their repeated
  assignments in `COMPOSE_ENV` are not needed for ordinary invocations.
- Derived environments also choose distinct dependency, ABI, RPC, Anvil,
  terminal, local scenario, and browser project names, as well as profiles,
  URLs, broadcast paths, and fixture settings. Their effects cannot simply be
  deleted. Disposable cleanup must address the same selected project as start.
- `COMPOSE_ENV` and derived assignment bundles are internal implementation
  details, not operator inputs. Command-line and environment attempts to
  replace them must not alter the guarded command.
- `ALLOW_UPDATE=0` for the live dependency egress check is a lane policy,
  while normal dependency lanes honor the validated operator selector.
- The selected Docker context and its endpoint guard remain authoritative.
  Preserve least-privilege container configuration and make no claims about
  live state solely from source inspection.

## Proof obligations

1. The IDs and project actually received by Compose match the values validated
   for the lane. Internal assignment-bundle overrides cannot bypass guards.
2. Lane-specific project names, profiles, URLs, secrets handling, and cleanup
   retain their meaning. Non-default project names remain supported.
3. Check actual generated invocation or rendered Compose configuration for
   ordinary, dependency, ABI, and lifecycle lanes, and test hostile internal
   overrides without starting or deleting services. Run the narrow repository
   checks and a representative normal Docker-backed lane.

## Open design questions

Can the base forwarding be removed without changing exported values in nested
Make and cleanup? Which lane-specific assignment bundles can be replaced by
protected, explicit inputs without spreading shell interpolation or changing
Compose's project-name interpolation? What proof covers all bundle owners
without merely checking that a particular spelling appears in the Makefile?

## Review iteration: scoped revision

Independent inventories confirm that the base assignments can be removed;
Make already exports all three inputs. The lane-specific bundles do carry
real process-scoped values. Broad target-specific exports would flow into
prerequisites and recursive Make and are not an equivalent replacement.
Compose project flags also need not be equivalent to its interpolation
context, so a mechanical conversion to `-p` is not justified.

Use a small first revision: delete the base bundle and its direct expansions;
retain lane-specific assignments at their existing process boundaries, but
make each internal bundle a protected Make definition. Keep public project and
identity inputs unchanged. This removes the observed escape without replacing
lane configuration with a generic wrapper. The Pay-to-Play fixture's export
to a child script, Anvil profiles, live-check locked mode, and the matching
start/cleanup project are explicit acceptance cases.

The test plan must observe a fake Docker delegate called by the actual Make
recipe. The existing RPC indexer fixture provides a non-destructive model.
Probe ordinary and specialized lanes with command-line and environment
attempts to override internal bundles; compare the identity and project seen by
the delegate with the guarded inputs. Exercise distinct lane values and cleanup
separately. An isolated representative real lane is additional evidence, not
a substitute for those negative cases.

The initial review also found that the composite lane guard is itself an
ordinary Make variable. Its override behavior and the existing tests that
intentionally replace it require separate adjudication before claiming the
guard is protected against all Make command-line manipulation.

## Review iteration: guard and derived names

The initial invariant was too broad for bundle protection alone. Normal Make
command-line assignments can replace `LANE_GUARD`, its component guards, and
`ACTUAL_UID`; internal dependency and ABI project names are also overridable
and are not in the public project-name guard list. The latter are intended
functions of the public project name, not independent operator selectors.
Protect the internal guard definitions, the project-name inventory and its
later additions, actual process identity, and those derived names. Preserve
public lane project selectors. This protects against unsupported normal Make
variable overrides, not against a caller supplying a different Makefile.

Some release tests intentionally substitute the guard in controlled fixtures.
A later test-only Makefile can explicitly override the guard for such tests;
production invocation tests must use the real guard. Audit the actual tests
before selecting that adaptation. The fake Docker delegate should prove both
a real accepted command and fail-before-delegate for invalid public identity,
including attempts to poison internal variables. Preserve Compose's existing
interpolation environment in cleanup as well as its explicit project argument.

## Review iteration: Make expansion precedes shell validation

A read-only fake-engine probe showed that a command-line value such as a Make
function in `LOCAL_UID` is evaluated while the recipe is expanded, before the
shell guard. Merely protecting the bundles and then validating in the shell is
therefore insufficient for externally supplied identity or project values.
The implementation must reject Make expression syntax in those external inputs
before their first expansion, preserving repository-owned defaults and normal
recursive Make. Tests must establish that the attempted expression itself does
not execute, not merely that Compose was not called.

## Implementation review: rootless output ownership

The scoped ordinary integrity-refresh command completed with zero manifests
changed. That does not prove write access. A separate `test -w` inside the
same Compose service, with container UID/GID 1000 and the current rootless
engine, failed for the caller-owned Bike manifest. The previous UID 0 override
therefore masked a real engine/user-namespace mapping problem on a refresh
that needs to write. No actual output was modified during that probe.

The invocation change did not fix rootless output ownership. A durable fix
needs a separately reviewed host-write/apply boundary or an engine-specific
mapping strategy and proof of an actual changed output. That is distinct from
preserving the validated Compose invocation and is not established by a no-op
refresh.

## Implementation review: literal lane URLs and scope

The lane URI and GUI origin assignments previously inserted Make-expanded
values unquoted. A valid query containing `&` could therefore be interpreted
by the shell instead of passed to Compose. Use the already-exported shell
values in quoted assignments; the fake-Compose test exercises an actual URL
with a query and confirms the exact project and URI received.

The override protection covers the environment bundles, project/identity
inventory, and guards in this change. It is not a general sandbox against every
Make command-line variable: separate internal Compose-file group selectors
remain overridable, including an intentional recovery-lane reuse. Protecting
those groups requires its own lifecycle review; do not infer that the current
change closes arbitrary caller-controlled Compose configuration overrides.

A later changed-output probe used a disposable copy with the ordinary
caller-owned file modes and a deliberately stale Bike UI digest. The supported
non-root refresh failed with `PermissionError` opening the scratch Bike
manifest. This establishes the changed-output failure for this engine, not
just a predicted permission issue; the working checkout was not modified.

Review also identified overridable Compose-file groups as a distinct boundary.
The recovery lane intentionally passes an overlay through one such group, so
protecting them wholesale would change supported behavior. This revision does
not claim to harden arbitrary Compose-file overrides.

## Rootless refresh follow-up: candidate and constraint

Independent reviews confirmed that both `cam/integrity/refresh` and the final
integrity step of `cam/abi/export` call the same direct-write Compose service.
A plausible non-root replacement stages CAM resources in container-local tmpfs,
validates all dapps, exports only six explicitly admitted output files to a
private host stage, then applies those files as the caller. Generator failure
must leave checkout outputs unchanged. A fourth CAM manifest must fail closed;
staged source drift must be detected before apply; apply failures must report
which outputs may have changed because six files are not one atomic operation.

This is a change to the current repository instruction that integrity refresh
may rewrite only the explicitly pre-existing writable bind mounts. Host-side
apply would preserve the exact output set but change who performs the writes
and bypass those bind mounts. It must not be presented as the same authority
boundary. Host Python or Node also cannot be assumed; archive or stream output
must be bounded and validated without allowing container-controlled paths.

The independent ABI export plan and ABI output directories have the same
rootless UID-mapping issue before this integrity step. This candidate would not
make `cam/abi/export` succeed on this engine; that earlier phase needs its own
bounded design and proof.

## Rootless refresh: two concrete resolution paths

1. **Host-owned apply.** The offline container stays at the validated non-root
   UID/GID, reads the checkout, generates into private tmpfs, and exports a
   bounded fixed-order set of six files. The host validates the complete output
   and applies only the six pre-existing paths. This changes the rule that
   refresh writes occur through explicit output bind mounts. All inputs—not
   only outputs—must be checked for drift before apply. Apply must preserve
   existing inode semantics for consumers with individual file binds, or
   deliberately change that contract; six files cannot be updated atomically
   as one unit. No host Python or Node may be assumed.
2. **Rootless namespace UID 0 for this service.** Detect the selected engine's
   rootless posture and deliberately run the integrity process as 0:0 only in
   that case; retain its offline network, read-only root, dropped capabilities,
   no-new-privileges, and six exact writable file binds. The daemon owner maps
   to namespace UID 0 in the tested rootless engine. This preserves the bind
   boundary but is an explicit exception to using the validated UID/GID as the
   container identity. A rootful or indeterminate engine must never take this
   exception. `js/deps/install` already makes this distinction for its apply
   stage, but that precedent alone does not prove suitability here.

Neither option resolves the earlier plan-directory and ABI-directory writes in
`cam/abi/export`. For either choice, the acceptance test is a disposable
caller-owned checkout with deliberately stale UI digest, an actual changed
refresh, verified output ownership and exact hashes, followed by an idempotent
rerun and a rootful/indeterminate-engine selection test where applicable.

## Resolution selected after review

Retain the prescribed six writable bind mounts and select namespace UID 0 only
when the selected Docker engine reports rootless mode. This follows the
repository's existing dependency-apply precedent, while making the exception
explicit: the Make caller remains non-root, but the integrity container is
namespace root. Before any refresh writes, the generator verifies that every
discovered manifest and protocol output is owned and writable by that mapped
identity. Engine-info failure or an empty result is not a rootless fallback.
The service remains offline, capability-free, and under no-new-privileges.

The ABI export plan and output phase required the separate change below.

Further audit tightened the exception: a rootless refresh rejects requested
UID/GID values different from the invoking user and group. The host checks
that all six approved outputs are owned by the invoking user; inside the
namespace, the generator checks ownership, write access, and single-link
regular files for all discovered outputs before it writes. Engine inspection
is time- and output-bounded. The integrity Compose file selection is protected
from ordinary Make overrides because the namespace-root exception depends on
its exact mounts and capability posture.

## Rootless refresh: verification and limits

On the selected rootless engine, a disposable caller-owned checkout with a
stale Bike UI digest refreshed one manifest. Its resulting digest matched the
exact UI bytes and the output remained caller-owned; a second run refreshed
zero manifests. A further disposable test added an unapproved fourth CAM app
and made an existing digest stale: the preflight rejected the fourth app's
read-only output before the existing manifest changed. No working-tree output
was changed by those probes.

The engine security-option probe is time- and size-bounded and rejects NULs
and malformed entries before selecting namespace UID 0. A fake-engine test
covers rootless, rootful, unavailable, empty, oversized and malformed responses, mismatched
requested IDs, and attempts to override the fixed Compose selection or output
guard. The host- and container-side ownership checks are preflights, not a
claim of race-free protection against concurrent path replacement. Refresh
still writes files in place and a later failure can leave earlier changes.

## ABI export and remaining caveats: comparison and next slice

The ABI export plan directory and the ABI output directories are also
caller-owned host binds. On the tested rootless engine, their configured nonzero container IDs map to
subordinate host IDs, so the planner cannot write its 0700 plan directory and
Forge cannot update the ABI directories. The relevant
boundary is both offline ABI services plus their existing plan and ABI binds;
the later integrity step alone is insufficient.

Nearby repositories confirm that rootless mode is not itself proof of a
particular UID/GID mapping. `nmrnet-repro` checks the exact probe process's
namespace maps; `container-tools` similarly reads the selected process's maps.
Those probes establish explicit process, namespace, and retirement boundaries;
adopting them here would add probe lifecycle and host-namespace requirements.
Here, preserve the existing explicit bind boundary and verify
caller ownership on the host and effective ownership/writability inside the
selected rootless containers before writes. Rootful selection must retain the
configured IDs; failures to establish the mapping must not fall back to root.

For multiple outputs, nearby `magnet-deploy` uses staged atomic replacement of
a single lock file; `nmrpeak-repro` also exercises atomic replacement of an
individual test-state file. That is not a transaction across several
files. In this repository individual file bind mounts can retain the old inode
after rename, so an atomic-rename claim cannot simply be imported. The integrity generator now plans every discovered manifest before the first
write, so a later validation failure leaves earlier outputs untouched. It
preserves file inodes and reports completed and potentially partial outputs on
write failure. Planning retains changed output bytes for all apps, so it does
not establish a bounded aggregate-memory guarantee. It cannot guarantee
crash-atomic multi-file changes or prevent a non-cooperating same-user process
from racing a preflight.

## ABI export: verification and limits

Both offline ABI stages now select the engine identity before running. The
private 0700 plan directory must be accessible to that identity; nondefault
requested IDs are rejected explicitly. On rootless engines, host ownership and
container ownership and writability are checked before any ABI output is
cleared. All planned output directories must be admitted by the existing
explicit writable mounts. The identity choice is shared with integrity refresh.

On the selected rootless engine, an isolated checkout exported all three apps
and refreshed a deliberately stale manifest; generated ABI files remained
caller-owned. Adding a fourth app caused the output preflight to fail, with
all eight approved ABI files unchanged. Fake-engine tests cover identity
selection and failure paths; an actual rootful engine was not exercised.
These preflights do not prevent concurrent path replacement. ABI application
still clears and replaces outputs sequentially, so interruption or a write
failure can leave a partial export. The isolated export also produced Bike NFT
ABIs substantially different from the checked-in files; that pre-existing
generated-resource discrepancy requires separate investigation.
