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
    rm -f -- "$release_config_dir/inputs" "$release_config_dir/rpc-url" "$release_config_dir/deployer-key" "$release_config_dir/release.json" "$release_config_dir/approval-images" "$release_config_dir/approval-pin" "$release_config_dir/approval-image" "$release_config_dir/approval-built" \
      "$release_config_dir/setup-network" "$release_config_dir/setup-approval-image" "$release_config_dir/setup-rpc-url" "$release_config_dir/chain-id" "$release_config_dir/images-setup-rpc.yml" "$release_config_dir/ui-source" "$release_config_dir/contract-source" "$release_config_dir/cam-source" "$release_config_dir/cam-uri-ready" || return "$?"
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
  local pinned="" inventory image revision output
  if [[ $# == 1 ]]; then pinned="$1"; fi
  source tools/release_approval_images.sh
  if [[ -n "$pinned" ]]; then
    inventory=$(release_approval_installed_images) || return
    while IFS=$'\t' read -r image revision; do
      if [[ "$image" == "$pinned" ]]; then
        printf '%s\n' "$image" > "$release_config_dir/approval-image"
        return 0
      fi
    done <<< "$inventory"
  fi
  if [[ -n "$pinned" && ( ! -t 0 || ! -t 1 ) ]]; then
    printf '%s\n' 'The saved approval tool is unavailable. Run the same command interactively to prepare and review its replacement.' >&2
    return 2
  fi
  output=$(release_approval_default_output "$source_commit") || return
  printf 'Preparing the approval tool automatically; build record: %s\n' "$output"
  release_run_owned "$release_make_cleanup_grace" bash -c \
    'source tools/release_approval_images.sh; release_approval_build_image "$@"' bash \
    "$source_commit" "$output" > "$release_config_dir/approval-built" || return
  read -r image < "$release_config_dir/approval-built"
  if [[ ! "$image" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    printf '%s\n' 'Approval-tool preparation returned an invalid image identity.' >&2
    return 2
  fi
  printf '%s\n' "$image" > "$release_config_dir/approval-image"
}

load_release_config() {
  local app="$1" mode="$2" status=0 configuration_change="" original_digest update_mode=update output_override=""
  if [[ -v OUTPUT_DIR ]]; then output_override="$OUTPUT_DIR"; fi
  local -a inputs
  if [[ ! -v CONFIG || -z "$CONFIG" ]]; then return; fi
  require_release_config "$CONFIG"
  release_config_stage "$(dirname -- "$CONFIG")"
  original_digest=$(sha256sum -- "$CONFIG")
  compose_release_config run --rm --no-deps -T release-config "$mode" "$app" "$source_commit" || status=$?
  if [[ "$status" == 3 ]]; then configuration_change=source; fi
  if [[ "$status" == 3 && ( ! -t 0 || ! -t 1 ) ]]; then return "$status"; fi
  if [[ ( "$status" == 0 || "$status" == 3 ) && ( "$mode" == deploy || "$mode" == ui-deploy || "$mode" == contracts-deploy || "$mode" == cam-publish ) ]]; then
    compose_release_config run --rm --no-deps -T release-config approval-pin "$app" "$source_commit"
    local pinned prepared
    read -r pinned < "$release_config_dir/approval-pin"
    release_config_prepare_approval_images "$pinned"
    read -r prepared < "$release_config_dir/approval-image"
    if [[ "$status" == 0 && "$pinned" != "$prepared" ]]; then
      rm -f -- "$release_config_dir/inputs" "$release_config_dir/rpc-url" "$release_config_dir/deployer-key"
      status=3
      configuration_change=approval-image
    fi
  fi
  if [[ "$mode" == ui-deploy ]]; then update_mode=update-ui; fi
  if [[ "$mode" == contracts-deploy ]]; then update_mode=update-contracts; fi
  if [[ "$mode" == cam-publish ]]; then update_mode=update-cam; fi
  if [[ "$status" == 3 && ( "$mode" == deploy || "$mode" == ui-deploy || "$mode" == contracts-deploy || "$mode" == cam-publish ) && -t 0 && -t 1 ]]; then
    compose_release_config run --rm --no-deps -it release-config "$update_mode" "$app" "$source_commit"
    release_config_input="$release_config_dir/release.json"
    require_release_config "$release_config_input"
    compose_release_config run --rm --no-deps -T release-config "$mode" "$app" "$source_commit"
  elif [[ "$status" != 0 ]]; then
    return "$status"
  fi
  mapfile -d '' -t inputs < "$release_config_dir/inputs"
  unset RPC_CHAIN RPC_SERVICE RPC_API_KEY_FILE RPC_URL_FILE DEPLOYER_PRIVATE_KEY_FILE RELEASE_REHEARSAL RELEASE_REHEARSAL_NETWORK RELEASE_APPROVAL_IMAGE
  unset UI_RELEASE_APP UI_RELEASE_SOURCE_COMMIT UI_RELEASE_EXPECTED_CHAIN_ID UI_RELEASE_CREATOR_ADDRESS UI_RELEASE_OUTPUT_DIR
  unset CONTRACT_RELEASE_APP CONTRACT_RELEASE_SOURCE_COMMIT CONTRACT_RELEASE_EXPECTED_CHAIN_ID CONTRACT_RELEASE_CREATOR_ADDRESS CONTRACT_RELEASE_OUTPUT_DIR CONTRACT_RELEASE_SETTINGS_JSON
  unset CAM_RELEASE_APP CAM_RELEASE_SOURCE_COMMIT CAM_RELEASE_EXPECTED_CHAIN_ID CAM_RELEASE_OUTPUT_DIR CAM_RELEASE_SIGNER_ADDRESS CAM_RELEASE_URI CAM_RELEASE_HASH CAM_RELEASE_INTENDED_OWNER
  export "${inputs[@]}"
  if [[ "$mode" == ui-deploy && -n "$output_override" ]]; then export UI_RELEASE_OUTPUT_DIR="$output_override"; fi
  if [[ "$mode" == contracts-deploy && -n "$output_override" ]]; then export CONTRACT_RELEASE_OUTPUT_DIR="$output_override"; fi
  if [[ ( "$mode" == cam-bundle || "$mode" == cam-publish ) && -n "$output_override" ]]; then export CAM_RELEASE_OUTPUT_DIR="$output_override"; fi
  RPC_URL_FILE="$release_config_dir/rpc-url"
  export RPC_URL_FILE
  if [[ "$mode" == deploy || "$mode" == ui-deploy || "$mode" == contracts-deploy || "$mode" == cam-publish ]]; then
    source tools/release_approval_preflight.sh
    release_approval_require_image
    DEPLOYER_PRIVATE_KEY_FILE="$release_config_dir/deployer-key"
    export DEPLOYER_PRIVATE_KEY_FILE
  fi
  if [[ -n "$configuration_change" ]]; then
    local prefix="${app^^}" output_name
    prefix="${prefix//-/_}"
    output_name="${prefix}_RELEASE_OUTPUT_DIR"
    if [[ "$mode" == ui-deploy ]]; then output_name=UI_RELEASE_OUTPUT_DIR; fi
    if [[ "$mode" == contracts-deploy ]]; then output_name=CONTRACT_RELEASE_OUTPUT_DIR; fi
    if [[ "$mode" == cam-publish ]]; then output_name=CAM_RELEASE_OUTPUT_DIR; fi
    if [[ "$configuration_change" == source ]]; then validate_new_release_output "${!output_name}" "$output_name"; fi
    require_release_config "$CONFIG"
    if [[ "$(sha256sum -- "$CONFIG")" != "$original_digest" ]]; then
      printf '%s\n' 'The saved configuration changed during review; refusing to replace it.' >&2
      return 2
    fi
    mv -T -- "$release_config_input" "$CONFIG"
    unset release_config_input
    printf 'Updated release configuration: %s\n' "$CONFIG"
  fi
}
