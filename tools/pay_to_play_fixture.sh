#!/usr/bin/env bash
# This owner creates base fixtures; scenario state belongs to the consuming runner.
set -euo pipefail
operation=${1:?Choose up, info or down}
repository=$(pwd -P)
umask 077
source tools/release_process.sh
exec {descriptor_output}>&1
exec 1>&2
release_process_init

if [[ ! -v FIXTURE_ID ]]; then
  if [[ "$operation" != up ]]; then printf '%s\n' 'Set FIXTURE_ID to the fixture to inspect or remove.'; exit 2; fi
  IFS= read -r generated < /proc/sys/kernel/random/uuid
  FIXTURE_ID="run-${generated//-/}"
fi
if [[ ! "$FIXTURE_ID" =~ ^[a-z0-9][a-z0-9_-]{0,47}$ ]]; then
  printf '%s\n' 'FIXTURE_ID must be 1-48 lowercase letters, digits, underscores or hyphens, starting with a letter or digit.'; exit 2
fi
export FIXTURE_ID
project="dapps-pay-to-play-fixture-$FIXTURE_ID"
network="${project}_pay-to-play_local"
export COMPOSE_PROJECT_NAME="$project" PAY_TO_PLAY_FIXTURE_PROJECT="$project" PAY_TO_PLAY_FIXTURE_NETWORK="$network"
export CAM_URI=http://pay-to-play-cam-http:8080/main.json
compose=(docker compose --env-file /dev/null -p "$project" -f compose/pay-to-play/local/deploy.yml -f compose/pay-to-play/local/http.yml -f compose/pay-to-play/local/fixture.yml)
completed=0
creation_attempted=0
creation_token=""
scratch=""

cleanup() {
  local result=$? owned
  if ! release_process_cleanup_begin; then result=2; fi
  if [[ "$operation" == up && "$creation_attempted" == 1 && "$completed" != 1 ]]; then
    # The token distinguishes our uncertain create from a concurrent caller winning the same name.
    if owned=$(timeout -k 2s 10s docker network ls --quiet --filter "name=^${network}$" --filter "label=io.cam.fixture.creation=$creation_token"); then
      if [[ -n "$owned" ]]; then
        if ! timeout -k 15s 60s bash tools/compose_cleanup.sh "$project" -- "${compose[@]}"; then result=2; fi
      fi
    else
      printf 'Fixture ownership could not be checked. Inspect %s before recovery.\n' "$FIXTURE_ID"
      result=2
    fi
  fi
  if [[ -n "$scratch" ]]; then rm -rf -- "$scratch"; fi
  if (( result != 0 )); then printf 'Fixture operation failed for %s. Inspect retained diagnostics before recovery.\n' "$FIXTURE_ID"; fi
  exit "$result"
}

case "$operation" in
  up)
    for resource in container network volume; do
      inventory=(docker "$resource" ls --quiet --filter "label=com.docker.compose.project=$project")
      if [[ "$resource" == container ]]; then inventory+=(--all); fi
      if ! existing=$(timeout -k 2s 10s "${inventory[@]}"); then
        printf 'Cannot inspect fixture %s %s resources; no creation was attempted.\n' "$FIXTURE_ID" "$resource"; exit 2
      fi
      if [[ -n "$existing" ]]; then printf 'Fixture %s already exists; it was left untouched and is not owned by this invocation.\n' "$FIXTURE_ID"; exit 2; fi
    done
    trap cleanup EXIT
    IFS= read -r creation_token < /proc/sys/kernel/random/uuid
    export PAY_TO_PLAY_FIXTURE_CREATION_TOKEN="$creation_token"
    printf 'Creating fixture %s (attempt %s).\n' "$FIXTURE_ID" "$creation_token"
    printf 'Recovery after an unknown outcome: inspect this ID, then make --no-print-directory -C %q pay-to-play/local/fixture/down FIXTURE_ID=%q\n' "$repository" "$FIXTURE_ID"
    release_run_owned "$release_make_cleanup_grace" "${MAKE:?Make must select its recursive command}" --no-print-directory dapps/deps/verify < /dev/null
    creation_attempted=1
    release_run_owned "$release_command_grace" docker network create --internal \
      --label "com.docker.compose.project=$project" --label com.docker.compose.network=pay-to-play_local \
      --label "io.cam.fixture.creation=$creation_token" "$network" < /dev/null
    release_run_owned "$release_command_grace" "${compose[@]}" up --build --detach --wait --wait-timeout 60 pay-to-play-anvil pay-to-play-cam-http < /dev/null
    release_run_owned "$release_command_grace" timeout -k 15s 180s "${compose[@]}" run --build --rm --no-deps -T deploy-pay-to-play-local < /dev/null
    ;;
  info)
    trap cleanup EXIT
    IFS= read -r PAY_TO_PLAY_FIXTURE_CREATION_TOKEN < /proc/sys/kernel/random/uuid
    export PAY_TO_PLAY_FIXTURE_CREATION_TOKEN
    for service in pay-to-play-anvil pay-to-play-cam-http; do
      running=$(timeout -k 2s 10s "${compose[@]}" ps --quiet --status running "$service")
      if [[ -z "$running" ]]; then printf 'Fixture service %s is not running for %s.\n' "$service" "$FIXTURE_ID"; exit 2; fi
    done
    timeout -k 2s 10s docker volume inspect "${project}_pay-to-play_broadcast" >/dev/null
    ;;
  down)
    trap cleanup EXIT
    IFS= read -r PAY_TO_PLAY_FIXTURE_CREATION_TOKEN < /proc/sys/kernel/random/uuid
    export PAY_TO_PLAY_FIXTURE_CREATION_TOKEN
    release_run_owned 75 timeout -k 15s 60s bash tools/compose_cleanup.sh "$project" -- "${compose[@]}"
    exit 0
    ;;
  *) printf '%s\n' 'Choose up, info or down.'; exit 2 ;;
esac
scratch=$(mktemp -d /tmp/cam-p2p-descriptor-XXXXXXXX)
release_run_owned "$release_command_grace" "${compose[@]}" run --pull never --rm --no-deps -T pay-to-play-fixture-info < /dev/null >"$scratch/descriptor.json"
release_run_owned "$release_command_grace" cat "$scratch/descriptor.json" >&"$descriptor_output"
completed=1
