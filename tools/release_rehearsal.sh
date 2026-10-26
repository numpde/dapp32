#!/usr/bin/env bash
# Rehearse the normal release commands; only infrastructure and handoff actions are fixture-owned.
set -euo pipefail
unset MAKEFLAGS MAKEOVERRIDES MFLAGS GNUMAKEFLAGS MAKEFILES
unset UI_CONFIG CAM_CONFIG CONTRACT_ARTIFACT UI_ARTIFACT ROOT ROOT_ARTIFACT CAM_BUNDLE OUTPUT_DIR
app="${1:?Pass a supported app}"
action="${3:?Pass release, waits, ipc-waits, approval-pty, or approval-success}"
if [[ "$action" != release && "$action" != waits && "$action" != ipc-waits && "$action" != approval-pty && "$action" != approval-success ]]; then
  printf '%s\n' 'Release rehearsal action must be release, waits, ipc-waits, approval-pty, or approval-success.' >&2; exit 2
fi
if [[ ( "$action" == waits || "$action" == ipc-waits ) && "$app" != escrow ]]; then
  printf '%s\n' 'The shared release-client wait qualification uses Escrow.' >&2; exit 2
fi
if [[ "${2:?Pass the Compose command}" != "docker compose" ]]; then
  printf '%s\n' 'Release rehearsals require Docker Compose.' >&2
  exit 2
fi
# This entrypoint owns the documented normal-mode choice. Downstream tools
# require its explicit selection; an explicitly empty input is invalid.
if [[ -v RELEASE_APPROVAL_SIMULATION ]]; then
  simulation="$RELEASE_APPROVAL_SIMULATION"
else
  simulation=normal
  printf '%s\n' 'No simulation mode selected; using normal simulation.' >&2
fi
if [[ "$simulation" != normal && "$simulation" != skip ]]; then
  printf '%s\n' 'RELEASE_APPROVAL_SIMULATION must be normal or skip.' >&2; exit 2
fi
if [[ "$simulation" == skip && ( "$action" != approval-pty || "$app" != escrow ) ]]; then
  printf '%s\n' 'Simulation skipping is an explicit Escrow approval-pty diagnostic only.' >&2; exit 2
fi
export RELEASE_APPROVAL_SIMULATION="$simulation"
case "$app" in
  bike-nft|escrow|pay-to-play) ;;
  *) printf 'No release rehearsal is defined for %s\n' "$app" >&2; exit 2 ;;
esac
umask 077
export DAPP="$app"
export RELEASE_REHEARSAL=1
source "$(dirname "${BASH_SOURCE[0]}")/release_process.sh"
release_process_init
release_process_report "Starting $app rehearsal ($action); simulation=$simulation"
# Internal absence until allocation; export only the allocated fixture path.
declare RELEASE_REHEARSAL_DIR=""
infrastructure_started=0
planner_started=0

cleanup() {
  local status=$? cleanup_failed=0
  set +e
  # The PTY driver owns its signer and must finish before fixture teardown.
  # Ignore repeated signals before emitting any potentially blocking progress.
  if ! release_process_cleanup_begin; then
    printf '%s\n' 'Rehearsal launch command did not shut down cleanly; retaining its mounted inputs.' >&2
    status=1
    cleanup_failed=1
  fi
  release_process_report 'Cleaning up this rehearsal; repeated cancellation will not interrupt teardown'
  # A child exit 2 can mean its signer teardown failed; retain mounted inputs
  # even when this shell is exiting because of a signal instead.
  if [[ "$release_process_child_status" == 2 || ( "$action" != release && "$status" == 2 ) ]]; then
    cleanup_failed=1
  fi
  release_progress_phase='removing rehearsal containers and networks'
  if [[ "$planner_started" == 1 ]] && ! release_run_owned 60 bash tools/compose_cleanup.sh "$project-planner" --rmi local -- "${planner_compose[@]}" >"$RELEASE_REHEARSAL_DIR/planner-cleanup.log" 2>&1; then
    printf 'Planner test teardown failed; inspect %s/planner-cleanup.log\n' "$RELEASE_REHEARSAL_DIR" >&2
    if (( status == 0 )); then status=1; fi
    cleanup_failed=1
  fi
  if [[ "$infrastructure_started" == 1 ]] && ! release_run_owned 60 bash tools/compose_cleanup.sh "$project" --rmi local -- "${compose[@]}" >"$RELEASE_REHEARSAL_DIR/cleanup.log" 2>&1; then
    printf 'Rehearsal teardown failed; inspect %s/cleanup.log\n' "$RELEASE_REHEARSAL_DIR" >&2
    if (( status == 0 )); then status=1; fi
    cleanup_failed=1
  fi
  if [[ -n "$RELEASE_REHEARSAL_DIR" ]]; then
    # Snapshot scratch files are never mounted. Keep source and logs as evidence.
    if ! rm -f -- "$RELEASE_REHEARSAL_DIR/source.tar" "$RELEASE_REHEARSAL_DIR/candidate.tar" "$RELEASE_REHEARSAL_DIR/source-files" "$RELEASE_REHEARSAL_DIR/existing-files"; then
      printf '%s\n' 'Could not remove rehearsal snapshot scratch files.' >&2
      status=1
      cleanup_failed=1
    fi
    if [[ "$cleanup_failed" == 0 && -d "$RELEASE_REHEARSAL_DIR/source" ]]; then
      if ! rm -rf -- "$RELEASE_REHEARSAL_DIR/source/dapps/dependencies" "$RELEASE_REHEARSAL_DIR/source/js/node_modules"; then
        printf '%s\n' 'Could not remove rehearsal dependency copies.' >&2
        status=1
        cleanup_failed=1
      fi
    fi
    if [[ "$cleanup_failed" != 0 ]]; then
      printf 'Mounted rehearsal inputs retained at %s/source.\n' "$RELEASE_REHEARSAL_DIR" >&2
    else
      release_process_report 'Rehearsal resources removed; audit records and logs retained'
    fi
    printf 'Release rehearsal records: %s\n' "$RELEASE_REHEARSAL_DIR"
  fi
  exit "$status"
}
trap cleanup EXIT

repository="$(pwd -P)"
if [[ "$action" == approval-pty || "$action" == approval-success || ( "$action" == release && -v RELEASE_APPROVAL_IMAGE_OUTPUT_DIR ) ]]; then
  build_dir="${RELEASE_APPROVAL_IMAGE_OUTPUT_DIR:?Set RELEASE_APPROVAL_IMAGE_OUTPUT_DIR to the existing approval-image build directory.}"
  if [[ "$build_dir" != /* || ! -d "$build_dir" || "$(cd -- "$build_dir" && pwd -P)" != "$build_dir" ]]; then
    printf '%s\n' 'Approval rehearsal needs an existing normalized absolute directory without symlink components.' >&2
    exit 2
  fi
  case "$build_dir" in
    "$repository"|"$repository"/*)
      printf '%s\n' 'The approval-image build directory must be outside the repository.' >&2; exit 2 ;;
  esac
  rehearsal_parent="$build_dir/rehearsals"
  if [[ -L "$rehearsal_parent" || ( -e "$rehearsal_parent" && ! -d "$rehearsal_parent" ) ]]; then
    printf '%s\n' 'Approval rehearsal output: rehearsals must be a directory without a symlink.' >&2
    exit 2
  fi
  mkdir -p --mode=0700 -- "$rehearsal_parent"
  checkout_commit="$(git rev-parse HEAD)"
  if [[ ! "$checkout_commit" =~ ^[0-9a-f]{40}$ ]]; then
    printf '%s\n' 'Cannot name the approval rehearsal: Git did not return a full checkout commit hash.' >&2
    exit 2
  fi
  stamp="$(python3 -c 'from datetime import datetime, timezone; print(datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ"))')"
  records_dir="$rehearsal_parent/$stamp-${checkout_commit:0:8}"
  mkdir --mode=0700 -- "$records_dir"
  RELEASE_REHEARSAL_DIR="$records_dir"
else
  RELEASE_REHEARSAL_DIR="$(mktemp -d "/tmp/cam-release-rehearsal-${LOCAL_UID:?missing_LOCAL_UID}-XXXXXXXX")"
fi
export RELEASE_REHEARSAL_DIR
release_process_report "Logs and diagnostics: $RELEASE_REHEARSAL_DIR (retained after cleanup)"
printf '%s\n' "$simulation" >"$RELEASE_REHEARSAL_DIR/simulation-mode"
digest="$(printf '%s' "$RELEASE_REHEARSAL_DIR" | sha256sum)"
project="cam-rehearsal-${digest:0:24}"
export RELEASE_REHEARSAL_NETWORK="$project-rehearsal"
compose=(docker compose --project-name "$project" -f compose/release/rehearsal.yml)
planner_compose=(docker compose --project-name "$project-planner" -f compose/release/deploy.yml -f compose/release/artifact.yml -f compose/release/contracts-artifact.yml -f compose/release/contracts.yml -f compose/release/rehearsal-deploy.yml)
unset PRIVATE_KEY RPC_URL RPC_CHAIN RPC_SERVICE RPC_API_KEY_FILE
git_environment="$(git rev-parse --local-env-vars)"
while IFS= read -r name; do unset "$name"; done <<<"$git_environment"
unset GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
mkdir --mode=0700 "$RELEASE_REHEARSAL_DIR/source" "$RELEASE_REHEARSAL_DIR/control"
release_process_report 'Snapshotting candidate source without modifying the checkout'
release_progress_phase='snapshotting candidate source'
# Copy candidate source without touching the caller's index, hooks, or history.
release_run_owned 15 git ls-files --cached --others --exclude-standard -z >"$RELEASE_REHEARSAL_DIR/source-files"
while IFS= read -r -d '' path; do
  if [[ -e "$path" || -L "$path" ]]; then printf '%s\0' "$path"; fi
done <"$RELEASE_REHEARSAL_DIR/source-files" >"$RELEASE_REHEARSAL_DIR/existing-files"
release_run_owned 15 tar --create --null --verbatim-files-from --no-recursion --files-from "$RELEASE_REHEARSAL_DIR/existing-files" --file "$RELEASE_REHEARSAL_DIR/source.tar"
release_run_owned 15 tar --extract --file "$RELEASE_REHEARSAL_DIR/source.tar" --directory "$RELEASE_REHEARSAL_DIR/source"
rm "$RELEASE_REHEARSAL_DIR/source.tar" "$RELEASE_REHEARSAL_DIR/source-files" "$RELEASE_REHEARSAL_DIR/existing-files"
cd "$RELEASE_REHEARSAL_DIR/source"
if [[ "$simulation" == skip ]]; then
  release_process_report 'DIAGNOSTIC ONLY: modifying the private snapshot to skip transaction replay'
  release_run_owned 15 python3 tests/fixtures/release-rehearsal/prepare_simulation.py
fi
git init --quiet --template=
git add --all
git -c user.name='Release rehearsal' -c user.email='release-rehearsal@example.invalid' -c core.hooksPath=/dev/null -c commit.gpgsign=false commit --quiet -m 'Snapshot release rehearsal candidate'
# Serve the same Git-exported bytes and modes that the release commands consume.
release_run_owned 15 git archive --format=tar --output="$RELEASE_REHEARSAL_DIR/candidate.tar" HEAD
release_run_owned 15 tar --extract --same-permissions --file "$RELEASE_REHEARSAL_DIR/candidate.tar" --directory "$RELEASE_REHEARSAL_DIR/source"
rm "$RELEASE_REHEARSAL_DIR/candidate.tar"
release_process_report 'Copying installed locked Solidity and JavaScript dependencies'
release_progress_phase='copying installed locked dependencies'
release_run_owned 15 cp -a -- "$repository/dapps/dependencies" dapps/dependencies
release_run_owned 15 cp -a -- "$repository/js/node_modules" js/node_modules
git rev-parse HEAD >"$RELEASE_REHEARSAL_DIR/source-commit"
declare -g release_progress_phase=""

run_logged() {
  local log="$1"
  shift
  local grace=15
  local release_progress_phase="$log"
  if [[ "$1" == make || "$log" == approval-image-build.log ]]; then grace="$release_make_cleanup_grace"; fi
  release_process_report "Starting $log; private output: $RELEASE_REHEARSAL_DIR/$log"
  if ! release_run_owned "$grace" timeout --foreground --kill-after="${grace}s" 900 "$@" >"$RELEASE_REHEARSAL_DIR/$log" 2>&1; then
    tail -n 60 "$RELEASE_REHEARSAL_DIR/$log" >&2
    printf 'Rehearsal step failed; full log: %s/%s\n' "$RELEASE_REHEARSAL_DIR" "$log" >&2
    return 1
  fi
  release_process_report "Completed $log"
}

verify_handoffs() {
  # Artifact completion proves the recorded operation, including pending nominations.
  run_logged pending-verification.log make "$app/release/verify" "CONFIG=$RELEASE_REHEARSAL_DIR/artifact-recovery.json"
  run_logged handoffs.log "${compose[@]}" run --build --rm --no-deps -T rehearsal-accept
  run_logged verification.log make "$app/release/verify" "CONFIG=$RELEASE_REHEARSAL_DIR/artifact-recovery.json"
  printf 'Release rehearsal passed: %s\n' "$app"
}

rehearse_success() {
  REHEARSAL_PUBLICATION_STAGE=components release_run_owned 330 timeout --foreground --kill-after=330s 900 \
    python3 tools/release_approval_pty_check.py "$app" success
  run_logged host-selection.log "${compose[@]}" run --build --rm --no-deps -T -e REHEARSAL_ACTION=host rehearsal-prepare
  run_logged host-bundle.log "${compose[@]}" -f "$RELEASE_REHEARSAL_DIR/control/cam-host.json" \
    up --no-deps --force-recreate --wait --wait-timeout 30 release-cam
  REHEARSAL_PUBLICATION_STAGE=cam release_run_owned 330 timeout --foreground --kill-after=330s 900 \
    python3 tools/release_approval_pty_check.py "$app" success
  # Preserve component commitments; recover the last phase from its retained plan and receipts.
  for phase in contracts ui cam; do
    case "$phase" in contracts) artifact=contract-deployment ;; ui) artifact=ui-deployment ;; cam) artifact=cam-publication ;; esac
    if [[ "$phase" == cam ]]; then
      mv -- "$RELEASE_REHEARSAL_DIR/deployment/$phase/artifact/$artifact.json" \
        "$RELEASE_REHEARSAL_DIR/deployment/$phase/artifact/$artifact-before-recovery.json"
    else
      cp -a -- "$RELEASE_REHEARSAL_DIR/deployment/$phase/artifact/$artifact.json" \
        "$RELEASE_REHEARSAL_DIR/deployment/$phase/artifact/$artifact-before-recovery.json"
    fi
  done
  python3 -I -B -c '
import json, os, pathlib, sys
root = pathlib.Path(os.environ["RELEASE_REHEARSAL_DIR"])
config = {"schemaVersion": 3, "app": sys.argv[1], "sourceCommit": sys.argv[2],
          "rpcUrl": "http://release-anvil:8545", "localNetwork": os.environ["RELEASE_REHEARSAL_NETWORK"],
          "settings": {"EXPECTED_CHAIN_ID": "31338", "OUTPUT_DIR": str(root / "deployment")}}
(root / "artifact-recovery.json").write_text(json.dumps(config) + "\n")
' "$app" "$(git rev-parse HEAD)"
  run_logged artifact-completion.log make "$app/release/verify" \
    "CONFIG=$RELEASE_REHEARSAL_DIR/artifact-recovery.json" DEPLOYER_PRIVATE_KEY_FILE= PRIVATE_KEY=
  for phase in contracts ui cam; do
    case "$phase" in contracts) artifact=contract-deployment ;; ui) artifact=ui-deployment ;; cam) artifact=cam-publication ;; esac
    cmp -- "$RELEASE_REHEARSAL_DIR/deployment/$phase/artifact/$artifact-before-recovery.json" \
      "$RELEASE_REHEARSAL_DIR/deployment/$phase/artifact/$artifact.json"
  done
  verify_handoffs
}

infrastructure_started=1
run_logged infrastructure.log "${compose[@]}" up --build --wait --wait-timeout 90 release-anvil release-cam
run_logged prepare.log "${compose[@]}" run --build --rm --no-deps -T rehearsal-prepare
# This file is emitted by the checked-in fixture client into our private output directory.
set -a
source "$RELEASE_REHEARSAL_DIR/control/inputs.env"
set +a

prefix="${app^^}"
prefix="${prefix//-/_}"
export "${prefix}_RELEASE_SOURCE_COMMIT=$(git rev-parse HEAD)"
if [[ "$action" == waits || "$action" == ipc-waits ]]; then
  bash tools/release_waits.sh "$project" "$action"
  exit "$?"
fi
if [[ ! -v RELEASE_APPROVAL_IMAGE || -z "$RELEASE_APPROVAL_IMAGE" ]]; then
  release_process_report 'Building the fixture approval image from the private candidate commit'
  run_logged approval-image-build.log bash -c \
    'source tools/release_approval_images.sh; release_approval_build_image "$@"' bash \
    "$(git rev-parse HEAD)" "$RELEASE_REHEARSAL_DIR/approval-image"
  RELEASE_APPROVAL_IMAGE="$(python3 -I -B -c \
    'import json, sys; print(json.load(open(sys.argv[1]))["imageId"])' \
    "$RELEASE_REHEARSAL_DIR/approval-image/approval-image.json")"
  export RELEASE_APPROVAL_IMAGE
fi
run_logged configure.log "${compose[@]}" run --build --rm --no-deps -T \
  -e REHEARSAL_ACTION=configure -e "REHEARSAL_SOURCE_COMMIT=$(git rev-parse HEAD)" \
  -e "RELEASE_APPROVAL_IMAGE=$RELEASE_APPROVAL_IMAGE" -e "RELEASE_REHEARSAL_NETWORK=$RELEASE_REHEARSAL_NETWORK" rehearsal-prepare
if [[ "$action" == approval-pty ]]; then
  release_process_report 'Infrastructure and inputs ready; starting the automatic rejection check'
  release_run_owned 330 python3 tools/release_approval_pty_check.py "$app" reject
  exit "$?"
fi
if [[ "$action" == approval-success ]]; then
  release_process_report 'Infrastructure and inputs ready; starting the automatic fixture approval check'
  rehearse_success
  exit 0
fi

# Exercise the maintained planner service without starting its networked dependants.
export RELEASE_SOURCE_DIR="$RELEASE_REHEARSAL_DIR/source"
export RELEASE_OUTPUT_DIR="$RELEASE_REHEARSAL_DIR/planner-check"
export CONTRACT_RELEASE_CANDIDATE_DIR="$RELEASE_OUTPUT_DIR/candidate"
mkdir --mode=0700 "$RELEASE_OUTPUT_DIR" "$RELEASE_OUTPUT_DIR/plan" "$RELEASE_OUTPUT_DIR/broadcast" "$RELEASE_OUTPUT_DIR/artifact" "$CONTRACT_RELEASE_CANDIDATE_DIR"
planner_started=1
mkdir --mode=0700 -- "$RELEASE_REHEARSAL_DIR/control/planner-config"
RELEASE_CONFIG_STAGE_DIR="$RELEASE_REHEARSAL_DIR/control/planner-config" \
  RELEASE_CONFIG_FILE="$RELEASE_REHEARSAL_DIR/control/release.json" RELEASE_LOCAL_NETWORK="$RELEASE_REHEARSAL_NETWORK" \
  run_logged planner-config.log docker compose --project-name "$project-planner" -f compose/release/config.yml run --rm --no-deps -T release-config \
  contracts-deploy "$app" "$(git rev-parse HEAD)"
mapfile -d '' -t planner_inputs < "$RELEASE_REHEARSAL_DIR/control/planner-config/inputs"
export "${planner_inputs[@]}"
anvil_id="$("${compose[@]}" ps --quiet release-anvil)"
if [[ ! "$anvil_id" =~ ^[0-9a-f]{64}$ ]]; then printf '%s\n' 'Cannot identify the fixture node.' >&2; exit 1; fi
anvil_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$anvil_id")"
run_logged planner-boundaries.log "${planner_compose[@]}" run --build --rm --no-deps -T release-plan \
  timeout --signal=TERM --kill-after=10s 300s run-js-workspace node --experimental-strip-types tools/release-rehearsal/planner-check.ts "$app" "$anvil_ip"

# Malformed business settings fail inside the ordinary offline planner before a plan is published.
if release_run_owned 15 timeout --foreground --kill-after=10s 360 "${planner_compose[@]}" run --build --rm --no-deps -T \
    -e CONTRACT_RELEASE_SETTINGS_JSON='[]' release-plan >"$RELEASE_REHEARSAL_DIR/planner-rejection.log" 2>&1; then
  printf '%s\n' 'Malformed business settings incorrectly passed planning.' >&2; exit 1
fi
if ! grep -F 'business contract settings' "$RELEASE_REHEARSAL_DIR/planner-rejection.log" >/dev/null; then
  tail -n 40 "$RELEASE_REHEARSAL_DIR/planner-rejection.log" >&2
  printf '%s\n' 'The negative planner test failed before business settings validation.' >&2; exit 1
fi
if [[ -e "$RELEASE_OUTPUT_DIR/plan/release-plan.json" ]]; then
  printf '%s\n' 'The rejected settings left a published plan.' >&2; exit 1
fi
for service in release-rpc-proxy release-artifact-rpc-proxy deploy-release release-artifact; do
  container_id="$("${planner_compose[@]}" ps --all --quiet "$service")"
  if [[ -n "$container_id" ]]; then
    if [[ ! "$container_id" =~ ^[0-9a-f]{64}$ ]]; then printf '%s\n' 'Unexpected planner test container identity.' >&2; exit 1; fi
    if [[ "$(docker inspect --format '{{.State.StartedAt}}' "$container_id")" != 0001-01-01T00:00:00Z ]]; then
      printf 'Planner rejection failed to prevent %s from starting.\n' "$service" >&2; exit 1
    fi
  fi
done
release_run_owned 60 timeout -k 15s 60s bash tools/compose_cleanup.sh "$project-planner" --rmi local -- "${planner_compose[@]}" >"$RELEASE_REHEARSAL_DIR/planner-cleanup.log" 2>&1
planner_started=0
unset RELEASE_OUTPUT_DIR RELEASE_SOURCE_DIR

rehearse_success
