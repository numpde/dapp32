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
  if ! release_run_owned "$release_command_grace" timeout --foreground "$seconds" docker wait "$identity" \
      > "$ceremony_root/service-exit-code"; then
    printf 'Timed out or failed waiting for %s; its effect state may be uncertain.\n' "$service" >&2
    return 1
  fi
  result="$(<"$ceremony_root/service-exit-code")"
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
  compose_release up -d --no-build release-reference-prepare
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
  # Candidate source is mounted into the selected immutable tool images.
  # The approval image remains independently selected by the operator.
}

# Only the owning launcher may start services. These internal lifecycle slots
# remain visible to EXIT cleanup even if release_approval_run returns early.
declare -g release_approval_attach_pid=""
declare -g release_approval_terminal_state=""
declare -g release_approval_output=""

release_approval_restore_terminal() {
  if [[ -n "$release_approval_terminal_state" ]]; then
    if [[ -t 0 ]] && ! stty "$release_approval_terminal_state"; then
      printf '%s\n' 'Could not restore the approval terminal settings.' >&2
      return 1
    fi
    declare -g release_approval_terminal_state=""
  fi
}

release_approval_retain_signer_log() {
  local output="$1"
  if ! (umask 077; compose_release logs --no-color --no-log-prefix deploy-release > "$output/deploy.log" 2>&1); then
    printf 'Could not retain complete signer diagnostics at %s/deploy.log.\n' "$output" >&2
    return 1
  fi
}

release_approval_retain_diagnostics() {
  local identity path="$release_approval_output/approval-diagnostics.log"
  identity="$(compose_release ps -a -q release-approval)" || return 1
  if [[ -z "$identity" ]]; then return 0; fi
  if [[ ! "$identity" =~ ^[0-9a-f]{64}$ ]]; then return 1; fi
  if ! (
    umask 077
    set -o noclobber
    (
      failed=0
      printf '%s\n' 'Approval diagnostics: first 65536 bytes; excerpt may be truncated.'
      timeout --kill-after=1s 5s docker inspect --format 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' "$identity" || failed=1
      timeout --kill-after=1s 5s docker logs --tail 80 "$identity" || failed=1
      exit "$failed"
    ) 2>&1 | { head -c 65536 && cat >/dev/null; } > "$path"
  ); then
    return 1
  fi
  printf 'Approval diagnostics retained at %s\n' "$path" >&2
}

release_approval_cleanup() {
  local failed=0 started attach_status=0
  if [[ -n "$release_approval_output" ]] && ! release_approval_retain_diagnostics; then
    printf 'Could not fully retain approval diagnostics at %s/approval-diagnostics.log; continuing resource cleanup.\n' "$release_approval_output" >&2
  fi
  if [[ -z "$release_approval_attach_pid" ]]; then
    release_approval_restore_terminal
    # Bash 5.2 can make a bare return reuse the failing command's EXIT-trap status.
    return "$?"
  fi
  # Stop containers before joining their attachment. Nothing in the background
  # has authority to start a replacement signer after this point.
  if ! compose_release stop --timeout 10 deploy-release release-approval >/dev/null; then
    printf '%s\n' 'Could not stop every release process; cleanup is incomplete.' >&2
    failed=1
  fi
  if kill -0 "$release_approval_attach_pid" 2>/dev/null; then
    # A process exiting between the liveness check and signal needs no signal.
    if ! kill -TERM "$release_approval_attach_pid" 2>/dev/null &&
        kill -0 "$release_approval_attach_pid" 2>/dev/null; then
      printf '%s\n' 'Could not terminate the owned approval attachment.' >&2
      failed=1
    fi
    started="$SECONDS"
    while kill -0 "$release_approval_attach_pid" 2>/dev/null; do
      if (( SECONDS - started >= 5 )); then
        if ! kill -KILL "$release_approval_attach_pid" 2>/dev/null &&
            kill -0 "$release_approval_attach_pid" 2>/dev/null; then
          printf '%s\n' 'Could not forcibly stop the owned approval attachment.' >&2
          failed=1
        fi
        break
      fi
      sleep 0.1
    done
  fi
  wait "$release_approval_attach_pid" 2>/dev/null || attach_status=$?
  # Rejection or cancellation can legitimately give docker attach a nonzero
  # status. Reaping it is cleanup, not evidence that deployment succeeded.
  if [[ "$attach_status" != 0 ]]; then
    printf 'Approval attachment ended with status %s during cleanup.\n' "$attach_status" >&2
    if [[ "$attach_status" == 127 ]]; then failed=1; fi
  fi
  declare -g release_approval_attach_pid=""
  if ! release_approval_restore_terminal; then failed=1; fi
  if [[ -n "$release_approval_output" ]]; then
    if [[ ! -f "$release_approval_output/forge-exit-code" ]]; then
      printf '%s\n' unknown > "$release_approval_output/forge-exit-code" || failed=1
    fi
    release_approval_retain_signer_log "$release_approval_output" || failed=1
  fi
  return "$failed"
}

release_approval_attachment_running() {
  if ! kill -0 "$release_approval_attach_pid" 2>/dev/null; then
    printf '%s\n' 'Approval terminal ended; cancelling this release. Review broadcast and approval audit for possible earlier effects.' >&2
    return 1
  fi
}

release_approval_run() {
  local output="$1" gate_id forge_id started state attach_status=0 forge_status="" gate_status=""
  release_approval_output="$output"
  # The plan already ran to produce the reference. Never restart a completed
  # predecessor or an approval service that the operator has cancelled.
  compose_release up -d --no-build --no-deps --wait --wait-timeout 30 release-rpc-proxy
  compose_release up -d --no-build --no-deps release-approval
  gate_id="$(release_approval_service_id release-approval)" || return
  release_approval_show_startup "$gate_id"

  release_approval_terminal_state="$(stty -g)"
  # Explicit stdin avoids Bash's asynchronous /dev/null default. A PTY caller
  # need not have a /dev/tty controlling terminal.
  release_process_spawning=1
  docker attach "$gate_id" <&0 &
  release_approval_attach_pid=$!
  release_process_spawning=0
  if [[ "$release_process_signal" != 0 ]]; then exit "$release_process_signal"; fi

  started="$SECONDS"
  until [[ -S "$RELEASE_APPROVAL_SOCKET_DIR/rpc.sock" ]]; do
    release_approval_attachment_running || return
    if (( SECONDS - started >= 300 )) || [[ "$(docker inspect --format '{{.State.Running}}' "$gate_id")" != true ]]; then
      printf '%s\n' 'Approval did not receive an operator start on the attached terminal.' >&2
      return 1
    fi
    sleep 0.2
  done

  started="$SECONDS"
  until [[ "$(docker inspect --format '{{.State.Health.Status}}' "$gate_id")" == healthy ]]; do
    release_approval_attachment_running || return
    if (( SECONDS - started >= 30 )) || [[ "$(docker inspect --format '{{.State.Running}}' "$gate_id")" != true ]]; then
      printf '%s\n' 'Approval ended or failed to become ready after operator start.' >&2
      return 1
    fi
    sleep 0.2
  done
  release_approval_attachment_running || return
  compose_release up -d --no-build --no-deps deploy-release
  forge_id="$(release_approval_service_id deploy-release)" || return

  started="$SECONDS"
  while true; do
    state="$(docker inspect --format '{{.State.Status}} {{.State.ExitCode}}' "$forge_id")" || return
    if [[ "$state" =~ ^exited\ ([0-9]+)$ ]]; then
      read -r state forge_status <<< "$state"
      printf '%s\n' "$forge_status" > "$output/forge-exit-code"
      break
    fi
    release_approval_attachment_running || return
    if (( SECONDS - started >= 900 )) || [[ "$state" != running\ * ]]; then
      printf '%s\n' unknown > "$output/forge-exit-code"
      printf '%s\n' 'Signer did not finish; deployment effect state may be uncertain.' >&2
      return 1
    fi
    sleep 0.5
  done
  if [[ "$forge_status" != 0 ]]; then
    printf 'Deployment signer failed (exit %s). Forge diagnostics: %s/deploy.log\n' "$forge_status" "$output" >&2
  fi
  if ! release_approval_retain_signer_log "$output"; then attach_status=1; fi
  compose_release stop --timeout 10 release-approval >/dev/null
  started="$SECONDS"
  while kill -0 "$release_approval_attach_pid" 2>/dev/null; do
    if (( SECONDS - started >= 10 )); then
      printf '%s\n' 'Approval attachment did not finish after the signer ended.' >&2
      return 1
    fi
    sleep 0.1
  done
  wait "$release_approval_attach_pid" || attach_status=$?
  declare -g release_approval_attach_pid=""
  release_approval_restore_terminal
  gate_status="$(docker inspect --format '{{.State.ExitCode}}' "$gate_id")"
  if [[ "$attach_status" != 0 || "$forge_status" != 0 || "$gate_status" != 0 ]]; then
    printf 'Release stopped before artifact creation. Forge: %s; approval: %s. Review broadcast and approval audit for possible earlier effects.\n' "$forge_status" "$gate_status" >&2
    return 1
  fi
  compose_release up -d --no-build --no-deps --wait release-artifact-rpc-proxy
  compose_release run --rm --no-deps -T release-artifact
}
