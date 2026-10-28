#!/usr/bin/env bash
# The instance selector owns record choice; this lane has no configuration or signing ports.
set -euo pipefail
app=${1:?Select the release app}
source tools/release_process.sh
release_process_init
source tools/release_tool_images.sh
artifact=${SOURCE_ARTIFACT:?Select saved deployment records with INSTANCE}
if [[ "$artifact" != /* || "$artifact" != "$(realpath -ms -- "$artifact")" || ! -f "$artifact" || -L "$artifact" ]]; then
  printf '%s\n' 'Source publication requires a regular deployment artifact at a normalized absolute path.' >&2; exit 2
fi
records=$(dirname -- "$(dirname -- "$artifact")")
case "$records" in "$PWD"|"$PWD"/*) printf '%s\n' 'Deployment records must be outside the checkout.' >&2; exit 2 ;; esac
if [[ "$(basename -- "$(dirname -- "$artifact")")" != artifact ]]; then
  printf '%s\n' 'Source publication requires the retained artifact/ deployment records.' >&2; exit 2
fi
digest=$(sha256sum -- "$artifact"); digest=${digest%% *}
output="$records/source-publication/$digest"
umask 077
for directory in "$records/source-publication" "$output" "$output/state"; do
  if [[ -L "$directory" || ( -e "$directory" && ! -d "$directory" ) ]]; then
    printf 'Source publication output is not a real directory: %s\n' "$directory" >&2; exit 2
  fi
  mkdir -p --mode=0700 -- "$directory"
done
exec {publication_lock}>"$output/.publication.lock"
flock --nonblock "$publication_lock" || { printf '%s\n' 'Another command is publishing these contract sources. Wait for it to finish.' >&2; exit 2; }
stage=$(mktemp -d -- "$output/.prepare-XXXXXXXX")
project="cam-source-${digest:0:16}-$(basename "$stage" | tr -cd 'a-zA-Z0-9' | tr '[:upper:]' '[:lower:]')"
export SOURCE_PUBLICATION_APP="$app" SOURCE_DEPLOYMENT_RECORDS="$records" SOURCE_ARTIFACT="$artifact"
export SOURCE_ARCHIVES="$stage/sources" SOURCE_REQUESTS="$stage/requests" SOURCE_PUBLICATION_STATE="$output/state"
mkdir --mode=0700 -- "$SOURCE_ARCHIVES" "$SOURCE_REQUESTS"
compose=(docker compose --env-file /dev/null -p "$project" -f compose/release/source-publication.yml)
cleanup() {
  local status=$?
  if [[ "$status" != 0 ]]; then printf 'Public source verification did not complete. Records and diagnostics: %s\n' "$output" >&2; fi
  if ! release_process_cleanup_begin; then status=2; fi
  if timeout -k 15s 60s bash tools/compose_cleanup.sh "$project" -- "${compose[@]}" >>"$output/cleanup.log" 2>&1; then
    rm -rf -- "$stage"
  else
    printf 'Source publication cleanup incomplete; retained %s\n' "$stage" >&2; status=2
  fi
  exit "$status"
}
trap cleanup EXIT
SOURCE_NODE_IMAGE=$(release_tool_image "$PWD" "$(git rev-parse HEAD)" node-deps)
export SOURCE_NODE_IMAGE
if [[ ! -d "$output/requests" ]]; then
  printf 'Preparing original sources offline. Diagnostics: %s/preparation.log\n' "$output"
  release_run_owned "$release_command_grace" "${compose[@]}" run --pull never --rm --no-deps -T source-prepare \
    run-js-workspace sh -eu -c 'npm run build:packages; ./node_modules/.bin/tsc -p tools/release-approval/tsconfig.json; node --experimental-strip-types tools/source-publication-prepare.ts select' \
    >"$output/preparation.log" 2>&1
  while IFS= read -r commit; do
    if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then printf '%s\n' 'Original source commit is invalid.' >&2; exit 2; fi
    mkdir --mode=0700 -- "$SOURCE_ARCHIVES/$commit"
    GIT_NO_REPLACE_OBJECTS=1 git archive --format=tar --output="$stage/source.tar" "$commit" dapps
    tar --extract --file="$stage/source.tar" --directory="$SOURCE_ARCHIVES/$commit"
    cp -a -- dapps/dependencies "$SOURCE_ARCHIVES/$commit/dapps/dependencies"
  done < "$SOURCE_REQUESTS/source-commits"
  release_run_owned "$release_command_grace" "${compose[@]}" run --pull never --rm --no-deps -T source-prepare >>"$output/preparation.log" 2>&1
  mv -- "$SOURCE_REQUESTS" "$output/requests"
fi
export SOURCE_REQUESTS="$output/requests"
printf 'Public source verification records: %s\n' "$output"
release_run_owned "$release_command_grace" "${compose[@]}" run --pull never --rm --no-deps -T source-submit
