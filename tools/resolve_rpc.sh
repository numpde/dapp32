#!/bin/sh
# Resolve the archived catalog offline; the existing proxy validates the resulting URL.
set -eu
export LC_ALL=C
network=${1:?missing network}
service=${2:?missing service}
key_file=${3?Pass API key file or an empty value}
output=${4:?missing output path}
expected_chain=${5?Pass expected chain ID or an empty value}

fail() { printf '%s\n' "$1" >&2; exit 2; }

select_endpoint() {
  tab=$(printf '\t')
  while IFS="$tab" read -r name id public alchemy; do
    if [ "$name" = network ] || [ "$name" != "$network" ]; then continue; fi
    chain_id=$id
    case "$service" in
      public) endpoint=$public ;;
      alchemy) endpoint=$alchemy ;;
      *) fail 'Unknown RPC_SERVICE; use public or alchemy, or supply RPC_URL_FILE.' ;;
    esac
    return
  done
  fail 'Unknown RPC_CHAIN; run make release/rpc/list.'
}
select_endpoint < "$(dirname -- "$0")/rpc-catalog.tsv"
if [ -n "$expected_chain" ] && [ "$chain_id" != "$expected_chain" ]; then
  fail "RPC_CHAIN selects chain $chain_id, but the release expects $expected_chain."
fi
if [ "$endpoint" = '-' ]; then fail 'The selected RPC service is unavailable for this chain.'; fi

case "$service" in
  public)
    if [ -n "$key_file" ]; then fail 'RPC_SERVICE=public does not take RPC_API_KEY_FILE.'; fi
    ;;
  alchemy)
    if [ -z "$key_file" ]; then fail 'RPC_SERVICE=alchemy requires RPC_API_KEY_FILE.'; fi
    # Bound the read and compare original bytes so shell stripping cannot admit NULs or extra newlines.
    api_key=$(head -c 258 -- "$key_file")
    case "$api_key" in
      ''|*[!A-Za-z0-9_-]*) fail 'RPC API key must contain only letters, digits, underscores and hyphens.' ;;
    esac
    if [ "${#api_key}" -gt 256 ]; then fail 'RPC API key exceeds 256 bytes.'; fi
    if ! printf '%s' "$api_key" | cmp -s - "$key_file" && ! printf '%s\n' "$api_key" | cmp -s - "$key_file"; then
      fail 'RPC API key must be one ASCII value with at most one final newline.'
    fi
    endpoint=${endpoint%\{API_KEY\}}$api_key
    ;;
esac

umask 077
# Noclobber keeps a stale file or symlink from receiving a credential-bearing URL.
if ! (set -C; printf '%s\n' "$endpoint" > "$output") 2>/dev/null; then
  fail 'Cannot create the protected RPC URL file; output must not already exist.'
fi
printf 'RPC selection: %s / %s (chain %s)\n' "$network" "$service" "$chain_id"
