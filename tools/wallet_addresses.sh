#!/usr/bin/env bash
# MetaMask's software-wallet accounts use m/44'/60'/0'/0/<index>.
set +x
set -euo pipefail
ulimit -c 0
umask 077

cleanup() {
  if [[ -v phrase_file ]]; then rm -f -- "$phrase_file"; fi
  unset phrase words
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ! -t 0 || ! -t 1 ]]; then
  printf '%s\n' 'Run make wallet/addresses in an interactive terminal.' >&2
  exit 2
fi
printf '%s\n' "MetaMask accounts 1–10: m/44'/60'/0'/0/0 through m/44'/60'/0'/0/9"
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
done
rm -- "$phrase_file"
unset phrase_file
printf 'Account  Derivation path           Address\n'
for index in {0..9}; do
  printf '%-8s %-25s %s\n' "$((index + 1))" "m/44'/60'/0'/0/$index" "${addresses[$index]}"
done
