#!/usr/bin/env bash
# Exercise the actual refund plan through Make/Compose without a signing key.
set -euo pipefail

context="$1"
[[ -n "$context" ]] || { printf '%s\n' 'Supply a Docker context.' >&2; exit 2; }
root="$(cd -- "$(dirname -- "$0")/../.." && pwd -P)"
scratch="$(mktemp -d /tmp/dapp32-refund-smoke.XXXXXXXX)"

cleanup() {
  code=$?
  trap - EXIT
  rm -f -- "$scratch/config.json" "$scratch/rpc-url" "$scratch/stdout" "$scratch/stderr"
  rmdir -- "$scratch" || { if [[ "$code" == 0 ]]; then code=2; fi; }
  exit "$code"
}
trap cleanup EXIT

umask 077
cat > "$scratch/config.json" <<'JSON'
{
  "chainId": "43113",
  "payment": "0x1111111111111111111111111111111111111111",
  "codeHash": "0x2222222222222222222222222222222222222222222222222222222222222222",
  "channelId": "1",
  "fromBlock": "0",
  "toBlock": "0",
  "confirmations": 1,
  "blockChunk": 1,
  "maxCustomers": 1,
  "maxTransactions": 1,
  "gasLimit": "21000",
  "maxFeePerGas": "1000000000",
  "maxPriorityFeePerGas": "1000000"
}
JSON
# The proxy rejects non-global destinations without contacting them.
printf '%s\n' 'https://127.0.0.1/rpc' > "$scratch/rpc-url"

if make --no-print-directory -C "$root" pay-to-play/refunds/plan \
    DOCKER_CONTEXT="$context" REFUND_CONFIG_FILE="$scratch/config.json" \
    RPC_URL_FILE="$scratch/rpc-url" > "$scratch/stdout" 2> "$scratch/stderr"; then
  printf '%s\n' 'Unexpected refund plan success against a forbidden upstream.' >&2
  exit 2
fi

if ! grep -Fq 'Refund worker stopped during deployment pins.' "$scratch/stderr"; then
  cat "$scratch/stderr" >&2
  printf '%s\n' 'Refund worker failed before RPC deployment-pin verification.' >&2
  exit 2
fi
if grep -Eqi 'owner-only regular file|Missing REFUND_RPC_PROXY_URL|REFUND_PRIVATE_KEY_FILE|signing setup|broadcast_intent' \
    "$scratch/stdout" "$scratch/stderr"; then
  cat "$scratch/stderr" >&2
  printf '%s\n' 'Refund plan exposed a credential, permission, or execution boundary failure.' >&2
  exit 2
fi
printf '%s\n' 'PASS actual read-only refund runner reached the RPC proxy and failed at deployment pins'
