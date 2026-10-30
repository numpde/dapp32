#!/usr/bin/env bash
# Offline preparation owns deployment records; the networked menu receives public facts only.
set -euo pipefail
app=${1:?Select the release app}
source tools/release_process.sh
release_process_init
source tools/release_tool_images.sh
source tools/release_source_files.sh
if [[ -v SOURCE_CATALOG && -v SOURCE_ARTIFACT ]]; then
  printf '%s\n' 'Choose the instance contract catalog or one deployment artifact, not both.' >&2; exit 2
fi

source_output_directory() {
  local directory="$1"
  if [[ -L "$directory" || ( -e "$directory" && ! -d "$directory" ) ]]; then
    printf 'Source publication output is not a real directory: %s\n' "$directory" >&2; return 2
  fi
  mkdir -p --mode=0700 -- "$directory"
}

source_artifact_output() {
  local artifact="$1" records digest
  reject_release_path_symlinks "$artifact" 'Source deployment artifact'
  if [[ "$artifact" != /* || "$artifact" != "$(realpath -ms -- "$artifact")" || ! -f "$artifact" ]]; then
    printf '%s\n' 'Source publication requires a regular deployment artifact at a normalized absolute path.' >&2; return 2
  fi
  records=$(dirname -- "$(dirname -- "$artifact")")
  case "$records" in "$PWD"|"$PWD"/*) printf '%s\n' 'Deployment records must be outside the checkout.' >&2; return 2 ;; esac
  if [[ "$(basename -- "$(dirname -- "$artifact")")" != artifact ]]; then
    printf '%s\n' 'Source publication requires the retained artifact/ deployment records.' >&2; return 2
  fi
  digest=$(sha256sum -- "$artifact"); digest=${digest%% *}
  SOURCE_DEPLOYMENT_RECORDS="$records"
  source_artifact_cache="$records/source-publication/$digest"
}

umask 077
if [[ -v SOURCE_CATALOG ]]; then
  output="${RELEASE_INSTANCE_ROOT:?Contract selection requires INSTANCE}/source-publication"
  SOURCE_ARTIFACT="$SOURCE_CATALOG"
  SOURCE_DEPLOYMENT_RECORDS=$(dirname -- "$SOURCE_CATALOG")
else
  source_artifact_output "${SOURCE_ARTIFACT:?Select contracts with INSTANCE}"
  output="$source_artifact_cache"
  source_output_directory "$(dirname -- "$output")"
fi
source_output_directory "$output"
if [[ -v RELEASE_INSTANCE_ROOT ]]; then job_root="$RELEASE_INSTANCE_ROOT/source-publication"; else job_root="$output"; fi
source_output_directory "$job_root"
source_output_directory "$job_root/state"
reject_release_path_symlinks "$job_root/.publication.lock" 'Source publication lock'
exec {publication_lock}>"$job_root/.publication.lock"
flock --nonblock "$publication_lock" || { printf '%s\n' 'Another command is publishing these contract sources. Wait for it to finish.' >&2; exit 2; }
stage=$(mktemp -d -- "$output/.prepare-XXXXXXXX")
project="cam-source-$(basename "$stage" | tr -cd 'a-zA-Z0-9' | tr '[:upper:]' '[:lower:]')"
export SOURCE_PUBLICATION_APP="$app" SOURCE_DEPLOYMENT_RECORDS SOURCE_ARTIFACT
export SOURCE_ARCHIVES="$stage/sources" SOURCE_REQUESTS="$stage/catalog" SOURCE_PUBLICATION_STATE="$job_root/state"
mkdir --mode=0700 -- "$SOURCE_ARCHIVES" "$SOURCE_REQUESTS" "$stage/menu" "$stage/import"
compose=(docker compose --env-file /dev/null -p "$project" -f compose/release/source-publication.yml)
cleanup() {
  local status=$?
  if [[ "$status" != 0 ]]; then printf 'Public source verification did not complete. Records and diagnostics: %s\n' "$output" >&2; fi
  if ! release_process_cleanup_begin; then status=2; fi
  if timeout -k 15s 60s bash tools/compose_cleanup.sh "$project" -- "${compose[@]}" >>"$output/cleanup.log" 2>&1; then rm -rf -- "$stage"
  else printf 'Source publication cleanup incomplete; retained %s\n' "$stage" >&2; status=2; fi
  exit "$status"
}
trap cleanup EXIT
SOURCE_NODE_IMAGE=$(release_tool_image "$PWD" "$(git rev-parse HEAD)" node-deps)
export SOURCE_NODE_IMAGE
release_acquire_compose_images "${compose[@]}"

source_prepare() {
  # Preparation must not consume a caller's terminal or the remaining records in a loop.
  release_run_owned "$release_command_grace" "${compose[@]}" run --pull never --rm --no-deps -T source-prepare \
    run-js-workspace sh -eu -c 'npm run build:packages; ./node_modules/.bin/tsc -p tools/release-approval/tsconfig.json; node --experimental-strip-types tools/source-publication-prepare.ts "$@"' sh "$@" < /dev/null
}

prepare_source_artifact() {
  local artifact="$1" role commit cache artifact_lock
  shift
  local -a missing
  source_artifact_output "$artifact"
  SOURCE_ARTIFACT="$artifact"
  cache="$source_artifact_cache/requests"
  source_output_directory "$(dirname -- "$source_artifact_cache")"
  source_output_directory "$source_artifact_cache"
  reject_release_path_symlinks "$cache" 'Source request cache'
  if [[ -v SOURCE_CATALOG ]]; then
    reject_release_path_symlinks "$source_artifact_cache/.publication.lock" 'Source record lock'
    exec {artifact_lock}>"$source_artifact_cache/.publication.lock"
    flock --nonblock "$artifact_lock" || { printf '%s\n' 'Another command is using these source records.' >&2; return 2; }
  fi
  SOURCE_REQUESTS=$(mktemp -d -- "$stage/requests-XXXXXXXX")
  printf 'Preparing source records: %s\n' "$artifact"
  source_prepare select "$@" >>"$output/preparation.log" 2>&1
  mapfile -d '' -t missing < "$SOURCE_REQUESTS/source-roles"
  local -a needed=()
  for role in "${missing[@]}"; do
    reject_release_path_symlinks "$cache/$role.json" 'Cached public source request'
    if [[ ! -f "$cache/$role.json" ]]; then needed+=("$role"); fi
  done
  if [[ ${#needed[@]} -gt 0 ]]; then
    while IFS= read -r commit; do
      if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then printf '%s\n' 'Original source commit is invalid.' >&2; return 2; fi
      if [[ ! -d "$SOURCE_ARCHIVES/$commit" ]]; then
        release_archive_source "$PWD" "$commit" "$SOURCE_ARCHIVES/$commit" dapps
        cp -a -- dapps/dependencies "$SOURCE_ARCHIVES/$commit/dapps/dependencies"
      fi
    done < "$SOURCE_REQUESTS/source-commits"
    source_prepare "${needed[@]}" >>"$output/preparation.log" 2>&1
    source_output_directory "$cache"
    for role in "${needed[@]}"; do mv -- "$SOURCE_REQUESTS/$role.json" "$cache/$role.json"; done
  fi
  copy_public_source_file "$SOURCE_REQUESTS/contracts.json" "$cache/contracts.json"
  while IFS= read -r -d '' role && IFS= read -r -d '' key; do
    reject_release_path_symlinks "$source_artifact_cache/state/$role.json" 'Legacy source verification record'
    reject_release_path_symlinks "$job_root/state/$key.json" 'Source verification record'
    if [[ ! -e "$job_root/state/$key.json" && -f "$source_artifact_cache/state/$role.json" ]]; then
      copy_public_source_file "$cache/$role.json" "$stage/import/$key.request.json"
      copy_public_source_file "$source_artifact_cache/state/$role.json" "$stage/import/$key.state.json"
    fi
  done < "$SOURCE_REQUESTS/source-state-keys"
  source_artifact_cache="$(dirname -- "$cache")"
  if [[ -v SOURCE_CATALOG ]]; then exec {artifact_lock}>&-; fi
}

if [[ -v SOURCE_CATALOG ]]; then
  source_prepare catalog >"$output/preparation.log" 2>&1
  SOURCE_PUBLICATION_STATE="$stage/menu"
  terminal=(-T)
  if [[ -t 0 && -t 1 ]]; then terminal=(-it); fi
  release_run_owned "$release_command_grace" "${compose[@]}" run --pull never --rm --no-deps "${terminal[@]}" source-submit menu
  reject_release_path_symlinks "$stage/menu/selected-keys" 'Selected source contracts'
  if [[ ! -s "$stage/menu/selected-keys" ]]; then printf '%s\n' 'Cancelled; no sources were submitted.'; exit 0; fi
  copy_public_source_file "$stage/menu/selected-keys" "$stage/catalog/selected-keys"
  source_prepare selection >>"$output/preparation.log" 2>&1
  while IFS= read -r -d '' relative && IFS= read -r -d '' roles; do
    read -r -a requested_roles <<< "$roles"
    prepare_source_artifact "$RELEASE_INSTANCE_ROOT/$relative" "${requested_roles[@]}"
  done < "$stage/catalog/source-records"
  while IFS= read -r -d '' relative && IFS= read -r -d '' role && IFS= read -r -d '' key; do
    source_artifact_output "$RELEASE_INSTANCE_ROOT/$relative"
    copy_public_source_file "$source_artifact_cache/requests/$role.json" "$stage/catalog/$key.json"
  done < "$stage/catalog/request-links"
  SOURCE_REQUESTS="$stage/catalog"
else
  prepare_source_artifact "$SOURCE_ARTIFACT"
  SOURCE_REQUESTS="$source_artifact_cache/requests"
fi
SOURCE_PUBLICATION_STATE="$job_root/state"
publication_requests="$SOURCE_REQUESTS"
SOURCE_REQUESTS="$stage/import"
release_run_owned "$release_command_grace" "${compose[@]}" run --pull never --rm --no-deps -T source-state-import
SOURCE_REQUESTS="$publication_requests"
printf 'Public source verification records: %s\n' "$output"
release_run_owned "$release_command_grace" "${compose[@]}" run --pull never --rm --no-deps -T source-submit
