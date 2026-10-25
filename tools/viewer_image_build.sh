#!/usr/bin/env bash
set -euo pipefail

image=${1:?Pass the local viewer image name}
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
export LOCAL_UID=$(id -u) LOCAL_GID=$(id -g)

# A build must not acquire base images or install dependencies implicitly.
for dockerfile in containers/node-deps/Dockerfile containers/viewer/Dockerfile; do
  base=$(sed -n 's/^FROM \([^ ]*\).*/\1/p' "$repo_root/$dockerfile")
  if ! docker image inspect "$base" >/dev/null; then
    printf 'Cannot inspect the required local base image %s. Acquire it explicitly before building.\n' "$base" >&2
    printf 'Fetch it with: docker pull %q\n' "$base" >&2
    exit 2
  fi
done

work_dir=$(mktemp -d)
project=cam-viewer-build-$(basename "$work_dir" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
compose=(docker compose --env-file /dev/null -p "$project" -f "$repo_root/compose/viewer-image.yml")
cleanup() {
  local status=$?
  trap - EXIT
  if ! timeout -k 15s 60s bash "$repo_root/tools/compose_cleanup.sh" "$project" -- "${compose[@]}"; then
    printf 'Viewer build cleanup failed for project %s; temporary files retained at %s.\n' "$project" "$work_dir" >&2
    if (( status == 0 )); then status=1; fi
    exit "$status"
  fi
  rm -rf -- "$work_dir"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

printf '%s\n' 'Building the current checkout offline using the installed locked dependencies.'
timeout 120s "${compose[@]}" build --pull=false viewer-build
timeout 180s "${compose[@]}" run --no-deps --pull never --name "$project-builder" viewer-build
# Docker copies as the invoking host user, independent of rootless UID mapping.
docker cp "$project-builder:/out/site" "$work_dir/site"
cp "$repo_root/containers/viewer/"{Dockerfile,nginx.conf,.dockerignore} "$work_dir/"
timeout 120s docker build --network=none --pull=false --tag "$image" "$work_dir"
printf 'Built local viewer image %s. No image was published.\n' "$image"
