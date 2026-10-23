# Host filesystem admission and lifecycle for the shared release configuration.
# Sourced by Make after its existing release path guards have been defined.

unset release_config_dir release_config_input
release_config_started=0

release_config_teardown() {
  local previous_grace="$release_command_grace" failed=0
  if [[ "$release_config_started" != 1 ]]; then return 0; fi
  release_command_grace=60
  if ! compose_release_config down --timeout 10 --volumes --remove-orphans >/dev/null; then
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
    rm -f -- "$release_config_dir/inputs" "$release_config_dir/rpc-url" "$release_config_dir/deployer-key" "$release_config_dir/release.json" "$release_config_dir/approval-images" "$release_config_dir/approval-records" "$release_config_dir"/approval-image-[0-9]*.json || return "$?"
    rmdir -- "$release_config_dir" || return "$?"
    unset release_config_dir
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
  local app="$1" source_commit="$2" location record count=0 image_id tool_source extra observed_source
  local -a records
  printf 'Approval-image record file or records folder [%s]: ' "$(dirname -- "$CONFIG")"
  IFS= read -r location
  if [[ -z "$location" ]]; then location="$(dirname -- "$CONFIG")"; fi
  if [[ "$location" != /* || $(realpath -m -- "$location") != "$location" ]]; then
    printf '%s\n' 'Approval-image location must be a normalized absolute path.' >&2
    return 2
  fi
  if ! (reject_release_path_symlinks "$location" 'Approval-image location'); then return 2; fi
  if [[ -f "$location" ]]; then
    records=("$location")
  elif [[ -d "$location" ]]; then
    records=("$location/approval-image.json" "$location"/*/approval-image.json)
  else
    printf '%s\n' 'Approval-image location must be an existing record file or folder.' >&2
    return 2
  fi
  for record in "${records[@]}"; do
    if [[ ! -e "$record" && ! -L "$record" ]]; then continue; fi
    printf 'Approval record %s: %q\n' "$count" "$record" >&2
    if ! (require_release_file "$record" 'Approval-image record'); then continue; fi
    if [[ $(stat -c %s -- "$record") -gt 4096 ]]; then
      printf '%s\n' 'Skipping approval-image record larger than 4096 bytes.' >&2
      continue
    fi
    if [[ "$count" -ge 64 ]]; then
      printf '%s\n' 'More than 64 approval-image records found; select a narrower folder or one record file.' >&2
      return 2
    fi
    head -c 4097 -- "$record" > "$release_config_dir/approval-image-$count.json"
    count=$((count + 1))
  done
  compose_release_config run --rm --no-deps -T release-setup approval-records "$app" "$source_commit" > "$release_config_dir/approval-records"
  source tools/release_approval_preflight.sh
  : > "$release_config_dir/approval-images"
  while IFS=$'\t' read -r image_id tool_source extra; do
    if [[ -n "$extra" || ! "$tool_source" =~ ^[0-9a-f]{40}$ ]]; then
      printf '%s\n' 'Approval record parser returned malformed provenance.' >&2
      return 2
    fi
    if ! (RELEASE_APPROVAL_IMAGE="$image_id"; release_approval_require_image); then
      printf 'Skipping unavailable approval image %s.\n' "$image_id" >&2
      continue
    fi
    if ! observed_source="$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image_id")"; then
      printf 'Cannot inspect approval image tool source: %s\n' "$image_id" >&2
      continue
    fi
    if [[ "$observed_source" != "$tool_source" ]]; then
      printf 'Skipping approval image %s: local tool source does not match its record.\n' "$image_id" >&2
      continue
    fi
    printf '%s\t%s\n' "$image_id" "$tool_source" >> "$release_config_dir/approval-images"
  done < "$release_config_dir/approval-records"
  if [[ ! -s "$release_config_dir/approval-images" ]]; then
    printf '%s\n' 'No usable local approval images were found. Provide a record whose exact image is installed; setup does not build or substitute images. Build records are created by make release/approval/image/build.' >&2
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
