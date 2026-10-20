#!/usr/bin/env bash
# Rehearse the normal release commands; only infrastructure and handoff actions are fixture-owned.
set -euo pipefail
unset MAKEFLAGS MAKEOVERRIDES MFLAGS GNUMAKEFLAGS MAKEFILES
app="${1:?Pass a supported app}"
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

cleanup() {
  status="$?"
  trap - EXIT
  if [[ "$infrastructure_started" == 1 ]] && ! "${compose[@]}" down --rmi local --volumes --remove-orphans >"$RELEASE_REHEARSAL_DIR/cleanup.log" 2>&1; then
    printf 'Rehearsal teardown failed; inspect %s/cleanup.log\n' "$RELEASE_REHEARSAL_DIR" >&2
    status=1
  elif [[ -d "$RELEASE_REHEARSAL_DIR/source" ]]; then
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
