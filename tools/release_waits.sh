#!/usr/bin/env bash
# Called only from the snapshotted, disposable release rehearsal.
set -euo pipefail
if [[ "${RELEASE_REHEARSAL:?missing fixture mode}" != 1 || "${DAPP:?missing fixture app}" != escrow ]]; then
  printf '%s\n' 'Release wait tests require the isolated Escrow rehearsal.' >&2; exit 2
fi
project="${1:?missing fixture project}-waits"
export RELEASE_WAIT_CASE=delay-10
export RELEASE_OUTPUT_DIR="$RELEASE_REHEARSAL_DIR/waits-plan"
export RELEASE_WAIT_EVIDENCE_DIR="$RELEASE_REHEARSAL_DIR/waits-plan/evidence"
mkdir --mode=0700 "$RELEASE_OUTPUT_DIR" "$RELEASE_OUTPUT_DIR/plan" "$RELEASE_OUTPUT_DIR/broadcast" "$RELEASE_OUTPUT_DIR/artifact" "$RELEASE_WAIT_EVIDENCE_DIR"
compose=(docker compose --project-name "$project" -f compose/release/deploy.yml -f compose/escrow/release/deploy.yml -f compose/release/rehearsal-deploy.yml -f compose/release/rehearsal-waits.yml)
infrastructure=(docker compose --project-name "${1}" -f compose/release/rehearsal.yml)
cleanup() {
  status="$?"
  trap - EXIT
  if ! "${compose[@]}" down --rmi local --volumes --remove-orphans >>"$RELEASE_REHEARSAL_DIR/waits-cleanup.log" 2>&1; then
    printf 'Wait fixture teardown failed; inspect %s/waits-cleanup.log\n' "$RELEASE_REHEARSAL_DIR" >&2
    exit 2
  fi
  exit "$status"
}
trap cleanup EXIT
timeout --foreground 360 "${compose[@]}" run --build --rm --no-deps -T release-plan >"$RELEASE_REHEARSAL_DIR/waits-plan.log" 2>&1
plan="$RELEASE_OUTPUT_DIR/plan/release-plan.json"
setup_case() {
  timeout --foreground 120 "${infrastructure[@]}" up --no-deps --force-recreate --wait --wait-timeout 90 release-anvil >"$RELEASE_OUTPUT_DIR/reset.log" 2>&1 || return 2
  timeout --foreground 180 "${infrastructure[@]}" run --build --rm --no-deps -T -e REHEARSAL_ACTION=fund rehearsal-prepare >>"$RELEASE_OUTPUT_DIR/reset.log" 2>&1 || return 2
  "${compose[@]}" config --format json >"$RELEASE_OUTPUT_DIR/compose.json" || return 2
  timeout --foreground 120 "${compose[@]}" up --build --no-deps --detach --wait --wait-timeout 30 release-rpc-proxy >"$RELEASE_OUTPUT_DIR/proxy.log" 2>&1 || return 2
}
result=0
for case_name in delay-10 delay-50 delay-120 receipt reject drop; do
  printf 'Release wait qualification: %s\n' "$case_name"
  export RELEASE_WAIT_CASE="$case_name"
  export RELEASE_OUTPUT_DIR="$RELEASE_REHEARSAL_DIR/waits-$case_name"
  export RELEASE_WAIT_EVIDENCE_DIR="$RELEASE_OUTPUT_DIR/evidence"
  mkdir --mode=0700 "$RELEASE_OUTPUT_DIR" "$RELEASE_OUTPUT_DIR/plan" "$RELEASE_OUTPUT_DIR/broadcast" "$RELEASE_OUTPUT_DIR/artifact" "$RELEASE_WAIT_EVIDENCE_DIR"
  cp -- "$plan" "$RELEASE_OUTPUT_DIR/plan/release-plan.json"
  case_status=2
  if setup_case; then
    forge_status=0
    timeout --foreground 360 "${compose[@]}" run --build --no-deps -T --name "$project-$case_name-signer" deploy-release >"$RELEASE_OUTPUT_DIR/forge.log" 2>&1 || forge_status="$?"
    if docker inspect --format '{{.Id}} {{.Image}} {{json .Config.Cmd}}' "$project-$case_name-signer" >"$RELEASE_OUTPUT_DIR/signer-identity.txt"; then
      case_status=0
      timeout --foreground 180 "${compose[@]}" exec -T release-rpc-proxy python3 /rehearsal/wait_probe.py check "$forge_status" >"$RELEASE_OUTPUT_DIR/result.log" 2>&1 || case_status="$?"
      cat "$RELEASE_OUTPUT_DIR/result.log"
    fi
  fi
  if [[ "$case_status" != 0 && "$case_status" != 1 ]]; then
    printf '{"case":"%s","outcome":"inconclusive","reason":"Fixture setup, inspection or checker failed; inspect case logs"}\n' "$case_name" | tee "$RELEASE_WAIT_EVIDENCE_DIR/infrastructure-failure.json"
  fi
  if [[ "$case_status" != 0 ]]; then result=1; fi
  if ! "${compose[@]}" logs --no-color release-rpc-proxy >"$RELEASE_OUTPUT_DIR/proxy-events.log" 2>&1; then
    printf 'Could not capture proxy logs for %s.\n' "$case_name" >&2
    result=1
  fi
  "${compose[@]}" down --rmi local --volumes --remove-orphans >>"$RELEASE_REHEARSAL_DIR/waits-cleanup.log" 2>&1
done
printf 'Release wait observations: %s/waits-*/evidence/result.json\n' "$RELEASE_REHEARSAL_DIR"
exit "$result"
