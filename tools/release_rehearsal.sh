#!/usr/bin/env bash
# Rehearse the normal release commands; only infrastructure and handoff actions are fixture-owned.
set -euo pipefail
unset MAKEFLAGS MAKEOVERRIDES MFLAGS GNUMAKEFLAGS MAKEFILES
app="${1:?Pass a supported app}"
action="${3:?Pass release, waits, or ipc-waits}"
if [[ "$action" != release && "$action" != waits && "$action" != ipc-waits ]]; then
  printf '%s\n' 'Release rehearsal action must be release, waits, or ipc-waits.' >&2; exit 2
fi
if [[ "$action" != release && "$app" != escrow ]]; then
  printf '%s\n' 'The shared release-client wait qualification uses Escrow.' >&2; exit 2
fi
if [[ "${2:?Pass the Compose command}" != "docker compose" ]]; then
  printf '%s\n' 'Release rehearsals require Docker Compose.' >&2
  exit 2
fi
case "$app" in
  bike-nft) pending='AddressMismatch("intendedCamRootOwner"' ;;
  escrow) pending='CamRootOwnerMismatch' ;;
  pay-to-play) pending='ReleaseVerificationFailed("CamRoot ownership")' ;;
  *) printf 'No release rehearsal is defined for %s\n' "$app" >&2; exit 2 ;;
esac
umask 077
export DAPP="$app"
export RELEASE_REHEARSAL=1
export RELEASE_REHEARSAL_DIR
RELEASE_REHEARSAL_DIR="$(mktemp -d "/tmp/cam-release-rehearsal-${LOCAL_UID:?missing_LOCAL_UID}-XXXXXXXX")"
digest="$(printf '%s' "$RELEASE_REHEARSAL_DIR" | sha256sum)"
project="cam-rehearsal-${digest:0:24}"
export RELEASE_REHEARSAL_NETWORK="$project-rehearsal"
compose=(docker compose --project-name "$project" -f compose/release/rehearsal.yml)
unset PRIVATE_KEY RPC_URL RPC_CHAIN RPC_SERVICE RPC_API_KEY_FILE
repository="$(pwd -P)"
git_environment="$(git rev-parse --local-env-vars)"
while IFS= read -r name; do unset "$name"; done <<<"$git_environment"
unset GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
infrastructure_started=0
planner_started=0
planner_compose=(docker compose --project-name "$project-planner" -f compose/release/deploy.yml -f "compose/$app/release/deploy.yml" -f compose/release/rehearsal-deploy.yml)

cleanup() {
  status="$?"
  cleanup_failed=0
  # A child exit 2 can mean its signer teardown failed; retain mounted inputs.
  if [[ "$action" != release && "$status" == 2 ]]; then
    cleanup_failed=1
  fi
  trap - EXIT
  if [[ "$planner_started" == 1 ]] && ! "${planner_compose[@]}" down --rmi local --volumes --remove-orphans >"$RELEASE_REHEARSAL_DIR/planner-cleanup.log" 2>&1; then
    printf 'Planner test teardown failed; inspect %s/planner-cleanup.log\n' "$RELEASE_REHEARSAL_DIR" >&2
    status=1
    cleanup_failed=1
  fi
  if [[ "$infrastructure_started" == 1 ]] && ! "${compose[@]}" down --rmi local --volumes --remove-orphans >"$RELEASE_REHEARSAL_DIR/cleanup.log" 2>&1; then
    printf 'Rehearsal teardown failed; inspect %s/cleanup.log\n' "$RELEASE_REHEARSAL_DIR" >&2
    status=1
    cleanup_failed=1
  fi
  if [[ "$cleanup_failed" == 0 && -d "$RELEASE_REHEARSAL_DIR/source" ]]; then
    rm -rf -- "$RELEASE_REHEARSAL_DIR/source/dapps/dependencies" "$RELEASE_REHEARSAL_DIR/source/js/node_modules"
  fi
  printf 'Release rehearsal records: %s\n' "$RELEASE_REHEARSAL_DIR"
  exit "$status"
}
trap cleanup EXIT

mkdir --mode=0700 "$RELEASE_REHEARSAL_DIR/source" "$RELEASE_REHEARSAL_DIR/control"
# Copy candidate source without touching the caller's index, hooks, or history.
git ls-files --cached --others --exclude-standard -z >"$RELEASE_REHEARSAL_DIR/source-files"
while IFS= read -r -d '' path; do
  if [[ -e "$path" || -L "$path" ]]; then printf '%s\0' "$path"; fi
done <"$RELEASE_REHEARSAL_DIR/source-files" >"$RELEASE_REHEARSAL_DIR/existing-files"
tar --create --null --verbatim-files-from --no-recursion --files-from "$RELEASE_REHEARSAL_DIR/existing-files" --file "$RELEASE_REHEARSAL_DIR/source.tar"
tar --extract --file "$RELEASE_REHEARSAL_DIR/source.tar" --directory "$RELEASE_REHEARSAL_DIR/source"
rm "$RELEASE_REHEARSAL_DIR/source.tar" "$RELEASE_REHEARSAL_DIR/source-files" "$RELEASE_REHEARSAL_DIR/existing-files"
cd "$RELEASE_REHEARSAL_DIR/source"
git init --quiet --template=
git add --all
git -c user.name='Release rehearsal' -c user.email='release-rehearsal@example.invalid' -c core.hooksPath=/dev/null -c commit.gpgsign=false commit --quiet -m 'Snapshot release rehearsal candidate'
# Serve the same Git-exported bytes and modes that the release commands consume.
git archive --format=tar --output="$RELEASE_REHEARSAL_DIR/candidate.tar" HEAD
tar --extract --same-permissions --file "$RELEASE_REHEARSAL_DIR/candidate.tar" --directory "$RELEASE_REHEARSAL_DIR/source"
rm "$RELEASE_REHEARSAL_DIR/candidate.tar"
cp -a -- "$repository/dapps/dependencies" dapps/dependencies
cp -a -- "$repository/js/node_modules" js/node_modules
git rev-parse HEAD >"$RELEASE_REHEARSAL_DIR/source-commit"

run_logged() {
  local log="$1"
  shift
  if ! timeout --foreground 900 "$@" >"$RELEASE_REHEARSAL_DIR/$log" 2>&1; then
    tail -n 60 "$RELEASE_REHEARSAL_DIR/$log" >&2
    printf 'Rehearsal step failed; full log: %s/%s\n' "$RELEASE_REHEARSAL_DIR" "$log" >&2
    return 1
  fi
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
if [[ "$action" != release ]]; then
  bash tools/release_waits.sh "$project" "$action"
  exit "$?"
fi

# Exercise the maintained planner service without starting its networked dependants.
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
if timeout --foreground 360 "${bad_compose[@]}" up --build --abort-on-container-exit --exit-code-from release-artifact release-artifact >"$RELEASE_REHEARSAL_DIR/planner-rejection.log" 2>&1; then
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
"${planner_compose[@]}" down --rmi local --volumes --remove-orphans >"$RELEASE_REHEARSAL_DIR/planner-cleanup.log" 2>&1
planner_started=0
unset RELEASE_OUTPUT_DIR

printf 'Deploying %s through its normal release command...\n' "$app"
run_logged deploy.log make "$app/release/deploy"
printf 'Checking that pending ownership prevents release verification...\n'
if timeout --foreground 900 make "$app/release/verify" >"$RELEASE_REHEARSAL_DIR/pending-verification.log" 2>&1; then
  printf '%s\n' 'Verification incorrectly accepted pending ownership.' >&2
  exit 1
fi
if ! grep -F -- "$pending" "$RELEASE_REHEARSAL_DIR/pending-verification.log" >/dev/null; then
  tail -n 60 "$RELEASE_REHEARSAL_DIR/pending-verification.log" >&2
  printf '%s\n' 'Verification failed for a reason other than the pending CAM owner.' >&2
  exit 1
fi
run_logged handoffs.log "${compose[@]}" run --build --rm --no-deps -T rehearsal-accept
printf 'Verifying %s after handoffs and CAM discovery...\n' "$app"
run_logged verification.log make "$app/release/verify"
printf 'Release rehearsal passed: %s\n' "$app"
