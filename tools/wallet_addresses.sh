#!/usr/bin/env bash
# MetaMask's software-wallet accounts use m/44'/60'/0'/0/<index>.
set +x
set -euo pipefail
ulimit -c 0
umask 077

cleanup() {
  if [[ -v phrase_file ]]; then rm -f -- "$phrase_file"; fi
  unset phrase words private_key private_keys
  if [[ -v terminal_state ]]; then stty "$terminal_state"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

with_keys=false
if [[ "$#" != 0 ]]; then
  if [[ "$#" != 1 || "$1" != --with-keys ]]; then
    printf '%s\n' 'Usage: wallet_addresses.sh [--with-keys]' >&2
    exit 2
  fi
  with_keys=true
fi

if [[ ! -t 0 || ! -t 1 ]]; then
  printf '%s\n' 'Run make wallet/addresses in an interactive terminal.' >&2
  exit 2
fi
# Keep queued input hidden while Cast runs, until this terminal session exits.
terminal_state=$(stty -g)
stty -echo
printf '%s\n' "MetaMask accounts 1–10: m/44'/60'/0'/0/0 through m/44'/60'/0'/0/9"
if [[ "$with_keys" == true ]]; then
  printf '%s\n' 'Private keys will be printed in this terminal.'
fi
if ! IFS= read -rs -p 'Recovery phrase (12 words; hidden): ' phrase; then
  printf '\n%s\n' 'No recovery phrase was entered.' >&2
  exit 2
fi
printf '\n' >&2
read -ra words <<<"$phrase"
if [[ "${#words[@]}" != 12 ]]; then
  printf '%s\n' 'Enter the 12 words of the MetaMask recovery phrase.' >&2
  exit 2
fi
# Cast requires a regular file; /tmp is private container tmpfs, never a host bind.
phrase_file=$(mktemp /tmp/wallet-phrase.XXXXXXXX)
printf '%s\n' "${words[*]}" >"$phrase_file"
unset phrase words

addresses=()
private_keys=()
for index in {0..9}; do
  if ! address=$(cast wallet address --mnemonic "$phrase_file" --mnemonic-index "$index" 2>/dev/null); then
    printf '%s\n' 'Cannot derive MetaMask addresses. Check the recovery words and their checksum.' >&2
    exit 2
  fi
  if [[ ! "$address" =~ ^0x[0-9a-fA-F]{40}$ ]]; then
    printf '%s\n' 'Cast did not return an Ethereum address.' >&2
    exit 2
  fi
  addresses+=("$address")
  if [[ "$with_keys" == true ]]; then
    if ! private_key=$(cast wallet private-key --mnemonic "$phrase_file" --mnemonic-index "$index" 2>/dev/null); then
      printf 'Cannot derive the private key for account %s. No accounts have been printed.\n' "$((index + 1))" >&2
      exit 2
    fi
    if [[ ! "$private_key" =~ ^0x[0-9a-fA-F]{64}$ ]]; then
      printf '%s\n' 'Cast did not return a 32-byte private key. No accounts have been printed.' >&2
      exit 2
    fi
    private_keys+=("$private_key")
  fi
done
rm -- "$phrase_file"
unset phrase_file
printf 'Account  Derivation path           Address'
if [[ "$with_keys" == true ]]; then printf '                                     Private key'; fi
printf '\n'
for index in {0..9}; do
  printf '%-8s %-25s %s' "$((index + 1))" "m/44'/60'/0'/0/$index" "${addresses[$index]}"
  if [[ "$with_keys" == true ]]; then printf ' %s' "${private_keys[$index]}"; fi
  printf '\n'
done
