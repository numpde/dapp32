#!/usr/bin/env bash
# Exercise installer ownership against real Compose resources in a disposable checkout.
set -euo pipefail

root=$(cd -- "$(dirname -- "$0")/../.." && pwd -P)
endpoint=${CAM_DOCKER_ENDPOINT:?Select a local Docker engine through Make}
mode=${1:?Pass package or solidity}
[[ $endpoint == unix:///* ]] || { printf '%s\n' 'A local Unix Docker engine is required.' >&2; exit 2; }
real_docker=$(command -v docker)
scratch=$(mktemp -d /tmp/dapp32-installer-test.XXXXXXXX)
trap 'rm -rf -- "$scratch"' EXIT
checkout=$scratch/checkout
mkdir "$checkout" "$scratch/bin"
git -C "$root" ls-files -z | tar -C "$root" --null -T - -cf - | tar -C "$checkout" -xf -

export INSTALL_TEST_REAL_DOCKER="$real_docker" INSTALL_TEST_DIR="$scratch"
cat >"$scratch/bin/docker" <<'SHIM'
#!/usr/bin/env bash
set -euo pipefail
case " $* " in
  *" compose "*" run "*" package-stage "*|*" compose "*" run "*" soldeer-stage "*)
    printf '%s\n' "$COMPOSE_PROJECT_NAME" > "$INSTALL_TEST_DIR/project"
    printf '%s\n' "${PACKAGE_INPUT_DIR-}" > "$INSTALL_TEST_DIR/input"
    "$INSTALL_TEST_REAL_DOCKER" "$@"
    touch "$INSTALL_TEST_DIR/entered"
    for ((i=0; i<3000; i++)); do
      [[ -e "$INSTALL_TEST_DIR/release" ]] && exit 0
      sleep .1
    done
    printf '%s\n' 'Timed out waiting to release installer stage.' >&2
    exit 2 ;;
esac
exec "$INSTALL_TEST_REAL_DOCKER" "$@"
SHIM
cat >"$scratch/bin/bash" <<'SHIM'
#!/bin/bash
if [[ ${1-} == tools/compose_cleanup.sh ]]; then
  if /bin/bash "$@"; then result=0; else result=$?; fi
  printf '%s\n' "$result" > "$INSTALL_TEST_DIR/cleanup-status"
  exit "$result"
fi
exec /bin/bash "$@"
SHIM
chmod 0700 "$scratch/bin/docker" "$scratch/bin/bash"

blocker="dapp32-installer-test-$(printf '%s' "$scratch" | sha256sum | cut -c1-20)"
blocker_id=
first_pid=
project=
input=
cleanup() {
  status=$?
  trap - EXIT
  if (( status != 0 )); then
    for log in "$scratch/first.log" "$scratch/contender.log"; do
      if [[ -f $log ]]; then tail -30 "$log" >&2; fi
    done
  fi
  touch "$scratch/release"
  if [[ -n $first_pid ]]; then
    for ((i=0; i<300; i++)); do
      kill -0 "$first_pid" 2>/dev/null || break
      sleep .1
    done
    if kill -0 "$first_pid" 2>/dev/null; then
      printf 'Installer still running (PID %s); retain %s and its project for recovery.\n' "$first_pid" "$scratch" >&2
      exit 2
    fi
    wait "$first_pid" || :
  fi
  if [[ -n $blocker_id ]] && ! "$real_docker" --host "$endpoint" rm -f "$blocker_id" >/dev/null; then
    printf 'Cannot remove test container %s; retain %s and project %s for recovery.\n' "$blocker_id" "$scratch" "$project" >&2
    exit 2
  fi
  if [[ -z $project && -f $scratch/project ]]; then project=$(cat "$scratch/project"); fi
  if [[ -z $input && -f $scratch/input ]]; then input=$(cat "$scratch/input"); fi
  if [[ -n $project ]]; then
    case "$project" in
      dapp32-package-deps-*) file=compose/package-deps.yml ;;
      dapp32-solidity-deps-*) file=compose/deps.yml ;;
      *) printf 'Unexpected project %s; retain %s for inspection.\n' "$project" "$scratch" >&2; exit 2 ;;
    esac
    if ! (cd "$checkout" && CAM_DOCKER_ENDPOINT="$endpoint" COMPOSE_PROJECT_NAME="$project" \
      PACKAGE_INPUT_DIR="$input" ALLOW_UPDATE=0 LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)" \
      bash tools/compose_cleanup.sh "$project" --rmi local -- docker --host "$endpoint" compose -f "$file"); then
      printf 'Cleanup failed for %s; retain %s and input %s.\n' "$project" "$scratch" "$input" >&2
      exit 2
    fi
  fi
  if [[ -n $input && -e $input ]]; then
    [[ $input == /tmp/tmp.* && -d $input && ! -L $input && -O $input ]] || { printf 'Unsafe retained input path: %s\n' "$input" >&2; exit 2; }
    rm -rf -- "$input"
  fi
  rm -rf -- "$scratch"
  if (( status == 0 )); then printf 'PASS %s installer exclusion and owned cleanup\n' "$mode"; fi
  exit "$status"
}
trap cleanup EXIT

run_pair() {
  local first=$1 first_kind=$2 contender network image
  rm -f "$scratch/entered" "$scratch/release" "$scratch/project" "$scratch/input"
  project= input=
  (cd "$checkout" && PATH="$scratch/bin:$PATH" timeout --kill-after=15s 600s make --no-print-directory "$first" DOCKER_CONTEXT= CAM_DOCKER_ENDPOINT="$endpoint") >"$scratch/first.log" 2>&1 &
  first_pid=$!
  for ((i=0; i<3600; i++)); do
    [[ -e $scratch/entered ]] && break
    kill -0 "$first_pid" 2>/dev/null || { cat "$scratch/first.log" >&2; return 2; }
    sleep .1
  done
  [[ -e $scratch/entered ]] || { printf '%s\n' 'Installer did not reach its completed staging step.' >&2; return 2; }
  project=$(cat "$scratch/project")
  input=$(cat "$scratch/input")
  census() {
    "$real_docker" --host "$endpoint" container ls -aq --filter "label=com.docker.compose.project=$project" | sort
    "$real_docker" --host "$endpoint" network ls -q --filter "label=com.docker.compose.project=$project" | sort
    "$real_docker" --host "$endpoint" volume ls -q --filter "label=com.docker.compose.project=$project" | sort
  }
  census > "$scratch/resources-before"
  for contender in js/deps/install dapps/deps/install; do
    if (cd "$checkout" && PATH="$scratch/bin:$PATH" make --no-print-directory "$contender" DOCKER_CONTEXT= CAM_DOCKER_ENDPOINT="$endpoint") >"$scratch/contender.log" 2>&1; then
      printf 'Concurrent %s unexpectedly succeeded.\n' "$contender" >&2; return 2
    fi
    grep -Fq 'Dependency install lock is busy.' "$scratch/contender.log"
    census > "$scratch/resources-after"
    cmp "$scratch/resources-before" "$scratch/resources-after"
  done
  if [[ $first_kind == package ]]; then
    network="${project}_package_internal"
    image="${project}-package-egress-proxy:latest"
  else
    network="${project}_deps_internal"
    image="${project}-dependency-egress-proxy:latest"
  fi
  blocker_id=$("$real_docker" --host "$endpoint" create --pull never --name "$blocker" \
      --label "com.docker.compose.project=$blocker" \
      --network "$network" --read-only --cap-drop ALL --security-opt no-new-privileges:true \
      --user "$(id -u):$(id -g)" --pids-limit 16 --memory 32m --entrypoint python3 \
      "$image" \
      -c 'import time; time.sleep(600)')
  [[ $("$real_docker" --host "$endpoint" inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$blocker_id") == "$blocker" ]]
  "$real_docker" --host "$endpoint" start "$blocker_id" >/dev/null
  if [[ $first_kind == package ]]; then
    # Change only the disposable checkout after staging, so the real apply
    # rejects its now-different lock while teardown is independently blocked.
    printf '\n' >> "$checkout/js/package-lock.json"
  fi
  touch "$scratch/release"
  if wait "$first_pid"; then
    printf '%s\n' 'Obstructed teardown unexpectedly succeeded.' >&2; return 2
  else
    if [[ $first_kind == package ]]; then
      grep -Fq 'package-apply-locked: package-lock.json would change' "$scratch/first.log"
      grep -Fq 'JavaScript dependency cleanup incomplete' "$scratch/first.log"
      grep -Fq "Retained staging inputs: $input" "$scratch/first.log"
      grep -Fq 'Error 2' "$scratch/first.log"
      # The real cleanup helper returned 1, so Make's reported 2 is the apply error.
      [[ $(cat "$scratch/cleanup-status") == 1 ]]
      [[ -d $input ]]
    else
      grep -Fq 'Solidity dependency cleanup incomplete' "$scratch/first.log"
      [[ -f $checkout/dapps/soldeer.lock ]]
    fi
    grep -Fq "Cleanup left network resources owned by $project" "$scratch/first.log"
    [[ -n $("$real_docker" --host "$endpoint" network ls -q --filter "label=com.docker.compose.project=$project") ]]
  fi
  first_pid=
}

case "$mode" in
  package) run_pair js/deps/install package ;;
  solidity) run_pair dapps/deps/install solidity ;;
  *) printf 'Unknown installer test mode: %s\n' "$mode" >&2; exit 2 ;;
esac
