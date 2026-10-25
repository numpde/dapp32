#!/usr/bin/env bash
# Rehearse the normal release commands; only infrastructure and handoff actions are fixture-owned.
set -euo pipefail
unset MAKEFLAGS MAKEOVERRIDES MFLAGS GNUMAKEFLAGS MAKEFILES
app="${1:?Pass a supported app}"
action="${3:?Pass release, waits, ipc-waits, approval-pty, or approval-success}"
if [[ "$action" != release && "$action" != waits && "$action" != ipc-waits && "$action" != approval-pty && "$action" != approval-success ]]; then
  printf '%s\n' 'Release rehearsal action must be release, waits, ipc-waits, approval-pty, or approval-success.' >&2; exit 2
fi
if [[ "$action" == release && "$#" -lt 5 ]]; then
  printf '%s\n' 'Release rehearsal requires the deployment Compose arguments supplied by Make.' >&2; exit 2
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
  bike-nft) pending='AddressMismatch("intendedCamRootOwner"' ;;
  escrow) pending='CamRootOwnerMismatch' ;;
  pay-to-play) pending='ReleaseVerificationFailed("CamRoot ownership")' ;;
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
planner_compose=(docker compose --project-name "$project-planner" "${@:4}" -f compose/release/rehearsal-deploy.yml)
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
  if [[ "$1" == make || "$log" == approval-image-build.log ]]; then grace=330; fi
  release_process_report "Starting $log; private output: $RELEASE_REHEARSAL_DIR/$log"
  if ! release_run_owned "$grace" timeout --foreground --kill-after="${grace}s" 900 "$@" >"$RELEASE_REHEARSAL_DIR/$log" 2>&1; then
    tail -n 60 "$RELEASE_REHEARSAL_DIR/$log" >&2
    printf 'Rehearsal step failed; full log: %s/%s\n' "$RELEASE_REHEARSAL_DIR" "$log" >&2
    return 1
  fi
  release_process_report "Completed $log"
}

verify_handoffs() {
  printf 'Checking that pending ownership prevents release verification...\n'
  if release_run_owned 330 timeout --foreground --kill-after=330s 900 make "$app/release/verify" >"$RELEASE_REHEARSAL_DIR/pending-verification.log" 2>&1; then
    printf '%s\n' 'Verification incorrectly accepted pending ownership.' >&2
    return 1
  fi
  if ! grep -F -- "$pending" "$RELEASE_REHEARSAL_DIR/pending-verification.log" >/dev/null; then
    tail -n 60 "$RELEASE_REHEARSAL_DIR/pending-verification.log" >&2
    printf '%s\n' 'Verification failed for a reason other than the pending CAM owner.' >&2
    return 1
  fi
  run_logged handoffs.log "${compose[@]}" run --build --rm --no-deps -T rehearsal-accept
  printf 'Verifying %s after handoffs and CAM discovery...\n' "$app"
  run_logged verification.log make "$app/release/verify"
  printf 'Release rehearsal passed: %s\n' "$app"
}

rehearse_success() {
  release_run_owned 330 timeout --foreground --kill-after=330s 900 \
    python3 tools/release_approval_pty_check.py "$app" success
  # Recover from the same retained plan/broadcast without a signing input.
  mv -- "$RELEASE_REHEARSAL_DIR/deployment/artifact/deployment.json" \
    "$RELEASE_REHEARSAL_DIR/deployment/artifact/deployment-before-recovery.json"
  python3 -I -B -c '
import json, os, pathlib, sys
root = pathlib.Path(os.environ["RELEASE_REHEARSAL_DIR"])
config = {"schemaVersion": 3, "app": sys.argv[1], "sourceCommit": sys.argv[2],
          "rpcUrl": "http://release-anvil:8545", "localNetwork": os.environ["RELEASE_REHEARSAL_NETWORK"],
          "settings": {"OUTPUT_DIR": str(root / "deployment")}}
(root / "artifact-recovery.json").write_text(json.dumps(config) + "\n")
' "$app" "$(git rev-parse HEAD)"
  run_logged artifact-completion.log make "$app/release/artifact" \
    "CONFIG=$RELEASE_REHEARSAL_DIR/artifact-recovery.json" DEPLOYER_PRIVATE_KEY_FILE= PRIVATE_KEY=
  cmp -- "$RELEASE_REHEARSAL_DIR/deployment/artifact/deployment-before-recovery.json" \
    "$RELEASE_REHEARSAL_DIR/deployment/artifact/deployment.json"
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
mkdir --mode=0700 "$RELEASE_OUTPUT_DIR" "$RELEASE_OUTPUT_DIR/plan" "$RELEASE_OUTPUT_DIR/broadcast" "$RELEASE_OUTPUT_DIR/artifact"
planner_started=1
anvil_id="$("${compose[@]}" ps --quiet release-anvil)"
if [[ ! "$anvil_id" =~ ^[0-9a-f]{64}$ ]]; then printf '%s\n' 'Cannot identify the fixture node.' >&2; exit 1; fi
anvil_ip="$(docker inspect --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$anvil_id")"
run_logged planner-boundaries.log "${planner_compose[@]}" run --build --rm --no-deps -T release-plan \
  timeout --signal=TERM --kill-after=10s 300s run-js-workspace node --experimental-strip-types tools/release-rehearsal/planner-check.ts "$app" "$anvil_ip"

# Malformed CAM must fail inside the real planner, before any proxy or signer starts.
cp -a "dapps/$app/cam" "$RELEASE_REHEARSAL_DIR/bad-cam"
printf '{\n' >"$RELEASE_REHEARSAL_DIR/bad-cam/main.json"
cat >"$RELEASE_REHEARSAL_DIR/bad-cam.yml" <<EOF
services:
  release-plan:
    volumes:
      - type: bind
        source: $RELEASE_REHEARSAL_DIR/bad-cam
        target: /work/dapps/$app/cam
        read_only: true
        bind:
          create_host_path: false
EOF
bad_compose=("${planner_compose[@]}" -f "$RELEASE_REHEARSAL_DIR/bad-cam.yml")
if release_run_owned 15 timeout --foreground --kill-after=10s 360 "${bad_compose[@]}" up --build --abort-on-container-exit --exit-code-from release-artifact release-artifact >"$RELEASE_REHEARSAL_DIR/planner-rejection.log" 2>&1; then
  printf '%s\n' 'Malformed CAM incorrectly passed the planner.' >&2; exit 1
fi
planner_id="$("${bad_compose[@]}" ps --all --quiet release-plan)"
if [[ ! "$planner_id" =~ ^[0-9a-f]{64}$ ]]; then printf '%s\n' 'The malformed CAM planner did not run.' >&2; exit 1; fi
if [[ "$(docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' "$planner_id")" != 'exited 1' ]]; then
  printf '%s\n' 'The malformed CAM planner did not exit with its expected validation failure.' >&2; exit 1
fi
docker logs "$planner_id" >"$RELEASE_REHEARSAL_DIR/planner-command.log" 2>&1
if ! grep -F 'inspectReleaseCamBundle' "$RELEASE_REHEARSAL_DIR/planner-command.log" >/dev/null; then
  tail -n 40 "$RELEASE_REHEARSAL_DIR/planner-command.log" >&2
  printf '%s\n' 'The negative planner test failed before CAM validation.' >&2; exit 1
fi
if [[ -e "$RELEASE_OUTPUT_DIR/plan/release-plan.json" ]]; then
  printf '%s\n' 'The rejected CAM left a published plan.' >&2; exit 1
fi
for service in release-rpc-proxy release-artifact-rpc-proxy deploy-release release-artifact; do
  container_id="$("${bad_compose[@]}" ps --all --quiet "$service")"
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

release_process_report 'Building the fixture approval image from the private candidate commit'
run_logged approval-image-build.log bash -c \
  'source tools/release_approval_images.sh; release_approval_build_image "$@"' bash \
  "$(git rev-parse HEAD)" "$RELEASE_REHEARSAL_DIR/approval-image"
RELEASE_APPROVAL_IMAGE="$(python3 -I -B -c \
  'import json, sys; print(json.load(open(sys.argv[1]))["imageId"])' \
  "$RELEASE_REHEARSAL_DIR/approval-image/approval-image.json")"
export RELEASE_APPROVAL_IMAGE
rehearse_success
