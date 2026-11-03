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

This invocation change must not claim to fix rootless output ownership, nor
restore UID 0 to make the lane appear green. A durable fix needs a separately
reviewed host-write/apply boundary or an engine-specific mapping strategy and
proof of an actual changed output. That is distinct from preserving the
validated Compose invocation and is not established by a no-op refresh.

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
