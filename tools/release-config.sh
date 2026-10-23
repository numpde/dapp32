# Host filesystem admission and lifecycle for the shared release configuration.
# Sourced by Make after its existing release path guards have been defined.

unset release_config_dir release_config_input
release_config_started=0
release_setup_rpc_started=0

release_config_teardown() {
  local previous_grace="$release_command_grace" failed=0
  release_command_grace=60
  if [[ "$release_setup_rpc_started" == 1 ]]; then
    if ! compose_release_setup_rpc down --timeout 10 --volumes --remove-orphans >/dev/null; then
      printf '%s\n' 'RPC discovery teardown failed; retaining mounted inputs.' >&2
      failed=1
    else release_setup_rpc_started=0; fi
  fi
  if [[ "$release_config_started" == 1 ]] && ! compose_release_config down --timeout 10 --volumes --remove-orphans >/dev/null; then
    printf '%s\n' 'Release configuration teardown failed; retaining mounted inputs.' >&2
    failed=1
  else
    release_config_started=0
  fi
  release_command_grace="$previous_grace"
  return "$failed"
}

release_config_cleanup() {
  if [[ -v release_config_dir && -n "$release_config_dir" ]]; then
    rm -f -- "$release_config_dir/inputs" "$release_config_dir/rpc-url" "$release_config_dir/deployer-key" "$release_config_dir/release.json" "$release_config_dir/approval-images" \
      "$release_config_dir/setup-network" "$release_config_dir/setup-approval-image" "$release_config_dir/setup-rpc-url" "$release_config_dir/chain-id" "$release_config_dir/images-setup-rpc.yml" || return "$?"
    rmdir -- "$release_config_dir" || return "$?"
    unset release_config_dir
  fi
}

release_config_probe_chain() {
  local repository="$1" source_commit="$2" rpc_log
  release_run_owned "$release_command_grace" bash "$repository/tools/release_tool_images.sh" network "$repository" "$source_commit" "$release_config_dir"
  rpc_log=$(mktemp -- "$CONFIG.setup-rpc-XXXXXXXX")
  printf '%s\n' 'Checking the RPC chain ID before requesting the signing key.'
  release_setup_rpc_started=1
  if compose_release_setup_rpc up -d --no-build --wait --wait-timeout 30 rpc-proxy > "$rpc_log" 2>&1 &&
      (umask 077; compose_release_setup_rpc run --rm --no-deps -T rpc-chain-read > "$release_config_dir/chain-id" 2>> "$rpc_log"); then
    if ! compose_release_setup_rpc down --timeout 10 --volumes --remove-orphans >> "$rpc_log" 2>&1; then
      printf 'RPC discovery teardown failed. Diagnostics: %s\n' "$rpc_log" >&2
      return 1
    fi
    release_setup_rpc_started=0
    rm -- "$rpc_log"
  else
    if ! compose_release_setup_rpc logs --no-color --no-log-prefix rpc-proxy >> "$rpc_log" 2>&1; then
      printf '%s\n' 'Could not collect complete RPC proxy diagnostics.' >> "$rpc_log"
    fi
    if ! sed -n '/^RPC eth_chainId /p' "$rpc_log" >&2; then
      printf '%s\n' 'Could not display the chain reader diagnostic.' >&2
    fi
    printf 'Cannot read eth_chainId from the selected RPC. No signing key was requested. Diagnostics: %s\n' "$rpc_log" >&2
    return 1
  fi
}

require_release_config() {
  local path="$1" root
  require_protected_release_file "$path" CONFIG CONFIG
  if [[ "$(realpath -m -- "$path")" != "$path" ]]; then
    printf '%s\n' 'CONFIG must be a normalized absolute path.' >&2
    exit 2
  fi
  root="$(pwd -P)"
  case "$path" in "$root"|"$root"/*)
    printf '%s\n' 'CONFIG must be outside the repository.' >&2
    exit 2 ;;
  esac
  if [[ "$(stat -c %a -- "$path")" != 600 || "$(stat -c %u -- "$path")" != "$(id -u)" ]]; then
    printf '%s\n' 'CONFIG must be owned by the current user with mode 0600.' >&2
    exit 2
  fi
}

release_config_stage() {
  local digest
  release_config_dir="$(mktemp -d -- "$1/.cam-release-config-XXXXXXXX")"
  chmod 0700 -- "$release_config_dir"
  digest="$(printf '%s' "$release_config_dir" | sha256sum)"
  release_config_project="cam-release-config-${digest:0:24}"
  release_config_started=0
  trap 'release_config_status=$?; release_config_failed=0;
    if ! release_process_cleanup_begin; then release_config_failed=1; fi
    if ! release_config_teardown; then release_config_failed=1; fi
    if [[ "$release_config_failed" == 0 ]]; then
      release_config_cleanup || release_config_failed=1
    fi
    if [[ "$release_config_failed" != 0 ]]; then
      printf "Release cleanup retained mounted inputs: %s\n" "$release_config_dir" >&2
      release_config_status=2
    fi
    exit "$release_config_status"' EXIT
}

require_release_local_network() {
  if [[ ! "${RELEASE_REHEARSAL_NETWORK:?Missing local Docker network in release inputs}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]; then
    printf '%s\n' 'Local release Docker network must be a Docker-safe name.' >&2
    exit 2
  fi
  local internal
  internal="$(docker network inspect --format '{{.Internal}}' "$RELEASE_REHEARSAL_NETWORK")"
  if [[ "$internal" != true ]]; then
    printf '%s\n' 'Local release requires an existing internal Docker network; run make network/local/up.' >&2
    exit 2
  fi
}

release_config_prepare_approval_images() {
  source tools/release_approval_images.sh
  release_approval_installed_images > "$release_config_dir/approval-images"
  if [[ ! -s "$release_config_dir/approval-images" ]]; then
    printf '%s\n' 'No installed approval-tool builds were found. Build one with make release/approval/image/build; setup does not build, pull or substitute images.' >&2
    return 2
  fi
}

load_release_config() {
  local app="$1" mode="$2"
  local -a inputs
  if [[ ! -v CONFIG || -z "$CONFIG" ]]; then return; fi
  require_release_config "$CONFIG"
  release_config_stage /tmp
  compose_release_config run --rm --no-deps -T release-config "$mode" "$app" "$source_commit"
  mapfile -d '' -t inputs < "$release_config_dir/inputs"
  unset RPC_CHAIN RPC_SERVICE RPC_API_KEY_FILE RPC_URL_FILE DEPLOYER_PRIVATE_KEY_FILE RELEASE_REHEARSAL RELEASE_REHEARSAL_NETWORK RELEASE_APPROVAL_IMAGE
  export "${inputs[@]}"
  RPC_URL_FILE="$release_config_dir/rpc-url"
  export RPC_URL_FILE
  if [[ "$mode" == deploy ]]; then
    source tools/release_approval_preflight.sh
    release_approval_require_image
    DEPLOYER_PRIVATE_KEY_FILE="$release_config_dir/deployer-key"
    export DEPLOYER_PRIVATE_KEY_FILE
  fi
}
