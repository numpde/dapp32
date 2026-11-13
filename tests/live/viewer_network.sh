#!/usr/bin/env bash
# Real-engine proof: the static viewer remains reachable on the published
# loopback port while its container has no IPv4 default route.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd -P)"
endpoint="${CAM_DOCKER_ENDPOINT:?Select a local Docker engine through Make}"
[[ "$endpoint" == unix:///* ]] || { printf '%s\n' 'Only selected local Unix Docker endpoints are allowed.' >&2; exit 2; }

image="$(awk '$1 == "FROM" { print $2; exit }' "$root/containers/viewer/Dockerfile")"
[[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || { printf '%s\n' 'Viewer image must have a literal digest pin.' >&2; exit 2; }
docker --host "$endpoint" pull "$image"

scratch="$(mktemp -d /tmp/dapp32-viewer-network.XXXXXXXX)"
project="dapp32-viewer-network-$(printf '%s' "$scratch" | sha256sum | cut -c1-20)"
port="$(shuf -i 20000-59000 -n 1)"
cleanup() {
  code=$?
  trap - EXIT
  VIEWER_IMAGE="$image" VIEWER_BIND_HOST=127.0.0.1 VIEWER_PORT="$port" \
    docker --host "$endpoint" compose -p "$project" -f "$root/compose/viewer.yml" \
      down --timeout 10 --volumes --remove-orphans || code=2
  rmdir -- "$scratch" || code=2
  exit "$code"
}
trap cleanup EXIT

VIEWER_IMAGE="$image" VIEWER_BIND_HOST=127.0.0.1 VIEWER_PORT="$port" \
  docker --host "$endpoint" compose -p "$project" -f "$root/compose/viewer.yml" \
    up -d --no-build --pull never

ready=0
for attempt in {1..60}; do
  if curl --fail --silent --show-error --max-time 2 "http://127.0.0.1:$port/" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep .25
done
[[ "$ready" == 1 ]] || { printf '%s\n' 'Published viewer endpoint did not respond.' >&2; exit 2; }

container="$(VIEWER_IMAGE="$image" VIEWER_BIND_HOST=127.0.0.1 VIEWER_PORT="$port" \
  docker --host "$endpoint" compose -p "$project" -f "$root/compose/viewer.yml" ps -q viewer)"
[[ -n "$container" ]] || { printf '%s\n' 'Viewer container disappeared.' >&2; exit 2; }
routing="$(docker --host "$endpoint" exec "$container" cat /proc/net/route)"
if printf '%s\n' "$routing" | awk 'NR > 1 && $2 == "00000000" { found=1 } END { exit !found }'; then
  printf '%s\n' 'Viewer has an IPv4 default route despite its internal network.' >&2
  exit 2
fi
printf 'PASS viewer on 127.0.0.1:%s; no container IPv4 default route; owned project %s\n' "$port" "$project"
