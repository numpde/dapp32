# Host filesystem admission and lifecycle for the shared release configuration.
# Sourced by Make after its existing release path guards have been defined.

unset release_config_dir release_config_input

release_config_cleanup() {
  if [[ -v release_config_dir && -n "$release_config_dir" ]]; then
    rm -f -- "$release_config_dir/inputs" "$release_config_dir/rpc-url" "$release_config_dir/deployer-key" "$release_config_dir/release.json" || return
    rmdir -- "$release_config_dir" || return
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
  release_config_dir="$(mktemp -d -- "$1/.cam-release-config-XXXXXXXX")"
  chmod 0700 -- "$release_config_dir"
  trap 'release_config_status=$?; release_config_cleanup || release_config_status=1; exit "$release_config_status"' EXIT
}

load_release_config() {
  local app="$1" mode="$2"
  local -a inputs
  if [[ ! -v CONFIG || -z "$CONFIG" ]]; then return; fi
  require_release_config "$CONFIG"
  release_config_stage /tmp
  compose_release_config run --rm --no-deps -T release-config "$mode" "$app" "$source_commit"
  mapfile -d '' -t inputs < "$release_config_dir/inputs"
  unset RPC_CHAIN RPC_SERVICE RPC_API_KEY_FILE RPC_URL_FILE DEPLOYER_PRIVATE_KEY_FILE
  export "${inputs[@]}"
  RPC_URL_FILE="$release_config_dir/rpc-url"
  export RPC_URL_FILE
  if [[ "$mode" == deploy ]]; then
    DEPLOYER_PRIVATE_KEY_FILE="$release_config_dir/deployer-key"
    export DEPLOYER_PRIVATE_KEY_FILE
  fi
}
