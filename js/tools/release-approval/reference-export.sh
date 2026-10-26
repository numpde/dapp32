#!/bin/sh
set -eu

app=${1:?pass the release app}
output=${2:?pass an existing empty artifact output directory}
case "$app" in
  escrow)
    script=escrow/script/DeployEscrowRelease.s.sol
    ui_contract=CamEscrowUI
    business_contracts=CamEscrow
    contracts="CamRoot $business_contracts $ui_contract"
    ;;
  bike-nft)
    script=bike-nft/script/DeployBikeNftRelease.s.sol
    ui_contract=BicycleComponentManagerUI
    business_contracts="BicycleComponents BicycleComponentManager"
    contracts="CamRoot $business_contracts $ui_contract"
    ;;
  pay-to-play)
    script=pay-to-play/script/DeployPayToPlayRelease.s.sol
    ui_contract=PayToPlayUI
    business_contracts=PayToPlay
    contracts="CamRoot $business_contracts $ui_contract"
    ;;
  *) printf '%s\n' "unknown release app: $app" >&2; exit 2 ;;
esac
set --
case "${RELEASE_OPERATION:-deployment}" in
  deployment) ;;
  source-contracts)
    script=""; contracts="$business_contracts"
    for contract in $business_contracts; do set -- "$@" "$app/src/$contract.sol"; done
    ;;
  source-ui) script=""; contracts="$ui_contract"; set -- "$app/src/$ui_contract.sol" ;;
  source-root) script=""; contracts=CamRoot; set -- cam/src/CamRoot.sol ;;
  contracts) script="$app/script/DeployContracts.s.sol"; contracts="$business_contracts" ;;
  ui) script="$app/script/DeployUI.s.sol"; contracts="$ui_contract" ;;
  *) printf '%s\n' 'Compiler export must select deployment, contracts, ui or an explicit source component.' >&2; exit 2 ;;
esac

if [ ! -d "$output" ] || [ -L "$output" ] || [ -n "$(find "$output" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  printf '%s\n' 'compiler artifact output must be an existing empty real directory' >&2
  exit 2
fi
if [ "${FOUNDRY_OUT:-}" != /tmp/foundry-out ]; then
  printf '%s\n' 'compiler export requires FOUNDRY_OUT=/tmp/foundry-out' >&2
  exit 2
fi

umask 077
if [ -n "$script" ]; then
  forge build --offline "$script"
else
  forge build --offline "$@"
fi

for contract in $contracts; do
  source="$FOUNDRY_OUT/$contract.sol/$contract.json"
  target_dir="$output/$contract.sol"
  if [ ! -f "$source" ] || [ -L "$source" ]; then
    printf '%s\n' "compiler did not produce $contract" >&2
    exit 2
  fi
  mkdir "$target_dir"
  (set -C; cat "$source" > "$target_dir/$contract.json")
done
