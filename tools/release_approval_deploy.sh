#!/usr/bin/env bash
# Sourced by the shared Make release path after its archived source and inputs are selected.

source "$(dirname -- "${BASH_SOURCE[0]}")/release_approval_preflight.sh"

release_approval_service_id() {
  local service="$1" identity
  identity="$(compose_release ps -a -q "$service")" || return
  if [[ ! "$identity" =~ ^[0-9a-f]{64}$ ]]; then
    printf 'Cannot identify one %s container in this release ceremony.\n' "$service" >&2
    return 1
  fi
  printf '%s\n' "$identity"
}

release_approval_wait_service() {
  local service="$1" seconds="$2" identity result
  identity="$(release_approval_service_id "$service")" || return
  if ! result="$(timeout --foreground "$seconds" docker wait "$identity")"; then
    printf 'Timed out or failed waiting for %s; its effect state may be uncertain.\n' "$service" >&2
    return 1
  fi
  if [[ ! "$result" =~ ^[0-9]+$ || "$result" != 0 ]]; then
    printf '%s exited unsuccessfully (%s).\n' "$service" "$result" >&2
    return 1
  fi
}

release_approval_snapshot_digest() {
  local identity line found="" value
  identity="$(release_approval_service_id release-reference-prepare)" || return
  while IFS= read -r line; do
    if [[ "$line" == *'"event":"release_approval_reference_prepared"'* ]]; then
      if [[ -n "$found" || ! "$line" =~ \"snapshotSha256\":\"(0x[0-9a-f]{64})\" ]]; then
        printf '%s\n' 'Reference preparation emitted an ambiguous digest.' >&2
        return 1
      fi
      value="${BASH_REMATCH[1]}"
      found="$value"
    fi
  done < <(docker logs "$identity" 2>&1)
  if [[ -z "$found" ]]; then
    printf '%s\n' 'Reference preparation did not report its digest.' >&2
    return 1
  fi
  printf '%s\n' "$found"
}

release_approval_show_startup() {
  local identity="$1" started="$SECONDS" output
  while (( SECONDS - started < 30 )); do
    if ! output="$(docker logs --tail 16 "$identity" 2>&1)"; then
      printf '%s\n' 'Could not read the approval service startup display.' >&2
      return 1
    fi
    if [[ "$output" == *'Type start and press Enter to open the approval socket.'* ]]; then
      if (( ${#output} > 8192 )) || [[ "$output" != *'Release approval'* ||
            "$output" != *'  App:'* || "$output" != *'  Chain ID:'* ||
            "$output" != *'  Deployer:'* || "$output" != *'  Source commit:'* ||
            "$output" != *'  Reference SHA-256:'* ]]; then
        printf '%s\n' 'Approval service startup display is incomplete or too large.' >&2
        return 1
      fi
      printf '%s\n' "$output"
      return 0
    fi
    if [[ "$(docker inspect --format '{{.State.Running}}' "$identity")" != true ]]; then
      printf '%s\n' 'Approval service exited before showing the operator start prompt.' >&2
      return 1
    fi
    sleep 0.2
  done
  printf '%s\n' 'Approval service did not show its startup prompt within 30 seconds.' >&2
  return 1
}

release_approval_prepare() {
  local app="$1" expected_deployer="$2" source="$3" chain="$4" output="$5"
  local app_prefix expected_name
  app_prefix="${app^^}"; app_prefix="${app_prefix//-/_}"
  expected_name="${app_prefix}_RELEASE_EXPECTED_DEPLOYER_ADDRESS"
  release_approval_require_deployer "$expected_name" "$expected_deployer"
  if [[ ! "$chain" =~ ^[1-9][0-9]*$ || ! "$source" =~ ^[0-9a-f]{40}$ ]]; then
    printf '%s\n' 'Release chain or source commit is invalid.' >&2
    return 2
  fi
  RELEASE_APPROVAL_APP="$app"
  RELEASE_APPROVAL_DEPLOYER="$expected_deployer"
  RELEASE_APPROVAL_CHAIN_ID="$chain"
  RELEASE_APPROVAL_SOURCE_COMMIT="$source"
  RELEASE_APPROVAL_ARTIFACTS_DIR="$output/approval-artifacts"
  RELEASE_APPROVAL_REFERENCE_DIR="$output/approval-reference"
  RELEASE_APPROVAL_REFERENCE_FILE="$RELEASE_APPROVAL_REFERENCE_DIR/reference.json"
  RELEASE_APPROVAL_AUDIT_DIR="$output/approval-audit"
  RELEASE_APPROVAL_SOCKET_DIR="$ceremony_root/socket"
  export RELEASE_APPROVAL_APP RELEASE_APPROVAL_DEPLOYER RELEASE_APPROVAL_CHAIN_ID RELEASE_APPROVAL_SOURCE_COMMIT
  export RELEASE_APPROVAL_ARTIFACTS_DIR RELEASE_APPROVAL_REFERENCE_DIR RELEASE_APPROVAL_REFERENCE_FILE
  export RELEASE_APPROVAL_AUDIT_DIR RELEASE_APPROVAL_SOCKET_DIR
  mkdir --mode=0700 -- "$RELEASE_APPROVAL_ARTIFACTS_DIR" "$RELEASE_APPROVAL_REFERENCE_DIR" "$RELEASE_APPROVAL_AUDIT_DIR" "$RELEASE_APPROVAL_SOCKET_DIR"
  compose_release up -d --build release-reference-prepare
  release_approval_wait_service release-reference-prepare 720
  if [[ ! -f "$output/plan/release-plan.json" || -L "$output/plan/release-plan.json" ||
        ! -f "$RELEASE_APPROVAL_REFERENCE_FILE" || -L "$RELEASE_APPROVAL_REFERENCE_FILE" ]]; then
    printf '%s\n' 'Release plan or approval reference was not produced as a regular file.' >&2
    return 1
  fi
  RELEASE_APPROVAL_PLAN_SHA256="0x$(sha256sum "$output/plan/release-plan.json" | cut -d ' ' -f 1)"
  RELEASE_APPROVAL_REFERENCE_SHA256="$(release_approval_snapshot_digest)"
  export RELEASE_APPROVAL_PLAN_SHA256 RELEASE_APPROVAL_REFERENCE_SHA256
  chmod 0400 -- "$RELEASE_APPROVAL_REFERENCE_FILE"
  chmod 0500 -- "$RELEASE_APPROVAL_REFERENCE_DIR"
  release_phase_overlays+=(-f "$ceremony_source/compose/release/approval.yml")
  # These are ordinary candidate-dependent images. The approval image is never in this build list.
  compose_release build release-rpc-proxy deploy-release release-artifact-rpc-proxy release-artifact
}

release_approval_run() {
  local output="$1" gate_id attach_status=0 forge_status="" gate_status=""
  local supervisor_pid
  compose_release up -d --no-build release-approval
  gate_id="$(release_approval_service_id release-approval)" || return
  release_approval_show_startup "$gate_id"

  (
    local code forge_id started="$SECONDS"
    release_approval_controller_cleanup() {
      local status="$?" cleanup_failed=0
      trap - EXIT
      if [[ ! -f "$output/forge-exit-code" ]]; then
        if ! printf '%s\n' unknown > "$output/forge-exit-code"; then cleanup_failed=1; fi
        if ! compose_release stop --timeout 10 deploy-release >/dev/null; then
          printf '%s\n' 'Could not stop the release signer after approval startup failed.' >&2
          cleanup_failed=1
        fi
      fi
      if ! compose_release stop --timeout 10 release-approval >/dev/null; then
        printf '%s\n' 'Could not stop release approval after the signer ended.' >&2
        cleanup_failed=1
      fi
      if [[ "$cleanup_failed" != 0 && "$status" == 0 ]]; then status=1; fi
      exit "$status"
    }
    trap release_approval_controller_cleanup EXIT
    until [[ -S "$RELEASE_APPROVAL_SOCKET_DIR/rpc.sock" ]]; do
      if (( SECONDS - started >= 300 )) || [[ "$(docker inspect --format '{{.State.Running}}' "$gate_id")" != true ]]; then
        printf '%s\n' 'Approval did not receive an operator start on the attached terminal.' >&2
        exit 1
      fi
      sleep 0.2
    done
    if ! compose_release up -d --no-build --wait --wait-timeout 30 release-approval; then exit 1; fi
    if ! compose_release up -d --no-build deploy-release; then exit 1; fi
    forge_id="$(release_approval_service_id deploy-release)" || exit
    if code="$(timeout --foreground 900 docker wait "$forge_id")" && [[ "$code" =~ ^[0-9]+$ ]]; then
      printf '%s\n' "$code" > "$output/forge-exit-code"
    else
      printf '%s\n' unknown > "$output/forge-exit-code"
      if ! compose_release stop --timeout 10 deploy-release >/dev/null; then
        printf '%s\n' 'Could not stop the signer after its wait failed; deployment effect state is uncertain.' >&2
        exit 1
      fi
    fi
  ) &
  supervisor_pid=$!
  if ! compose_release attach release-approval; then attach_status=1; fi
  if [[ ! -f "$output/forge-exit-code" ]]; then
    printf '%s\n' 'Approval terminal ended while Forge was still running; closing the signer.' >&2
    if ! compose_release stop --timeout 10 deploy-release release-approval >/dev/null; then
      printf '%s\n' 'Could not stop every release process; cleanup is incomplete.' >&2
    fi
    attach_status=1
  fi
  wait "$supervisor_pid" || attach_status=1
  compose_release logs --no-color --no-log-prefix deploy-release > "$output/deploy.log" 2>&1 || attach_status=1
  forge_status="$(cat "$output/forge-exit-code")"
  gate_status="$(docker inspect --format '{{.State.ExitCode}}' "$gate_id")"
  if [[ "$attach_status" != 0 || "$forge_status" != 0 || "$gate_status" != 0 ]]; then
    printf 'Release stopped before artifact creation. Forge: %s; approval: %s. Review broadcast and approval audit for possible earlier effects.\n' "$forge_status" "$gate_status" >&2
    return 1
  fi
  compose_release up -d --no-build --wait release-artifact-rpc-proxy
  compose_release run --rm --no-deps -T release-artifact
}
