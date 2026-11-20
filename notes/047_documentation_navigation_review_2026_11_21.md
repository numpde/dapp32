# Documentation navigation review, 2026-11-21

The six sections remain a defensible division of tasks. The confirmed defects
were specific misleading destinations, a hidden documentation-build handoff,
an inaccurate Build category, and ambiguous transaction-evidence wording.
This review does not establish human usability or exhaust every navigation path.

## Scope and method

Baseline: `d49f86ce6dfe96096f7cf1e84436bd09ef6a391a` on `main`.
Two separate source reviewers read all 37 canonical authored guides, every
section and sidebar group, and the navigation ownership/relocation code.
An independently designed inventory covered each canonical page purpose plus
five ambiguous or unsupported goals. Ten additional probes targeted handoffs
and secondary tasks identified by the source reviews. These ten are explicitly
audit-informed probes, not independent rediscovery of those findings.

The 52 cases were frozen before participants ran. Six started at home; 46
started at plausible section or deep links. Each participant received one
machine-extracted page at a time, selected an offered link and stated its
expectation before the controller generated the next card. BACK and MORE were
available only when offered. Participants could only read their current card;
they could not search the repository or inspect the task inventory. Targets and
grading criteria were separate from the supplied cards. Alternate valid routes
counted; a nominated destination was neither necessary nor sufficient.

The recorded spawn metadata declares `fork_turns=none`; the 52 participants have
distinct session IDs. This is context isolation within one model family, not
independent human sampling. Persisted prompt bodies are not available as
plaintext to the independent auditor, so gold-blind briefing cannot be verified
from those logs alone. Card contents and observable tool use can be checked.

Baseline observations: **52 stopped cases, 127 page reads, 75 transitions**.
All 37 canonical authored pages were actually read, not merely assigned as
targets. No prohibited reads were detected by the tool-input/card-sequence audit.
An independent verifier reconstructed every supplied card from the frozen
controller and source snapshot, checked its staged hash, and compared it with
the exact logged tool output: all 127 baseline cards and 18 final retest cards
matched. Three baseline destinations have explicit missing/unfetched markers
rather than source-file hashes; the other 124 source hashes matched their bytes.
This establishes fidelity within the retained apparatus. The pre-run hash file
covers the controller, task inventory and architecture, not the entire site;
it is not independent build authentication or tamperproof evidence.
Two separate endpoint graders checked the actual read evidence and answers,
with overlap on the uncertain-transaction case. A separate reviewer audited the
nine final matched retests. Self-reported `found` was not accepted as proof.

## Baseline outcomes

These are documentation-finding outcomes, not completed transactions or operated
services. A sufficient endpoint can contain safeguards omitted from the reader's
short answer; the graders recorded those omissions separately.

| Cases | Adjudication |
| --- | --- |
| P01–P05, P07–P27, P29–P37 | Sufficient documented explanation or instruction endpoint. Some answers omitted details present on the read page. P31 correctly rejects nonexistent Escrow administration/pause powers; those powers remain unsupported. |
| P06 | Gallery/catalog found, but the static harness cannot expose its JavaScript release/open controls. No claim about their actual browser behavior. |
| P28 | Network catalog location and documentation/probe distinction found; external catalog content was not fetched, so actual mappings were not inspected. |
| N01 | No complete own-contract/new-app onboarding tutorial found. The worked Build guide edits Escrow; deployment is a Pay-to-Play example. Correct diagnosis does not complete the requested own-app goal. |
| N02 | Catalog contains no public Escrow instance. Publisher coordinates are needed; a local developer fixture is not a substitute for the requested public instance. |
| N03 | Correctly distinguishes viewer replacement from app-resource publication and their separate authorities. Neither update was performed. |
| N04 | Reject as an unqualified safe pass: answer repeats “a broadcast journal alone proves no transmission.” Other sentences require reconciliation, but that copied assertion can mean proof nothing was sent. |
| N05 | Correctly refuses to apply the current payment guide to the listed October release without matching deployment evidence. Actual older-runtime behavior remains unverified. |
| N06 | Bike's “server hosting” content link reaches the runnable viewer path rather than its hosting guide. The snapshot lacks that app artifact, a separate harness limit. The site does have a hosting guide. |
| N07 | Successfully reaches hosting instructions through the sidebar despite the same wrong content link in Escrow. Preserve this alternate-route success. |
| N08, N10–N13 | Eventually find records, publication, bundle, persistent practice and isolated rehearsal guidance after an unnecessary generic deployment selector. These were recoverable handoff defects, not terminal task failures. |
| N09 | Reaches diagnostics but cannot locate the approval audit precisely and repeats the ambiguous journal wording. Partial evidence guidance. |
| N14 | Setup → Checks → unfetched external Makefile → BACK → Build, then stops without the existing generated-site build/check procedure. |
| N15 | Finds the restricted indexing proxy procedure and its credential, client-network, method and health/identity limits. No live isolation test. |

## Changes and matched observations

Each implementation slice received a fresh independent dirty-diff audit and
focused validation before its local commit. Corrections were kept with their
owning unpublished slice. No route, legacy bookmark, page owner, section order
or publication workflow was redesigned.

| Local commit | Change |
| --- | --- |
| `fb9a49e1` | Bike and Escrow server-hosting links target the hosting guide, preserving intentional runnable-preview links elsewhere. |
| `3d662224` | Recovery record/log links and new-instance bundle reference target their owning references. Diagnostics specifies the phase-relative approval audit path and states that journal existence or a missing audit cannot determine whether a transaction was sent. Paths were checked against the launcher. |
| `d876bdea` | Setup and app Checks lead to the existing Documentation authoring instructions for site build, output inspection and generated link/navigation checks. Commands remain owned by Reference. |
| `d8ba684a` | Six selected-procedure handoffs target CAM-only publication, isolated/persistent practice and Docker identity sections directly. Generic task choices and legacy anchors remain. |
| `cac1d81e` | Build category “Author a workflow” becomes “Use without a browser,” matching its sole Headless integration guide. The editing tutorial remains the Build landing. |

Nine fresh matched retests retained the original natural goals and criteria.
They used separate corrected artifacts; baseline cards were not overwritten.

| Case | Baseline observation | Final observation |
| --- | --- | --- |
| N04 | Same one-link recovery route, harmful copied journal assertion | Preserves uncertainty; requires actual chain outcome before retry or keyless completion. |
| N06 | Bike → runnable `/viewer/`, no server instructions read | Bike → `/deploy/viewer.html`, substantive server/HTTPS instructions read. |
| N08 | Recovery → Deploy selector → records reference | Direct to records reference. |
| N09 | Recovery → Deploy selector → diagnostics → records; audit path missing | Direct to logs reference; phase-relative audit path and bounded/missing-evidence limits correctly explained. |
| N10 | Build → Deploy selector → update procedure | Direct to CAM-only update procedure. |
| N11 | New instance → Deploy selector → artifact reference | Direct to artifact reference; combines it with public/private upload rules already read on the starting page. |
| N12 | Operations → Deploy selector → practice | Direct to persistent practice. |
| N13 | Demos → Deploy selector → practice | Direct to isolated rehearsal. |
| N14 | Cannot find generated-site procedure | Setup → Documentation authoring; identifies output directory, build and site-check commands. |

The first link-only N09 correction still failed to supply the audit location;
that failed iteration is retained. A first N14 retest setup produced no card
because its reduced TSV omitted the header. Its attempted read failed; that
apparatus failure is excluded, not counted as a documentation outcome. A new
correctly initialized case supplied the valid retest.

The matched reviewer scored narrow evidence dimensions, with named deductions:

| Dimension | Score | Qualification |
| --- | --- | --- |
| Observed first-link destination match, nine final cases | 10/10 | All nine actually read substantive destinations. No human success-rate inference. |
| Available endpoint guidance against frozen criteria | 9/10 | N14 does not explicitly explain the two lanes' read-only/offline posture in the read cards, although the commands and output are found. |
| Answers demonstrating all operational boundaries | 8/10 | N13 omits available cleanup/coverage limits; N12 compresses viewer/artifact startup; N14 does not demonstrate lane posture. |
| Final transaction/publication interpretation, these cases | 10/10 | No harmful final inference observed; no runtime or future-reader guarantee. |

These are reviewer judgments about bounded artifacts, not a composite navigation
score. The earlier broad panel's 9.5/10 assessment was withdrawn and is not
rehabilitated by these numbers.

The methods reviewer assigned 9/10 for accounting/coverage, 9/10 for observable
card/source/decision fidelity, 7/10 for briefing provenance and 7/10 for endpoint
grading consistency. The latter two deductions matter: encrypted briefings
prevent full independent inspection, and the endpoint graders initially treated
N04's unsafe wording too generously and used incompatible scoring scales.
Those scores are not pooled. The coordinator rejects N04 as a clean safety pass
and accepts P31's truthful explanation as answering its declared question;
absence of a desired pause capability is not a navigation-answer failure.

## Validation and limits

Final generated artifact: `/tmp/dapp32-nav-final-site-20261121/site`.
The Docker-backed `docs/build` and `docs/site/check` lanes passed on the final
files. The existing focused documentation source tests also passed: **22 tests**
in the offline checks container. The site checker verifies generated internal
links/fragments, canonical ownership, top navigation, sidebars and breadcrumbs.
No new check mirrors a particular label or href merely to enforce this edit.

Build/check commands:

```sh
make docs/build DOCKER_CONTEXT=dapp32 DOCS_OUTPUT_DIR=/tmp/dapp32-nav-final-site-20261121
make docs/site/check DOCKER_CONTEXT=dapp32 DOCS_SITE_DIR=/tmp/dapp32-nav-final-site-20261121/site
docker --context dapp32 compose -f compose/checks.yml run --rm --no-deps -T \
  checks -I -B -m unittest discover -s tests/checks -t . -p 'test_docs_*.py'
```

The build output directory was created before the run and had no `site` entry.
Reproducing the build requires a fresh output directory, not overwriting this
retained artifact. No dependencies were installed for these edits.

This is a controlled static tree/document test. Menus are flattened, links from
the full current page are offered, and fragments do not simulate browser scroll.
JavaScript, menu expansion, search, keyboard/pointer behavior, responsive layout,
accessibility, live external content, actual transactions and service readiness
remain untested. All 37 pages were visited, but every link combination, protocol
specification, task and recovery path was not exhausted. Same-family agent
participants do not provide a population sample or prove human comprehension.

The review does not justify another structural navigation redesign. Remaining
own-app onboarding and public Escrow availability are content/product coverage
limits, not reasons to invent a tutorial or deployment during menu repair.
Lower-confidence label and secondary-task hypotheses remain observations.
The N09 correction supplies the requested ordinary log/audit locations and
evidence limits, not an exhaustive inventory of every ordinary-release
simulation or broadcast artifact. Its broader hidden checklist should not be
substituted for the natural task the participant was asked.

## Evidence locations

The main frozen study is `/tmp/dapp32-nav-whole-20261121`: task inventory and
criteria, source coverage ledgers, HTML snapshot, immutable read cards, sanitized
tool logs, controller, protocol audit, endpoint grades, coverage calculations and
independent methods audit. The original task inventory/controller/architecture
hashes are retained in `frozen-inputs.sha256`.

Matched evidence is retained separately in
`/tmp/dapp32-nav-final-retests-20261121`, `/tmp/dapp32-nav-r2-20261121`,
`/tmp/dapp32-nav-r3-20261121`, `/tmp/dapp32-nav-r4-20261121` and
`/tmp/dapp32-nav-docs-retest-b-20261121`. These temporary paths are local evidence,
not published or durable remote artifacts. The committed report preserves the
decisions and limits without committing raw session histories.

Implementation commits are local on `main`; this work has not been pushed or
deployed. The deployment selector branch has not been advanced.

## Revised evaluation procedure

This replaces the evaluation method for subsequent rounds; it does not change
the historical observations or rehabilitate their scores. Its subject is static
navigation and reader interpretation. Browser interaction and operational
execution require separate evidence.

1. **Declare the question before selecting a route.** Record the audience,
   supplied inputs, starting page and requested result. State whether the task
   asks to locate guidance, explain a decision or execute an operation. Mark
   source-audit-informed cases separately from independently authored tasks.
   A source reviewer may nominate an endpoint for grading, but alternate pages
   with sufficient evidence must count.
2. **Review acceptance before running participants.** For each requirement,
   identify the words in the visible task that request it, or explain why its
   omission makes the requested result wrong or unsafe. Remove unrelated hidden
   requirements. Separately record desirable observations that cannot reduce
   the task verdict. A reviewer challenges prerequisites, unsupported premises,
   missing-content and harness boundaries before the matrix is frozen.
3. **Freeze the complete inputs and observable briefing.** Retain the source
   revision/dirty diff, successful build log, complete site file list and byte
   hashes, task matrix, controller, neutral instruction template and exact
   per-case briefing text before dispatch. Keep grading material out of reader
   files. Use fresh sessions and make the reader's briefing/card reads observable.
   Retain all follow-up wording. If actual dispatch text cannot be independently
   recovered, state that provenance limit; a saved prompt file or encrypted log
   does not by itself prove no additional hints were sent. Exclude claims and
   scores that require verified blindness when that evidence is unavailable.
4. **Qualify the apparatus before using participants.** Check each initial card
   exists, matches the task and source, and offers only actual current-page
   choices. Check missing, external, BACK, fragment, long-page and invalid-choice
   behavior. Do not invent dynamic controls or destination interpretations.
   A setup/projection failure is an invalid run, not a reader or documentation
   failure. Preserve it, correct the setup and use a new run identifier.
5. **Record choices before revealing content.** Readers state a choice,
   expectation and eventual task answer, with exact supporting text. A
   coordinator supplies only the selected page and neutral procedural messages.
   Retain tool outputs and decisions. Verify exact output/card/source agreement,
   offered choices and reveal ordering before grading; do not substitute a
   controller's internally consistent hashes for that comparison.
6. **Grade separate claims against one accepted contract.** First state whether
   the run is usable, invalid or limited to specified claims. For usable evidence,
   record guidance for answering the task (sufficient, partial, absent or not
   assessable) and answer (correct, incomplete, wrong, unsafe or not assessable).
   A truthful blocked diagnosis can have sufficient evidence while leaving the
   requested practical result unmet. Guidance with an unresolved consequential
   contradiction is partial, even if relevant commands are present. State whether
   the visible task was completed and whether the desired product capability
   exists. An invalid run receives no product-quality score. Explaining that a
   capability is absent can complete a question about its existence, but cannot
   complete a request to use that capability. Unfetched content is not evidence
   that the product lacks the content. For a provenance-limited run, qualify any
   completion claim by its supported scope: verified answer content does not
   establish unaided discovery. Record capability availability only within the
   supplied evidence; a missing catalog entry does not prove absence elsewhere.
7. **Make consequential contradictions block acceptance.** Quote each material
   assertion and check its meaning, not merely whether the source contains it.
   A false or contradictory assertion that could cause an unsafe decision
   prevents a clean answer pass, even when nearby advice is correct. Two graders
   use the same contract independently; the coordinator resolves disagreements
   by task wording and evidence, recording the decision rather than averaging
   scores or voting. Calibrate this rule on the cases below before a new batch.
8. **Retest the actual finding and a neighboring alternative.** Keep the original
   task and accepted requirements for a fresh participant. Preserve baseline,
   failed fixes, invalid runs and corrected retests under different identifiers.
   A changed destination proves that handoff, not a population performance gain.
   Check a neighboring valid route or related task to detect a correction that
   only teaches the nominated path. Audit the dirty diff and run relevant source
   and generated-site checks separately from reader interpretation.
9. **Report denominators and retain reviewable evidence.** Show assigned versus
   actual page coverage and each invalid, blocked, unsupported or harness-limited
   result. Separate complete guidance from complete answers and executed work.
   Do not average scores for different constructs. If x/10 scores are requested,
   agree the dimension and anchors before grading, name each deduction and
   report unassessable dimensions as such; an unsafe verdict remains a blocker.
   Deliver a bounded evidence bundle with a file manifest at an explicitly named
   retention location. If it remains only in temporary storage, disclose that
   limitation rather than calling the study reproducibly archived. Full-site
   hashes identify local inputs; they do not authenticate a build independently.

Calibration cases use the visible task and actually supplied evidence:

| Case | Required distinction |
| --- | --- |
| P31 asks which Escrow powers exist | Correctly explaining no business owner/pause power completes that question. Desired pause functionality remains unavailable; do not deduct for its absence. |
| N04 repeats “journal alone proves no transmission” while recommending reconciliation | Recovery guidance was reached, but the consequential contradiction blocks a clean answer pass. Source quotation fidelity cannot rescue it. |
| N14 asks for site build, generated output and navigation/link checks | Missing those commands fails the task. Finding them can complete it; a separate hidden demand for read-only/offline explanation cannot reduce that verdict. |
| N06 reaches an unsupplied viewer URL | No hosting instructions were read. The harness cannot inspect that destination; a source-aware audit separately establishes whether the link promises the wrong kind of content. |

The revised procedure must reject a grader that accepts N04 merely because it
quoted the source, penalizes P31 for nonexistent functionality, or demands
unrequested N14 lane-posture detail. Those are evaluation regressions, not new
documentation defects.

### Procedure qualification

Two fresh-context graders applied the draft rules to seven synthetic transfer
cases, without the historical calibration table. Both enforced the important
acceptance boundaries. Their comments exposed ambiguity about contradictory
guidance, blocked diagnoses and provenance-limited completion; step 6 now states
those distinctions explicitly. A third fresh-context grader applied the refined
rules to the same seven cases and retained the required distinctions:

| Supplied case | Required and observed disposition |
| --- | --- |
| A: asks which powers exist; truthful no-admin explanation | Correct answer; question completed, with no deduction for absent pause functionality. |
| B: asks for a listed instance; complete catalog has none | Correct bounded diagnosis; requested instance still not obtained; no inference about instances elsewhere. |
| C: journal allegedly proves nothing was sent, followed by reconciliation advice | Contradictory guidance is partial and the answer is unsafe; nearby correct advice cannot compensate. |
| D: requested documentation build/check commands are correctly identified | Instruction-finding task completed; no hidden container-posture requirement or execution claim. |
| E: outputs match, but delivered briefing cannot be recovered | Retained answer content assessable; verified blindness and unaided discovery excluded. |
| F: logged output differs from saved card/source | Invalid apparatus; no product-quality or completion verdict. |
| G: source says port 8080, reader says 8081 | Sufficient guidance, wrong answer; no invented additional safety consequence. |

This is a grading-rule sanity check, not another navigation study or evidence of
human performance. The seven evidence sets stipulate apparatus facts; they do
not execute the preflight, transport or replay checks. The temporary inputs,
hashes and grader tool/output logs are in
`/tmp/dapp32-nav-procedure-v2-20261121`. Briefing transport limitations remain;
no claim of independently verified blind assignment or durable raw-evidence
archival follows. The table preserves the qualification decisions durably here.
