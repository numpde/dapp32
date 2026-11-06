#!/usr/bin/env bash
# Real-engine qualification of the release owner's private bind mounts.
set -euo pipefail
if [[ $# != 1 || -z $1 ]]; then
  printf '%s\n' 'Usage: bash tools/release_identity_check.sh <local-docker-context>' >&2
  exit 2
fi
context=$1
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)"
CAM_DOCKER_ENDPOINT=$(bash tools/docker_context.sh 'command line' "$context" undefined '' 0)
export CAM_DOCKER_ENDPOINT
source tools/release_identity.sh
release_select_container_identity
RELEASE_IDENTITY_CHECK_IMAGE=$(release_identity_image)
export RELEASE_IDENTITY_CHECK_IMAGE
printf 'Identity check: context=%s host=%s:%s container=%s:%s\n' \
  "$context" "$LOCAL_UID" "$LOCAL_GID" "$RELEASE_CONTAINER_UID" "$RELEASE_CONTAINER_GID"

source tools/release_process.sh
release_process_init
umask 077
workspace=$(mktemp -d -t release-identity-check-XXXXXXXX)
export RELEASE_IDENTITY_CHECK_DIR="$workspace"
project="identity-check-$(basename "$workspace" | tr '[:upper:]' '[:lower:]')"
compose=(docker --host "$CAM_DOCKER_ENDPOINT" compose --env-file /dev/null \
  -p "$project" -f tests/live/release_identity.yml)
cleanup() {
  local status=$? retired=1
  if ! release_process_cleanup_begin; then retired=0; fi
  if ! timeout -k 15s 60s bash tools/compose_cleanup.sh "$project" -- "${compose[@]}" \
      >>"$workspace/cleanup.log" 2>&1; then retired=0; fi
  if [[ "$retired" != 1 ]]; then
    printf 'Identity check FAIL: cleanup unconfirmed; retained %s (see cleanup.log).\n' "$workspace" >&2
    exit 2
  fi
  if ! rm -rf -- "$workspace"; then
    printf 'Identity check FAIL: cannot remove test workspace %s.\n' "$workspace" >&2
    exit 2
  fi
  if [[ "$status" == 0 ]]; then
    printf 'Identity private-mount check: PASS (%s); test resources removed.\n' "$context"
  else
    printf 'Identity private-mount check: FAIL (%s, exit %s); test resources removed.\n' "$context" "$status" >&2
  fi
  exit "$status"
}
trap cleanup EXIT
mkdir -m 700 -- "$workspace/private"
printf 'private input\n' > "$workspace/private/input"
printf 'original record\n' > "$workspace/private/record"
printf 'remove this\n' > "$workspace/private/remove"
release_progress_phase="private-file identity check"
# Keep timeout in the owned process group so cancellation reaches its children.
release_run_owned "$release_command_grace" timeout --foreground -s TERM -k 5s 60s \
  "${compose[@]}" run --pull never --rm --no-deps -T identity-check
for path in "$workspace/private/input" "$workspace/private/record"; do
  if [[ "$(stat -c '%u:%g:%a' -- "$path")" != "$LOCAL_UID:$LOCAL_GID:600" ]]; then
    printf 'Identity check FAIL: wrong host owner or private file mode: %s\n' "$path" >&2
    exit 1
  fi
done
if [[ "$(stat -c '%u:%g:%a' -- "$workspace/private")" != "$LOCAL_UID:$LOCAL_GID:700" ]] ||
   ! cmp -s "$workspace/private/input" <(printf 'private input\n') ||
   ! cmp -s "$workspace/private/record" <(printf 'replaced record\n') ||
   [[ -e "$workspace/private/remove" || -e "$workspace/private/replacement" ]]; then
  printf '%s\n' 'Identity check FAIL: private-directory or record round-trip assertion failed.' >&2
  exit 1
fi
