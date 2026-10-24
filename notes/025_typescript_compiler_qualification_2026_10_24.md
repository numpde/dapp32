# TypeScript compiler qualification

Date: 2026-10-24
Status: adopted and qualified in `ccb519f`.

## Decision and ownership

Keep the metadata type boundary introduced in `6f52c6d`. Use one shared,
exact-pinned native TypeScript compiler through the existing Docker dependency
and execution workflows. The adopted compiler is TypeScript `7.0.2`, with one
checker configured in the existing shared and web-app tsconfigs. This trades some
native parallel speed for substantially more headroom within the existing
1 GiB container limit. No compiler wrapper, second compiler, generated chain
catalog, new Compose service, or reduced declaration checking is needed.

The installed compiler and native Linux x64 package both report `7.0.2`.
The implementing agent made the changes; independent review inspected the
actual diffs, lockfile, qualification logs and remaining limitations.

## What consumed memory

The large footprint was compiler working memory for dependency declarations,
symbols, generic instantiations and type-relation caches. It was not the size
of the network metadata or browser runtime memory.

Early disposable app/test diagnostics measured approximately 349 MiB process
RSS for an empty module with the same Node/React ambient types, and 556 MiB
after adding a viem type import. The complete check reached 873 MiB; removing
the catalog for diagnosis reached 665 MiB. These are separate process runs,
not additive allocation accounting. The diagnostic replacement was never an
acceptable product change.

Narrowing the catalog namespace to the three fields used by wallet network
registration avoided carrying hundreds of rich chain-client types through
lookup inference. It retained all networks, full checking, and identical
executable JavaScript. Observed process-RSS savings varied between runs; they
must not be confused with the whole-container measurements below.

## Reproducible comparison

Use `make js/compiler/qualify` in each checkout after materializing its matching
locked dependencies. Commit `7003979` adds the entrypoint, helper and operator
instructions. It reuses the existing offline, read-only package-test service.

The fixed workload prints the actual compiler version, builds workspace
packages, then fully typechecks the web app and its tests with declaration
checking enabled. It reports elapsed workload time, outcome, container memory
limit, and kernel cgroup v2 whole-container peak. That peak includes dependency
graph verification, source staging and tmpfs; it is **not compiler-process
RSS**. Every run uses a fresh staged workspace without compiler caches. OS
page caches are not flushed. There is no CI performance threshold.

Observed on this host with the same 1 GiB limit:

| Compiler and configuration | Workload time | Whole-container peak | Result |
| --- | ---: | ---: | --- |
| TypeScript 6.0.3, final baseline | 15.69 s | 808.4 MiB | PASS |
| TypeScript 7.0.2, default checkers | 3.28 s | 751.1 MiB | PASS |
| TypeScript 7.0.2, app-only single-checker CLI probe | 4.08 s | 579.4 MiB | PASS |
| TypeScript 7.0.2, shared/app single-checker configuration | 5.04 s | 570.5 MiB | PASS |
| Adopted main checkout after normal locked installation | 5.06 s | 582.3 MiB | PASS |

These are bounded observations, not universal performance guarantees. The
adopted setup retained the 1,569-file checking scope. Its improvement
over the baseline was about 68% less workload time and 28% less container peak
memory. The CLI-only probe was diagnostic; the chosen configuration belongs
in ordinary compiler configuration, not a special measurement path.

Although this release's `--showConfig` output omitted `checkers`, the configured
run matched the explicit single-checker probe's symbol, type and instantiation
counts. Actual compilation and resource behavior established that it took
effect; accepting the configuration text alone would not establish that.

The helper has hard per-command timeout termination, preserves command
failures/signals, and fails qualification if memory evidence is unavailable.
A deliberate type error in disposable source produced compiler exit 2,
measurements, `Outcome: FAIL`, and a failing Make invocation. The temporary
source was removed. No runtime transaction or deployment was needed.

## Compatibility and verification

Source and installed declaration inspection found no current consumer of the
legacy TypeScript compiler API. Existing peer ranges admit TypeScript 7.
The exact root and Linux x64 package versions were checked against public
GitHub/OSV advisories before installation; no matching advisories were found.
That is not a blanket security guarantee.

Candidate dependencies were materialized in an isolated worktree through the
normal stage/apply installation workflow with scripts disabled. The lockfile
change selects TypeScript 7.0.2 and its exact platform optional packages.
Actual CLI execution proves the selected native package is usable; a graph
check that omits optional packages would not prove that alone.

The first native CI attempt exposed two stale Bike fixture expectations.
Both failures reproduced under TypeScript 6. Commit `604ca57` derives complete
resource/discovery expectations from declared namespaces while preserving
independent paths, values, method sequence and exact discovery arguments.
The corrected core and viewer packages passed under TypeScript 6 (40 and 182
tests respectively).

The terminal mock tests also had stale whole-screen button expectations after
navigation links were added. Their TypeScript 6 reproduction failed too. The
correction pins the seven lifecycle controls and their availability for
active, missing and retired components, without treating navigation order as
lifecycle behavior. Commit `177afe7` contains the correction; the corrected
terminal baseline passed 36 tests.

The integration-fuzz tool also rebuilt loaded snapshots without the newer
visit identity and integrity-warning fields. Its compile error reproduced
under TypeScript 6. The correction preserves the original snapshot with a
spread and narrows the required loaded fields, without revalidating the
viewer's owned values. Its regression checks preservation and incomplete
loaded-state rejection. Commit `8a0febe` contains the correction; the focused
TypeScript 6 baseline passed all 33 tests.

All constituent JS CI targets passed under the native setup across staged
runs: workspace and scenario tests, terminal viewer, publication preflight,
integration fuzz, all three release tools and refunds. The release-tool runs
passed 39, 36 and 27 tests respectively; refunds passed 18. Earlier aggregate
invocations stopped at the reproduced baseline defects above, so they are not
reported as successful complete `make js/ci` invocations. Successful targets
were not rerun merely to obtain a single green aggregate log.

The main checkout then used the normal locked install without `ALLOW_UPDATE`.
Its lockfile matched the qualified candidate byte for byte. The public Make
qualification passed on the installed native compiler, and package metadata
checks passed. The 1 GiB container limit and existing Node heap cap remain
unchanged; the Node cap is documented as applying to Node tools, not to the
native compiler. Existing viewer containers remained running with start times
from the previous day; no deployment or browser transaction was performed.

A separate existing Make-inventory parser defect was corrected in `027a878`:
ordinary multi-target rules share one recipe and must contribute every target
name. An unrelated existing forbidden-brand-text hygiene failure involving
release image identifiers was recorded during qualification; those identifiers
were not renamed as part of compiler work. Its current status belongs to the
separate hygiene work, not to the compiler's compatibility result.

Retained local qualification logs include
`baseline-final-6.0.3.log`, `negative-6.0.3.log`,
`native-default-7.0.2.log`, `native-single-checker-7.0.2.log`,
`native-config-checker-7.0.2.log`, `runtime-baseline-6.0.3.log`, and
`fixture-fixed-6.0.3.log`. Final evidence also includes
`js-ci-qualified-7.0.2.log`, `js-ci-remaining-7.0.2.log`,
`main-locked-install-7.0.2.log` and `main-qualified-7.0.2.log`.
These are temporary audit evidence, not inputs required by the supported Make
workflow; their enclosing directory was
reported with the qualification results.

## Upstream rationale

- [TypeScript performance guidance](https://github.com/microsoft/TypeScript/wiki/Performance): explicit consumer types and avoiding unnecessarily large unions.
- [TypeScript 7.0 release and concurrency controls](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/): native compiler, checker parallelism and legacy API compatibility limitations.
- [Incremental compilation](https://www.typescriptlang.org/tsconfig/incremental.html): useful for warm runs; it does not establish lower cold-workload memory.

Revisit this decision when a real workload or compatibility requirement
changes. Use the supported qualification command and normal JS checks before
adding cache infrastructure, broad project restructuring, or another compiler.
