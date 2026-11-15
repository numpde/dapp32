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
candidate="dapp32-viewer-test:$digest-candidate"
port="$(shuf -i 20000-59000 -n 1)"
image_created=0
candidate_created=0
verified=0
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
  if [[ "$image_created" == 1 ]]; then
    if ! docker --host "$endpoint" image rm "$image" >/dev/null; then
      printf 'Fixture image was retained: %s; inputs retained at %s\n' "$image" "$scratch" >&2
      if [[ "$status" == 0 ]]; then status=2; fi
      exit "$status"
    fi
  fi
  if [[ "$candidate_created" == 1 ]]; then
    if ! docker --host "$endpoint" image rm "$candidate" >/dev/null; then
      printf 'Fixture image was retained: %s; inputs retained at %s\n' "$candidate" "$scratch" >&2
      if [[ "$status" == 0 ]]; then status=2; fi
      exit "$status"
    fi
  fi
  if ! rm -rf -- "$scratch"; then
    printf 'Viewer isolation scratch cleanup failed: %s\n' "$scratch" >&2
    if [[ "$status" == 0 ]]; then status=2; fi
  fi
  if [[ "$status" == 0 && "$verified" == 1 ]]; then
    printf 'PASS isolated static nginx, IPv4/IPv6 routes, loopback gateway, live replacement and completed cleanup (%s)\n' "$project"
  fi
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
printf '%s\n' '<!doctype html><html><head><script src="/assets/probe.js"></script></head><body>viewer-isolation-original</body></html>' >"$scratch/context/site/index.html"
printf '%s\n' 'console.log("viewer-isolation-original");' >"$scratch/context/site/assets/probe.js"
docker --host "$endpoint" build --network=none --pull=false \
  --build-arg "VIEWER_REVISION=$(printf '%040d' 1)" \
  --build-arg "VIEWER_PROJECT=$project" --build-arg VIEWER_MODIFIED=false \
  --tag "$image" "$scratch/context"
image_created=1
printf '%s\n' '<!doctype html><html><head><script src="/assets/probe.js"></script></head><body>viewer-isolation-candidate</body></html>' >"$scratch/context/site/index.html"
printf '%s\n' 'console.log("viewer-isolation-candidate");' >"$scratch/context/site/assets/probe.js"
docker --host "$endpoint" build --network=none --pull=false \
  --build-arg "VIEWER_REVISION=$(printf '%040d' 2)" \
  --build-arg "VIEWER_PROJECT=$project" --build-arg VIEWER_MODIFIED=false \
  --tag "$candidate" "$scratch/context"
candidate_created=1

if ! "${compose[@]}" up -d --no-build --pull never --wait --wait-timeout 30; then
  "${compose[@]}" ps >&2 || :
  "${compose[@]}" logs --no-color --tail 80 viewer-ingress >&2 || :
  ingress_id="$("${compose[@]}" ps -q viewer-ingress)"
  if [[ -n "$ingress_id" ]]; then
    docker --host "$endpoint" inspect --format '{{json .State.Health.Log}}' "$ingress_id" >&2 || :
  fi
  exit 2
fi
static="$("${compose[@]}" ps -q viewer)"
ingress="$("${compose[@]}" ps -q viewer-ingress)"
[[ -n "$static" && -n "$ingress" ]] || { printf '%s\n' 'Viewer or ingress is missing.' >&2; exit 2; }

network_names() {
  docker --host "$endpoint" inspect --format \
    '{{range $name, $_ := .NetworkSettings.Networks}}{{println $name}}{{end}}' "$1" | awk 'NF {print}' | sort
}
static_networks="$(network_names "$static")"
gateway_networks="$(network_names "$ingress")"
[[ "$static_networks" == "${project}_viewer_private" ]] || {
  printf 'Static viewer networks: %q (expected %q)\n' "$static_networks" "${project}_viewer_private" >&2
  docker --host "$endpoint" inspect --format '{{json .NetworkSettings.Networks}}' "$static" >&2
  exit 2
}
[[ "$gateway_networks" == "$(printf '%s\n' "${project}_viewer_ingress" "${project}_viewer_private" | sort)" ]] || {
  printf 'Ingress networks: %q\n' "$gateway_networks" >&2
  docker --host "$endpoint" inspect --format '{{json .NetworkSettings.Networks}}' "$ingress" >&2
  exit 2
}
[[ "$(docker --host "$endpoint" port "$ingress" 8080/tcp)" == "127.0.0.1:$port" ]] || {
  printf '%s\n' 'Gateway is not published exclusively on loopback.' >&2; exit 2;
}
[[ "$(docker --host "$endpoint" inspect --format '{{json .HostConfig.PortBindings}}' "$static")" == "{}" ]] || {
  printf '%s\n' 'Static viewer has an unexpected published port.' >&2; exit 2;
}
# Fetch the route tables from inside the *static* container. Parse them on
# the host so awk failures cannot be misinterpreted as "no default route".
route_matches() {
  case "$1" in
    ipv4) awk 'NR > 1 && $2 == "00000000" { print }' ;;
    ipv6) awk '$1 == "00000000000000000000000000000000" && $2 == "00" && $10 != "lo" { print }' ;;
    *) printf 'Unknown route family: %s\n' "$1" >&2; return 2 ;;
  esac
}
assert_no_default_route() {
  local family="$1" contents="$2" matching
  if ! matching="$(printf '%s\n' "$contents" | route_matches "$family")"; then
    printf 'Route inspection failed for %s; cannot establish isolation.\n' "$family" >&2
    return 2
  fi
  if [[ -n "$matching" ]]; then
    printf '%s default route(s) present:\n%s\n' "$family" "$matching" >&2
    return 2
  fi
}

# Regression controls prove both detectors really execute, rather than
# accepting a failed awk invocation as a negative route observation.
assert_no_default_route ipv4 $'Iface Destination\neth0 00000001'
if assert_no_default_route ipv4 $'Iface Destination\neth0 00000000' >/dev/null 2>&1; then
  printf '%s\n' 'Broken IPv4 route detector accepted a default route.' >&2; exit 2
fi
assert_no_default_route ipv6 '00000000000000000000000000000000 00 0 0 0 0 0 0 0 lo'
if assert_no_default_route ipv6 '00000000000000000000000000000000 00 0 0 0 0 0 0 0 eth0' >/dev/null 2>&1; then
  printf '%s\n' 'Broken IPv6 route detector accepted a default route.' >&2; exit 2
fi

if ! ipv4_routes="$(docker --host "$endpoint" exec "$static" cat /proc/net/route)"; then
  printf '%s\n' 'Cannot read the static viewer IPv4 routing table.' >&2; exit 2
fi
if ! ipv6_routes="$(docker --host "$endpoint" exec "$static" cat /proc/net/ipv6_route)"; then
  printf '%s\n' 'Cannot read the static viewer IPv6 routing table.' >&2; exit 2
fi
[[ "$ipv4_routes" == Iface* ]] || { printf '%s\n' 'Unexpected IPv4 route-table format.' >&2; exit 2; }
assert_no_default_route ipv4 "$ipv4_routes"
assert_no_default_route ipv6 "$ipv6_routes"
printf '%s\n' 'PASS static viewer route inspection: no IPv4 or non-loopback IPv6 default route'

check_site() {
  response="$(curl --fail --silent --show-error --max-time 4 "http://127.0.0.1:$port/")"
  [[ "$response" == *"$1"* ]] || { printf '%s\n' 'Gateway returned the wrong viewer content.' >&2; return 2; }
  script="$(curl --fail --silent --show-error --max-time 4 "http://127.0.0.1:$port/assets/probe.js")"
  [[ "$script" == *"$1"* ]] || { printf '%s\n' 'Gateway did not forward the expected assets.' >&2; return 2; }
}
check_site viewer-isolation-original

# Exercise the updater's actual static-only command with a distinct image.
make --no-print-directory viewer/isolated/viewer/up DOCKER_CONTEXT= CAM_DOCKER_ENDPOINT="$endpoint" \
  VIEWER_COMPOSE_PROJECT_NAME="$project" VIEWER_IMAGE="$candidate"
replacement="$("${compose[@]}" ps -q viewer)"
[[ -n "$replacement" && "$replacement" != "$static" ]] || {
  printf '%s\n' 'Static container was not replaced.' >&2; exit 2;
}
[[ "$("${compose[@]}" ps -q viewer-ingress)" == "$ingress" ]] || {
  printf '%s\n' 'Ingress was unexpectedly replaced with the static container.' >&2; exit 2;
}
ready=0
for attempt in {1..20}; do
  if check_site viewer-isolation-candidate >/dev/null 2>&1; then ready=1; break; fi
  sleep .25
done
[[ "$ready" == 1 ]] || { printf '%s\n' 'Gateway could not resolve the replacement static viewer.' >&2; exit 2; }
[[ "$(docker --host "$endpoint" inspect --format '{{.Image}}' "$replacement")" == "$(docker --host "$endpoint" image inspect --format '{{.Id}}' "$candidate")" ]]

# Recover through the same command even if the candidate container disappeared.
"${compose[@]}" rm --stop --force viewer
make --no-print-directory viewer/isolated/viewer/up DOCKER_CONTEXT= CAM_DOCKER_ENDPOINT="$endpoint" \
  VIEWER_COMPOSE_PROJECT_NAME="$project" VIEWER_IMAGE="$image"
restored="$("${compose[@]}" ps -q viewer)"
[[ "$restored" != "$replacement" && "$("${compose[@]}" ps -q viewer-ingress)" == "$ingress" ]]
[[ "$(docker --host "$endpoint" inspect --format '{{.Image}}' "$restored")" == "$(docker --host "$endpoint" image inspect --format '{{.Id}}' "$image")" ]]
ready=0
for attempt in {1..20}; do
  if check_site viewer-isolation-original >/dev/null 2>&1; then ready=1; break; fi
  sleep .25
done
[[ "$ready" == 1 ]] || { printf '%s\n' 'Gateway could not serve the restored viewer.' >&2; exit 2; }
verified=1
