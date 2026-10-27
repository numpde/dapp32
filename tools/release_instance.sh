#!/usr/bin/env bash
# Called by Make with its shared path guard; ordinary phase targets own all effects.

release_instance() {
  local app="$1" operation="$2" instance="${INSTANCE:?Set INSTANCE to the instance directory}"
  local stage project lock status=0 cleanup_failed=0
  local -a terminal arguments clear_inputs
  if [[ "$instance" != /* || "$(realpath -ms -- "$instance")" != "$instance" ]]; then
    printf '%s\n' 'INSTANCE must be a normalized absolute directory path.' >&2; return 2
  fi
  reject_release_path_symlinks "$instance" INSTANCE
  case "$instance" in "$PWD"|"$PWD"/*) printf '%s\n' 'INSTANCE must be outside the checkout.' >&2; return 2 ;; esac
  if [[ ! -d "$instance" ]]; then
    if [[ "$operation" != setup ]]; then printf '%s\n' 'Instance directory does not exist; run release/setup with this INSTANCE first.' >&2; return 2; fi
    mkdir -p --mode=0700 -- "$instance"
  fi
  if [[ "$(stat -c %u -- "$instance")" != "$(id -u)" || "$(stat -c %a -- "$instance")" != 700 ]]; then
    printf '%s\n' 'INSTANCE must be owned by the current user with mode 0700. Secure the directory before using it.' >&2; return 2
  fi
  local selector
  for selector in CONFIG UI_CONFIG CAM_CONFIG CONTRACT_ARTIFACT UI_ARTIFACT ROOT ROOT_ARTIFACT CAM_BUNDLE CAM_RECORDS OUTPUT_DIR CONTRACT_RECORDS UI_RECORDS DEPLOYMENT_ARTIFACT_FILE; do
    if [[ -n "${!selector-}" ]]; then printf 'Use INSTANCE alone for record selection; remove %s.\n' "$selector" >&2; return 2; fi
  done
  command -v flock >/dev/null || { printf '%s\n' 'Instance commands require flock (util-linux), alongside setsid.' >&2; return 2; }
  umask 077
  reject_release_path_symlinks "$instance/.instance.lock" 'Instance lock'
  exec {lock}>"$instance/.instance.lock"
  flock --nonblock "$lock" || { printf '%s\n' 'Another command is using this instance. Wait for it to finish.' >&2; return 2; }
  stage=$(mktemp -d -- "$instance/.instance-command-XXXXXXXX")
  project="cam-instance-$(basename "$stage" | tr -cd 'a-zA-Z0-9' | tr '[:upper:]' '[:lower:]')"
  export RELEASE_INSTANCE_ROOT="$instance" RELEASE_INSTANCE_OPERATION="$operation"
  export RELEASE_INSTANCE_DIR="$instance" RELEASE_CONFIG_FILE="$instance/config.json" RELEASE_CREDENTIAL_CONFIG="$instance/config.json" RELEASE_CONFIG_STAGE_DIR="$stage"
  local -a compose=(docker compose --env-file /dev/null -p "$project" -f compose/release/config.yml)
  retire_instance_selection() {
    if [[ ! -d "$stage" ]]; then return 0; fi
    if ! timeout -k 15s 60s bash tools/compose_cleanup.sh "$project" -- "${compose[@]}" >>"$stage/cleanup.log" 2>&1; then
      printf 'Instance command cleanup is incomplete; retained %s\n' "$stage" >&2
      return 2
    fi
    rm -rf -- "$stage"
  }
  cleanup_instance() {
    local result=$?
    if ! release_process_cleanup_begin; then cleanup_failed=1; fi
    if ! retire_instance_selection; then cleanup_failed=1; fi
    if [[ "$cleanup_failed" != 0 ]]; then result=2; fi
    exit "$result"
  }
  trap cleanup_instance EXIT
  terminal=(-T)
  if [[ -t 0 && -t 1 ]]; then terminal=(-it); fi
  release_run_owned "$release_command_grace" "${compose[@]}" run --pull never --rm --no-deps "${terminal[@]}" release-instance prepare "$app" "$operation" "$instance" || exit "$?"
  mapfile -d '' -t arguments < "$stage/arguments"
  read -r RELEASE_INSTANCE_OPERATION < "$stage/operation"
  export RELEASE_INSTANCE_OPERATION
  clear_inputs=(CONFIG UI_CONFIG CAM_CONFIG CONTRACT_ARTIFACT UI_ARTIFACT ROOT ROOT_ARTIFACT CAM_BUNDLE CAM_RECORDS OUTPUT_DIR CONTRACT_RECORDS UI_RECORDS INSTANCE MAKEFLAGS MFLAGS MAKEOVERRIDES)
  if [[ "$operation" == viewer/* ]]; then
    retire_instance_selection || exit "$?"
    flock --unlock "$lock"
    exec {lock}>&-
  fi
  local -a environment=(env)
  local name
  for name in "${clear_inputs[@]}"; do environment+=(-u "$name"); done
  if [[ ${#arguments[@]} -gt 0 ]]; then
    release_run_owned "$release_make_cleanup_grace" "${environment[@]}" "${MAKE:?Make must select its recursive command}" --no-print-directory "${arguments[@]}" || status=$?
  fi
  if [[ "$status" != 0 ]]; then
    printf 'Operation stopped; records were retained. Resume with: make %q INSTANCE=%q\n' "$app/release/$operation" "$instance" >&2
    exit "$status"
  fi
  if [[ "$operation" == viewer/* ]]; then exit 0; fi
  release_run_owned "$release_command_grace" "${compose[@]}" run --pull never --rm --no-deps -T release-instance finish "$app" "$operation" "$instance"
  exit 0
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  source tools/release_process.sh
  release_process_init
  release_instance "$@"
fi
