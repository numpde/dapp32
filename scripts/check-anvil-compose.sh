#!/usr/bin/env bash
set -euo pipefail

printf '%s\n' 'Checking Anvil Compose posture...'

if ! command -v jq >/dev/null 2>&1; then
  printf '%s\n' 'jq is required for make check-anvil-compose.' >&2
  exit 2
fi

: "${LOCAL_UID:?missing LOCAL_UID}"
: "${LOCAL_GID:?missing LOCAL_GID}"
: "${COMPOSE_PROJECT_NAME:?missing COMPOSE_PROJECT_NAME}"

COMPOSE_DIR="${COMPOSE_DIR:-compose}"
DOCKER_COMPOSE="${DOCKER_COMPOSE:-docker compose}"
read -r -a DOCKER_COMPOSE_CMD <<<"$DOCKER_COMPOSE"

compose_json() {
  local profiles="$1"
  local host_port="${2:-8545}"

  LOCAL_UID="$LOCAL_UID" \
  LOCAL_GID="$LOCAL_GID" \
  COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT_NAME" \
  COMPOSE_PROFILES="$profiles" \
  ANVIL_HOST_PORT="$host_port" \
  "${DOCKER_COMPOSE_CMD[@]}" -f "$COMPOSE_DIR/anvil.yml" config --format json
}

jq_expect() {
  local description="$1"
  local payload="$2"
  local filter="$3"

  if ! jq -e "$filter" >/dev/null <<<"$payload"; then
    printf 'compose/anvil.yml failed posture check: %s\n' "$description" >&2
    exit 2
  fi
}

no_profile_json="$(compose_json '')"
internal_json="$(compose_json 'internal')"
host_json="$(compose_json 'host' '18545')"
all_json="$(compose_json 'internal,host' '18545')"

jq_expect \
  'no profile renders zero services' \
  "$no_profile_json" \
  '(.services | keys) == []'

jq_expect \
  'internal profile renders only anvil-internal' \
  "$internal_json" \
  '(.services | keys) == ["anvil-internal"]'

jq_expect \
  'host profile renders only anvil-host' \
  "$host_json" \
  '(.services | keys) == ["anvil-host"]'

jq_expect \
  'all profiles render both Anvil services' \
  "$all_json" \
  '(.services | keys) == ["anvil-host", "anvil-internal"]'

jq_expect \
  'anvil-internal has no host ports' \
  "$internal_json" \
  '(.services["anvil-internal"] | has("ports") | not)'

jq_expect \
  'anvil-internal is only on anvil_internal' \
  "$internal_json" \
  '(.services["anvil-internal"].networks | keys) == ["anvil_internal"]'

jq_expect \
  'anvil_internal is an internal network' \
  "$internal_json" \
  '.networks.anvil_internal.internal == true'

jq_expect \
  'anvil-host publishes exactly 127.0.0.1:18545:8545' \
  "$host_json" \
  '(.services["anvil-host"].ports | length) == 1 and (.services["anvil-host"].ports[0] | .host_ip == "127.0.0.1" and .published == "18545" and .target == 8545 and .protocol == "tcp")'

jq_expect \
  'no service publishes on 0.0.0.0' \
  "$all_json" \
  '[.services[]?.ports[]? | select(.host_ip == "0.0.0.0")] | length == 0'

runtime_posture_filter='
[
  .services["anvil-internal"],
  .services["anvil-host"]
] | map(select(
  .read_only == true
  and .cap_drop == ["ALL"]
  and (.security_opt | index("no-new-privileges:true") != null)
  and (.user | test("^[1-9][0-9]*:[0-9]+$"))
  and .pids_limit == 256
  and (.mem_limit | tostring | IN("1073741824", "1g"))
  and (has("volumes") | not)
  and (has("secrets") | not)
)) | length == 2
'

jq_expect \
  'both Anvil services render hardened runtime posture' \
  "$all_json" \
  "$runtime_posture_filter"
