#!/usr/bin/env bash
# Owned host processes for release lanes. Callers own EXIT cleanup and resources.

release_process_init() {
  command -v setsid >/dev/null || {
    printf '%s\n' 'Release commands require setsid for owned process cleanup.' >&2
    return 2
  }
  # Keep PID == PGID when a background child execs setsid without a wrapper.
  set +m
  # These are internal lifecycle slots, not optional operator environment inputs.
  declare -g release_owned_pid=""
  release_owned_grace=15
  release_command_grace=15
  # Nested release commands own several bounded teardowns before they can exit.
  release_make_cleanup_grace=330
  release_owned_reaped=0
  declare -g release_process_child_status=""
  release_process_spawning=0
  release_process_signal=0
  release_process_cleaning=0
  declare -g release_progress_phase=""
  exec {release_process_stdout}>&1 {release_process_stderr}>&2
  trap 'release_process_cancel 130' INT
  trap 'release_process_cancel 143' TERM
  trap 'release_process_cancel 129' HUP
}

release_process_report() {
  # The caller supplies a fixed phase label, not command arguments or secrets.
  # A detached terminal must not interrupt the independent cleanup operation.
  if ! printf '[release +%ss] %s\n' "$SECONDS" "$1" >&"$release_process_stderr"; then
    return 0
  fi
}

release_process_cancel() {
  if [[ "$release_process_signal" == 0 ]]; then release_process_signal="$1"; fi
  # Do not lose a new child's identity if a signal arrives before $! is saved.
  if [[ "$release_process_spawning" == 0 && "$release_process_cleaning" == 0 ]]; then
    exit "$release_process_signal"
  fi
}

release_process_alive() {
  kill -0 "$release_owned_pid" 2>/dev/null ||
    kill -0 -- "-$release_owned_pid" 2>/dev/null
}

release_process_kill() {
  # The PID fallback covers cancellation before the child has entered setsid.
  if ! kill "-$1" -- "-$release_owned_pid" 2>/dev/null &&
      ! kill "-$1" "$release_owned_pid" 2>/dev/null; then
    # An exit racing the signal already satisfies shutdown. A still-live child
    # is reported and remains owned until release_stop_owned checks/reaps it.
    if release_process_alive; then
      release_process_report 'Could not signal an owned command; shutdown remains unconfirmed'
    fi
  fi
}

release_stop_owned() {
  local started failed=0 status=0 next_report
  if [[ -z "$release_owned_pid" ]]; then return 0; fi
  if release_process_alive; then
    release_process_report 'Stopping an owned command before resource teardown'
    release_process_kill TERM
    started="$SECONDS"
    next_report=$((SECONDS + 5))
    while release_process_alive; do
      if (( SECONDS - started >= release_owned_grace )); then
        release_process_kill KILL
        failed=1
        break
      fi
      if (( SECONDS >= next_report )); then
        release_process_report 'Waiting for owned-command cleanup'
        next_report=$((SECONDS + 5))
      fi
      sleep 0.1
    done
  fi
  if [[ "$release_owned_reaped" == 1 ]]; then
    status="$release_process_child_status"
  else
    wait "$release_owned_pid" 2>/dev/null || status=$?
  fi
  release_process_child_status="$status"
  if kill -0 -- "-$release_owned_pid" 2>/dev/null; then failed=1; fi
  declare -g release_owned_pid=""
  release_owned_reaped=0
  # Child status 2 means an inner release owner retained mounted inputs.
  case "$status" in 0|129|130|143) ;; *) failed=1 ;; esac
  if [[ "$failed" != 0 ]]; then
    printf '%s\n' 'An owned release command did not finish cleanly; retain its mounted inputs.' >&2
  fi
  return "$failed"
}

release_process_cleanup_begin() {
  release_process_cleaning=1
  release_progress_phase='resource cleanup'
  trap - EXIT
  trap '' INT TERM HUP
  # An EXIT trap can run inside a caller's command-specific log redirection.
  exec 1>&"$release_process_stdout" 2>&"$release_process_stderr"
  release_stop_owned
}

release_run_owned() {
  local grace="$1" status=0 started remaining timed_out=0 next_report
  shift
  if [[ ! "$grace" =~ ^[1-9][0-9]*$ || $# == 0 || -n "$release_owned_pid" ]]; then
    printf '%s\n' 'Invalid or nested owned release command.' >&2
    return 2
  fi
  release_owned_grace="$grace"
  release_owned_reaped=0
  declare -g release_process_child_status=""
  release_process_spawning=1
  # Noninteractive Bash has job control off: setsid execs with PID == PGID.
  # Explicit stdin preserves piped credentials and caller-owned terminal input.
  setsid "$@" <&0 &
  release_owned_pid=$!
  release_process_spawning=0
  if [[ "$release_process_signal" != 0 && "$release_process_cleaning" == 0 ]]; then
    exit "$release_process_signal"
  fi
  started="$SECONDS"
  next_report=$((SECONDS + 5))
  if [[ "$release_process_cleaning" == 1 || -n "$release_progress_phase" ]]; then
    # Teardown is bounded. Ordinary work retains its caller's existing timeout;
    # this loop only supplies progress and does not change signal ownership.
    while kill -0 "$release_owned_pid" 2>/dev/null; do
      if [[ "$release_process_cleaning" == 1 ]] && (( SECONDS - started >= grace )); then
        release_process_kill KILL
        timed_out=1
        break
      fi
      if (( SECONDS >= next_report )); then
        release_process_report "Still working: $release_progress_phase"
        next_report=$((SECONDS + 5))
      fi
      sleep 0.1
    done
  fi
  wait "$release_owned_pid" || status=$?
  release_owned_reaped=1
  release_process_child_status="$status"
  if [[ "$timed_out" == 1 ]]; then status=124; fi
  if kill -0 -- "-$release_owned_pid" 2>/dev/null; then
    # Do not leave a Compose plugin running after its parent CLI has exited.
    if [[ "$release_process_cleaning" == 1 ]]; then
      remaining=$((grace - (SECONDS - started)))
      if (( remaining < 0 )); then remaining=0; fi
      release_owned_grace="$remaining"
    fi
    if ! release_stop_owned; then status=1; fi
  else
    declare -g release_owned_pid=""
    release_owned_reaped=0
  fi
  return "$status"
}
