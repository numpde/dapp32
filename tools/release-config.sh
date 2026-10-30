# Host filesystem admission and lifecycle for the shared release configuration.
# Sourced by Make after its existing release path guards have been defined.

unset release_config_dir release_config_input release_config_credentials
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
    rm -f -- "$release_config_dir/inputs" "$release_config_dir/rpc-url" "$release_config_dir/deployer-key" "$release_config_dir/release.json" "$release_config_dir/configuration.json" "$release_config_dir/capture.json" "$release_config_dir/approval-pin" "$release_config_dir/approval-network" "$release_config_dir/approval-image" "$release_config_dir/approval-built" "$release_config_dir/credential-source" "$release_config_dir/retained-source" "$release_config_dir/operation-inputs.json" "$release_config_dir/publication-uri" \
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
  local pinned="" image output network=""
  if [[ -f "$release_config_dir/approval-network" ]]; then
    read -r network < "$release_config_dir/approval-network"
  fi
  if [[ $# == 1 ]]; then pinned="$1"; fi
  source tools/release_approval_images.sh
  if [[ -n "$pinned" ]]; then
    image=$(release_approval_pinned_image "$pinned" "$network") || return
    if [[ "$image" == "$pinned" ]]; then
      printf '%s\n' "$image" > "$release_config_dir/approval-image"
      return 0
    fi
  fi
  if [[ -n "$pinned" && -f "$release_config_dir/retained-source" ]]; then
    printf 'This operation requires approval image %s, which is not available to this operation. Restore that exact image to resume signing. Rehearsal images must match the selected local network. Keyless verification remains available; starting a separate operation may create additional contracts.\n' "$pinned" >&2
    return 2
  fi
  if [[ -n "$pinned" && ( ! -t 0 || ! -t 1 ) ]]; then
    printf '%s\n' 'The saved approval tool is unavailable. Run the same command interactively to prepare and review its replacement.' >&2
    return 2
  fi
  output=$(release_approval_output_directory "$source_commit") || return
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

release_config_resolve_credentials() {
  local app="$1"
  rm -f -- "$release_config_dir/credential-source" "$release_config_dir/retained-source"
  compose_release_config run --rm --no-deps -T release-config credential-source "$app" "$source_commit"
  read -r release_config_credentials < "$release_config_dir/credential-source"
  require_release_config "$release_config_credentials"
}

load_release_config() {
  local app="$1" mode="$2" status=0 configuration_change="" update_mode output_override="" records=""
  if [[ -v OUTPUT_DIR ]]; then output_override="$OUTPUT_DIR"; fi
  local -a inputs
  case "$mode" in
    ui-artifact) if [[ -v UI_RECORDS ]]; then records="$UI_RECORDS"; fi ;;
    contracts-artifact) if [[ -v CONTRACT_RECORDS ]]; then records="$CONTRACT_RECORDS"; fi ;;
    cam-artifact|cam-publish) if [[ -v CAM_RECORDS ]]; then records="$CAM_RECORDS"; fi ;;
  esac
  if [[ -z "$records" ]]; then records="$output_override"; fi
  if [[ -n "$records" && -f "$records/inputs/configuration.json" ]]; then
    CONFIG="$records/inputs/configuration.json"
  fi
  if [[ ! -v CONFIG || -z "$CONFIG" ]]; then return; fi
  require_release_config "$CONFIG"
  release_config_stage "$(dirname -- "$CONFIG")"
  release_config_credentials="$CONFIG"
  release_config_input="$release_config_dir/configuration.json"
  cp -- "$CONFIG" "$release_config_input"
  release_config_resolve_credentials "$app"
  if [[ "$mode" == cam-publish ]]; then
    if [[ -v RELEASE_CAM_URI_FILE && -n "$RELEASE_CAM_URI_FILE" ]]; then
      require_release_file "$RELEASE_CAM_URI_FILE" 'Retained publication URI'
      cp -- "$RELEASE_CAM_URI_FILE" "$release_config_dir/publication-uri"
    else
      local -a terminal=(-T)
      if [[ -t 0 && -t 1 ]]; then terminal=(-it); fi
      compose_release_config run --rm --no-deps "${terminal[@]}" release-config publication-uri "$app" "$source_commit"
    fi
  fi
  compose_release_config run --rm --no-deps -T release-config "$mode" "$app" "$source_commit" || status=$?
  if [[ "$status" == 3 && -f "$release_config_dir/retained-source" ]]; then
    case "$mode" in
      contracts-deploy|ui-deploy|cam-publish)
        if [[ -n "$records" && ! -e "$records" && ! -L "$records" ]]; then
          printf 'The next phase has no saved records. Choose Patch to review settings for source %s. Earlier deployment records keep their original source.\n' "$source_commit" >&2
          rm -- "$release_config_dir/retained-source" || return
        fi ;;
    esac
    if [[ -f "$release_config_dir/retained-source" ]]; then
      printf 'This phase uses source %s. Check out that commit to resume; its saved inputs were not changed.\n' "$(cat "$release_config_dir/retained-source")" >&2
      return 2
    fi
  fi
  if [[ "$status" == 3 ]]; then configuration_change=source; fi
  if [[ "$status" == 3 && ( ! -t 0 || ! -t 1 ) ]]; then
    printf 'Run this command interactively to review the Patch option for source %s. The saved configuration will not change.\n' "$source_commit" >&2
    return "$status"
  fi
  if [[ ( "$status" == 0 || "$status" == 3 ) && ( "$mode" == ui-deploy || "$mode" == contracts-deploy || "$mode" == cam-publish ) ]]; then
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
  if [[ "$status" == 3 && ( "$mode" == ui-deploy || "$mode" == contracts-deploy || "$mode" == cam-publish ) && -t 0 && -t 1 ]]; then
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
  if [[ "$mode" == ui-deploy || "$mode" == contracts-deploy || "$mode" == cam-publish ]]; then
    source tools/release_approval_preflight.sh
    release_approval_require_image
    DEPLOYER_PRIVATE_KEY_FILE="$release_config_dir/deployer-key"
    export DEPLOYER_PRIVATE_KEY_FILE
  fi
  if [[ -n "$configuration_change" ]]; then
    local output_name
    if [[ "$mode" == ui-deploy ]]; then output_name=UI_RELEASE_OUTPUT_DIR; fi
    if [[ "$mode" == contracts-deploy ]]; then output_name=CONTRACT_RELEASE_OUTPUT_DIR; fi
    if [[ "$mode" == cam-publish ]]; then output_name=CAM_RELEASE_OUTPUT_DIR; fi
    if [[ "$configuration_change" == source ]]; then validate_new_release_output "${!output_name}" "$output_name"; fi
    printf '%s\n' 'Phase settings patched; the saved configuration is unchanged.'
  fi
  case "$mode" in
    ui-deploy|contracts-deploy|cam-publish|cam-bundle)
      local retained_source="$source_commit"
      if [[ "$mode" == cam-bundle ]]; then retained_source="$CAM_RELEASE_SOURCE_COMMIT"; fi
      compose_release_config run --rm --no-deps -T release-config retain "$app" "$retained_source" ;;
  esac
}

release_config_retain() {
  local records="$1"
  mkdir -p --mode=0700 -- "$records/inputs"
  release_config_save "$release_config_dir/operation-inputs.json" "$records/inputs/configuration.json"
}

release_config_capture() {
  local CONFIG="$1" destination="$2" app="$3" release_config_credentials="$1" release_config_input="$release_config_dir/capture.json"
  require_release_config "$CONFIG"
  cp -- "$CONFIG" "$release_config_input"
  rm -f -- "$release_config_dir/operation-inputs.json" "$release_config_dir/approval-pin" "$release_config_dir/approval-network"
  release_config_resolve_credentials "$app"
  compose_release_config run --rm --no-deps -T release-config approval-pin "$app" "$source_commit"
  local pin
  read -r pin < "$release_config_dir/approval-pin"
  release_config_prepare_approval_images "$pin" || return
  compose_release_config run --rm --no-deps -T release-config retain "$app" "$source_commit"
  release_config_save "$release_config_dir/operation-inputs.json" "$destination" || return
  rm -- "$release_config_dir/operation-inputs.json" "$release_config_input"
}

release_config_hosted_uri() {
  local CONFIG="$1" destination="$2" app="$3" release_config_input="$1" release_config_credentials="$1"
  local -a terminal=(-T)
  if [[ -t 0 && -t 1 ]]; then terminal=(-it); fi
  compose_release_config run --rm --no-deps "${terminal[@]}" release-config publication-uri "$app" "$source_commit"
  release_config_save "$release_config_dir/publication-uri" "$destination" || return
  rm -- "$release_config_dir/publication-uri"
}

release_config_save() {
  local source="$1" destination="$2" temporary status=0
  temporary=$(mktemp -- "$(dirname -- "$destination")/.operation-inputs-XXXXXXXX") || return
  # Retained choices must survive a crash before a later transaction can be sent.
  if cp -- "$source" "$temporary" && sync -f "$temporary" && ln -- "$temporary" "$destination" && sync -f "$(dirname -- "$destination")"; then :; else status=$?; fi
  rm -- "$temporary" || return
  return "$status"
}
