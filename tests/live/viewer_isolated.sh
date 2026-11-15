#!/usr/bin/env bash
# Real-engine proof: public loopback ingress remains usable while the static
# viewer is internal-only. All images and containers belong to this test.
set -euo pipefail

root="$(cd -- "$(dirname -- "$0")/../.." && pwd -P)"
endpoint="${CAM_DOCKER_ENDPOINT:?Select a local Docker engine through Make}"
[[ "$endpoint" == unix:///* ]] || { printf '%s\n' 'Requires a selected local Unix Docker endpoint.' >&2; exit 2; }

scratch="$(mktemp -d /tmp/dapp32-viewer-isolated.XXXXXXXX)"
digest="$(printf '%s' "$scratch" | sha256sum | cut -c1-20)"
project="dapp32-viewer-isolated-$digest"
image="dapp32-viewer-test:$digest"
port="$(shuf -i 20000-59000 -n 1)"
export VIEWER_IMAGE="$image" VIEWER_BIND_HOST=127.0.0.1 VIEWER_PORT="$port"
export COMPOSE_PROJECT_NAME="$project"
compose=(docker --host "$endpoint" compose --env-file /dev/null -f "$root/compose/viewer-isolated.yml")
cleanup() {
  status=$?
  trap - EXIT
  trap '' INT TERM HUP
  if ! timeout -k 15s 60s bash "$root/tools/compose_cleanup.sh" "$project" -- \
      docker --host "$endpoint" compose --env-file /dev/null -f "$root/compose/viewer-isolated.yml"; then
    printf 'Viewer isolation cleanup incomplete: project %s; inputs retained at %s\n' "$project" "$scratch" >&2
    if [[ "$status" == 0 ]]; then status=2; fi
    exit "$status"
  fi
  if docker --host "$endpoint" image inspect "$image" >/dev/null 2>&1; then
    docker --host "$endpoint" image rm "$image" >/dev/null || { printf 'Fixture image was retained: %s\n' "$image" >&2; status=2; }
  fi
  rm -rf -- "$scratch"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

base="$(sed -n 's/^FROM \([^ ]*\).*/\1/p' "$root/containers/viewer/Dockerfile")"
[[ "$base" == *@sha256:* ]] || { printf '%s\n' 'Viewer base image is not digest pinned.' >&2; exit 2; }
if ! docker --host "$endpoint" image inspect "$base" >/dev/null; then
  printf '%s\n' 'Acquire the selected pinned viewer base through make base-images/pull first.' >&2
  exit 2
fi

mkdir -p "$scratch/context/site/assets"
cp "$root/containers/viewer/"{Dockerfile,nginx.conf,.dockerignore} "$scratch/context/"
printf '%s\n' '<!doctype html><html><head><script src="/assets/probe.js"></script></head><body>viewer-isolation-probe</body></html>' >"$scratch/context/site/index.html"
printf '%s\n' 'console.log("viewer-isolation-probe");' >"$scratch/context/site/assets/probe.js"
docker --host "$endpoint" build --network=none --pull=false \
  --build-arg "VIEWER_REVISION=$(printf '%040d' 1)" \
  --build-arg "VIEWER_PROJECT=$project" --build-arg VIEWER_MODIFIED=false \
  --tag "$image" "$scratch/context"

"${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 30
static="$("${compose[@]}" ps -q viewer)"
ingress="$("${compose[@]}" ps -q viewer-ingress)"
[[ -n "$static" && -n "$ingress" ]] || { printf '%s\n' 'Viewer or ingress is missing.' >&2; exit 2; }

network_names() {
  docker --host "$endpoint" inspect --format \
    '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$1" | sort
}
[[ "$(network_names "$static")" == "${project}_viewer_private" ]] || {
  printf '%s\n' 'Static viewer joined an unexpected external network.' >&2; exit 2;
}
[[ "$(network_names "$ingress")" == "$(printf '%s\n' "${project}_viewer_ingress" "${project}_viewer_private" | sort)" ]] || {
  printf '%s\n' 'Ingress network membership changed.' >&2; exit 2;
}
[[ "$(docker --host "$endpoint" port "$ingress" 8080/tcp)" == "127.0.0.1:$port" ]] || {
  printf '%s\n' 'Gateway is not published exclusively on loopback.' >&2; exit 2;
}
[[ "$(docker --host "$endpoint" inspect --format '{{json .HostConfig.PortBindings}}' "$static")" == "{}" ]] || {
  printf '%s\n' 'Static viewer has an unexpected published port.' >&2; exit 2;
}
if docker --host "$endpoint" exec "$static" sh -c \
  "awk 'NR>1 && \\$2 == \"00000000\" { found=1 } END { exit !found }' /proc/net/route"; then
  printf '%s\n' 'Static viewer has an IPv4 default route.' >&2; exit 2
fi
if docker --host "$endpoint" exec "$static" sh -c \
  "awk '\\$1 == \"00000000000000000000000000000000\" && \\$2 == \"00\" && \\$10 != \"lo\" { found=1 } END { exit !found }' /proc/net/ipv6_route"; then
  printf '%s\n' 'Static viewer has a non-loopback IPv6 default route.' >&2; exit 2
fi

check_site() {
  response="$(curl --fail --silent --show-error --max-time 4 "http://127.0.0.1:$port/")"
  [[ "$response" == *viewer-isolation-probe* ]] || { printf '%s\n' 'Gateway returned the wrong viewer content.' >&2; return 2; }
  script="$(curl --fail --silent --show-error --max-time 4 "http://127.0.0.1:$port/assets/probe.js")"
  [[ "$script" == *viewer-isolation-probe* ]] || { printf '%s\n' 'Gateway did not forward assets.' >&2; return 2; }
}
check_site

# The ingress should keep serving even if the unprivileged static container is
# replaced and Docker assigns a new address. It must resolve the service name.
"${compose[@]}" up -d --no-deps --force-recreate --no-build --pull never --wait --wait-timeout 30 viewer
replacement="$("${compose[@]}" ps -q viewer)"
[[ -n "$replacement" && "$replacement" != "$static" ]] || {
  printf '%s\n' 'Static container was not replaced.' >&2; exit 2;
}
[[ "$("${compose[@]}" ps -q viewer-ingress)" == "$ingress" ]] || {
  printf '%s\n' 'Ingress was unexpectedly replaced with the static container.' >&2; exit 2;
}
ready=0
for attempt in {1..20}; do
  if check_site >/dev/null 2>&1; then ready=1; break; fi
  sleep .25
done
[[ "$ready" == 1 ]] || { printf '%s\n' 'Gateway could not resolve the replacement static viewer.' >&2; exit 2; }
printf 'PASS isolated static nginx, loopback gateway, live replacement, owned cleanup (%s)\n' "$project"
