#!/usr/bin/env bash
# Live proof of the refund worker's internal network and RPC method gate.
# Runs both permission overlays without mounting a relayer key or forwarding a transaction.
set -euo pipefail

root="$(cd -- "$(dirname -- "$0")/../.." && pwd -P)"
endpoint="$CAM_DOCKER_ENDPOINT"
[[ "$endpoint" == unix:///* ]] || { printf '%s\n' 'Select a local Unix Docker engine through Make.' >&2; exit 2; }

scratch="$(mktemp -d /tmp/dapp32-refund-network.XXXXXXXX)"
project="refund-network-$(printf '%s' "$scratch" | sha256sum | cut -c1-20)"
export COMPOSE_PROJECT_NAME="$project"
export LOCAL_UID="$(id -u)"
export LOCAL_GID="$(id -g)"
export RPC_URL_FILE="$scratch/rpc-url"
export REFUND_CONFIG_FILE="$scratch/config"
export REFUND_PRIVATE_KEY_FILE="$scratch/unused-relayer"
export REFUND_STATE_DIR="$scratch/unused-state"

umask 077
# A loopback upstream is rejected by the proxy's non-global-address policy,
# without making any external RPC request.
printf '%s\n' 'https://127.0.0.1/rpc' >"$RPC_URL_FILE"
printf '%s\n' '{}' >"$REFUND_CONFIG_FILE"
printf '%s\n' 'NOT_A_PRIVATE_KEY' >"$REFUND_PRIVATE_KEY_FILE"
mkdir -m 0700 "$REFUND_STATE_DIR"
cat >"$scratch/network-check.yml" <<'YAML'
services:
  pay-to-play-refunds:
    # The diagnostic must use the real worker's networks and resource policy,
    # but not mount the production JavaScript tree, configuration, or keys.
    volumes: !override []
    entrypoint: [node]
YAML

compose_files=(-f "$root/compose/pay-to-play/refunds/run.yml")
compose() {
  docker --host "$endpoint" compose \
    -p "$project" "${compose_files[@]}" \
    -f "$scratch/network-check.yml" "$@"
}

cleanup() {
  status=$?
  trap - EXIT
  if bash "$root/tools/compose_cleanup.sh" "$project" --rmi local -- \
      docker --host "$endpoint" compose "${compose_files[@]}" -f "$scratch/network-check.yml"; then
    rm -f -- "$RPC_URL_FILE" "$REFUND_CONFIG_FILE" "$REFUND_PRIVATE_KEY_FILE" "$scratch/network-check.yml"
    rmdir -- "$REFUND_STATE_DIR"
    rmdir -- "$scratch"
  else
    cleanup_status=$?
    printf 'Refund network test retained unresolved project %s and mounted inputs in %s\n' "$project" "$scratch" >&2
    if [[ "$status" == 0 ]]; then status="$cleanup_status"; fi
  fi
  exit "$status"
}
trap cleanup EXIT

# The proxy is the sole process with an external network. Its health endpoint
# is local and works without attempting to resolve the dummy upstream URL.
compose up --build -d refund-rpc-proxy

node_probe="$(cat <<'JS'
const { readFileSync, existsSync } = require("node:fs");

async function run() {
  const routes = readFileSync("/proc/net/route", "utf8").trim().split("\n").slice(1);
  if (routes.some(line => line.split(/\s+/)[1] === "00000000")) {
    throw new Error("Worker network has an IPv4 default route");
  }

  if (existsSync("/run/secrets/refund-relayer")) {
    throw new Error("Keyless network test unexpectedly mounted a relayer secret");
  }
  const ipv6 = existsSync("/proc/net/ipv6_route")
    ? readFileSync("/proc/net/ipv6_route", "utf8").trim().split("\n")
    : [];
  if (ipv6.some(line => {
    const fields = line.trim().split(/\s+/);
    return fields[0] === "0".repeat(32) && fields[1] === "00";
  })) {
    throw new Error("Worker network has an IPv6 default route");
  }

  const proxy = "http://refund-rpc-proxy:8080";
  const health = await fetch(proxy + "/healthz", { signal: AbortSignal.timeout(3000) });
  if (health.status !== 204) throw new Error(`Internal RPC proxy health returned HTTP ${health.status}`);

  const rejected = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0x00"]
    }),
    signal: AbortSignal.timeout(3000)
  });
  const expected = process.env.REFUND_NETWORK_MODE === "execute" ? 502 : 403;
  if (rejected.status !== expected) {
    throw new Error(`RPC method admission returned ${rejected.status}, expected ${expected}`);
  }

  let directEgress = false;
  try {
    await fetch("https://example.com/", { signal: AbortSignal.timeout(3000) });
    directEgress = true;
  } catch {}
  if (directEgress) throw new Error("Worker reached external HTTPS directly");

  console.log(`PASS ${process.env.REFUND_NETWORK_MODE}: internal-only worker, correct method gate, no key`);
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});
JS
)"

# Compose builds the normal pinned Node image; the minimal probe overrides only
# its command and mounts, preserving the worker's isolated Docker networking.
compose run --build --rm --no-deps -T -e REFUND_NETWORK_MODE=plan pay-to-play-refunds -e "$node_probe"

# Recreate the same proxy with the execute overlay, but remove all worker
# mounts in the diagnostic overlay. The method gate must admit the request,
# then refuse the non-global dummy upstream without broadcasting any bytes.
compose_files+=(-f "$root/compose/pay-to-play/refunds/execute.yml")
compose up --build --force-recreate -d refund-rpc-proxy
compose run --build --rm --no-deps -T -e REFUND_NETWORK_MODE=execute pay-to-play-refunds -e "$node_probe"

printf '%s\n' 'PASS plan/execute refund network separation and owned Compose cleanup'
