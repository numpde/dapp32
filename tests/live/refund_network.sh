#!/usr/bin/env bash
# Live proof of the refund worker's internal network and RPC method gate.
# Does not mount a relayer key, submit a transaction, or contact an RPC upstream.
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

umask 077
printf '%s\n' 'https://example.invalid/rpc' >"$RPC_URL_FILE"
printf '%s\n' '{}' >"$REFUND_CONFIG_FILE"
cat >"$scratch/network-check.yml" <<'YAML'
services:
  pay-to-play-refunds:
    # The diagnostic must use the real worker's networks and resource policy,
    # but not mount the production JavaScript tree, configuration, or keys.
    volumes: !override []
    entrypoint: [node]
YAML

compose() {
  docker --host "$endpoint" compose \
    -p "$project" \
    -f "$root/compose/pay-to-play/refunds/run.yml" \
    -f "$scratch/network-check.yml" \
    "$@"
}

cleanup() {
  status=$?
  trap - EXIT
  compose down --timeout 10 --volumes --remove-orphans || status=2
  rm -f -- "$RPC_URL_FILE" "$REFUND_CONFIG_FILE" "$scratch/network-check.yml"
  rmdir -- "$scratch" || status=2
  exit "$status"
}
trap cleanup EXIT

# The proxy is the sole process with an external network. Its health endpoint
# is local and works without attempting to resolve the dummy upstream URL.
compose up --build -d refund-rpc-proxy

node_probe="$(cat <<'JS'
const { readFileSync } = require("node:fs");

async function run() {
  const routes = readFileSync("/proc/net/route", "utf8").trim().split("\n").slice(1);
  if (routes.some(line => line.split(/\s+/)[1] === "00000000")) {
    throw new Error("Worker network has an IPv4 default route");
  }

  const proxy = "http://refund-rpc-proxy:8080";
  const health = await fetch(proxy + "/healthz", { signal: AbortSignal.timeout(3000) });
  if (health.status !== 200) throw new Error("Internal RPC proxy is not healthy");

  const rejected = await fetch(proxy, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0x00"]
    }),
    signal: AbortSignal.timeout(3000)
  });
  if (rejected.status !== 403) {
    throw new Error("Read-only refund plan did not reject transaction broadcast");
  }

  let directEgress = false;
  try {
    await fetch("https://example.com/", { signal: AbortSignal.timeout(3000) });
    directEgress = true;
  } catch {}
  if (directEgress) throw new Error("Worker reached external HTTPS directly");

  console.log("PASS worker internal-only; RPC proxy reachable; broadcast rejected");
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});
JS
)"

# Compose builds the normal pinned Node image; the minimal probe overrides only
# its command and mounts, preserving the worker's isolated Docker networking.
compose run --build --rm --no-deps -T pay-to-play-refunds -e "$node_probe"

printf '%s\n' 'PASS refund worker/proxy separation and owned Compose cleanup'
