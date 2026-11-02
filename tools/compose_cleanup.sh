#!/usr/bin/env bash
# Only complete, disposable Compose project owners may use this teardown.
set -euo pipefail
project=${1:?Pass the owned Compose project}
shift
down_flags=()
while [[ $# -gt 0 && $1 != -- ]]; do
  down_flags+=("$1")
  shift
done
if [[ $# == 0 ]]; then
  printf '%s\n' 'Pass existing teardown flags, then -- and the Docker Compose command.' >&2
  exit 2
fi
shift
if [[ $# -lt 4 || $1 != docker || $2 != --host || $3 != "${CAM_DOCKER_ENDPOINT:?Docker context was not selected}" || $4 != compose ]]; then
  printf '%s\n' 'Cleanup requires Docker Compose using the selected operation endpoint.' >&2
  exit 2
fi
# Once teardown begins, repeated cancellation must not abandon its resources.
trap '' INT TERM HUP

status=0
down=("$@" --project-name "$project" down --timeout 10 --volumes --remove-orphans "${down_flags[@]}")
"${down[@]}" || status=$?

# Shared/external resources carry their actual owner's project label.
for kind in container network volume; do
  if [[ $kind == container ]]; then
    remaining=$(docker --host "$CAM_DOCKER_ENDPOINT" container ls --all --quiet --filter "label=com.docker.compose.project=$project")
  else
    remaining=$(docker --host "$CAM_DOCKER_ENDPOINT" "$kind" ls --quiet --filter "label=com.docker.compose.project=$project")
  fi
  if [[ -n $remaining ]]; then
    printf 'Cleanup left %s resources owned by %s: %s\n' "$kind" "$project" "$remaining" >&2
    if (( status == 0 )); then status=1; fi
  fi
done
exit "$status"
