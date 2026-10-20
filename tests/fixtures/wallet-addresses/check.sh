#!/usr/bin/env bash
# Exercise the real terminal UI with a public Hardhat fixture mnemonic.
set -euo pipefail
umask 077
test_root=$(mktemp -d /tmp/wallet-address-check.XXXXXXXX)
trap 'rm -rf -- "$test_root"' EXIT

assert_absent() {
  local status
  if grep -Eq "$1" "$2"; then
    printf 'Unexpected echoed input or address in %s\n' "$2" >&2
    exit 1
  else
    status=$?
    if [[ "$status" != 1 ]]; then exit "$status"; fi
  fi
}

run_case() {
  local mode="$1" name="$2" input="$3" expected_status="$4" status pid attempt ready=0
  local wallet_command='bash --noprofile --norc /tool/wallet_addresses.sh'
  if [[ "$mode" == --with-keys ]]; then wallet_command+=' --with-keys'; fi
  shift 4
  : >"$test_root/$name.transcript"
  mkfifo "$test_root/$name.input"
  timeout 20 script -q -e -f --echo always -c "$wallet_command" "$test_root/$name.transcript" <"$test_root/$name.input" >"$test_root/$name.output" 2>&1 &
  pid=$!
  exec 3>"$test_root/$name.input"
  for attempt in {1..1000}; do
    if grep -q 'Recovery phrase' "$test_root/$name.transcript"; then ready=1; break; fi
    if ! kill -0 "$pid" 2>/dev/null; then break; fi
    sleep 0.01
  done
  if [[ "$ready" != 1 ]]; then
    printf 'Wallet prompt did not appear for %s\n' "$name" >&2
    cat "$test_root/$name.output" >&2
    exec 3>&-
    if wait "$pid"; then status=0; else status=$?; fi
    return 1
  fi
  printf '%s' "$input" >&3
  if [[ "$#" == 1 ]]; then
    ready=0
    for attempt in {1..1000}; do
      if compgen -G '/tmp/wallet-phrase.*' >/dev/null; then ready=1; break; fi
      if ! kill -0 "$pid" 2>/dev/null; then break; fi
      sleep 0.01
    done
    if [[ "$ready" != 1 ]]; then
      printf 'Derivation did not start for %s\n' "$name" >&2
      return 1
    fi
    for phrase_path in /tmp/wallet-phrase.*; do
      [[ "$(stat -c %a "$phrase_path")" == 600 ]]
      [[ "$(stat -c %u "$phrase_path")" == "$(id -u)" ]]
    done
    printf '%s' "$1" >&3
  fi
  if wait "$pid"; then status=0; else status=$?; fi
  exec 3>&-
  if [[ "$status" != "$expected_status" ]]; then
    printf 'Wallet case %s exited %s; expected %s\n' "$name" "$status" "$expected_status" >&2
    cat "$test_root/$name.output" >&2
    return 1
  fi
  if compgen -G '/tmp/wallet-phrase.*' >/dev/null; then
    printf '%s\n' 'Wallet left a mnemonic file behind.' >&2
    return 1
  fi
}

# Observe kernel-enforced isolation, rather than relying only on Compose fields.
[[ "$(id -u)" != 0 ]]
grep -Eq '^CapEff:[[:space:]]+0+$' /proc/self/status
grep -Eq '^NoNewPrivs:[[:space:]]+1$' /proc/self/status
grep -Eq '^Seccomp:[[:space:]]+2$' /proc/self/status
[[ "$(ulimit -c)" == 0 ]]
[[ "$(ls /sys/class/net)" == lo ]]
[[ ! -e /var/run/docker.sock && ! -e /work/dapps ]]
if (: >>/tool/wallet_addresses.sh) 2>/dev/null; then
  printf '%s\n' 'Wallet source mount was writable.' >&2; exit 1
fi
if (printf probe >/out/wallet-write-probe) 2>/dev/null; then
  printf '%s\n' 'Wallet root filesystem was writable.' >&2; exit 1
fi
if timeout 2 bash -c 'exec 9<>/dev/tcp/1.1.1.1/443' 2>/dev/null; then
  printf '%s\n' 'Offline wallet reached an external network.' >&2; exit 1
fi
[[ "$(stat -f -c %T /tmp)" == tmpfs ]]

fixture='test test test test test test test test test test test junk'
run_case '' valid "$fixture"$'\n' 0
mapfile -t rows < <(grep -E '^[[:space:]]*[0-9]+[[:space:]]+m/' "$test_root/valid.transcript" | tr -d '\r')
expected=(
  0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
  0x70997970c51812dc3a010c7d01b50e0d17dc79c8
  0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc
  0x90f79bf6eb2c4f870365e785982e1f101e93b906
  0x15d34aaf54267db7d7c367839aaf71a00a2c6a65
  0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc
  0x976ea74026e726554db657fa54763abd0c3a0aa9
  0x14dc79964da2c08b23698b3d3cc7ca32193d9955
  0x23618e81e3f5cdf7f54c3d65f7fbc0abf5b21e8f
  0xa0ee7a142d267c1f36714e4a8f75612f20a79720
)
[[ "${#rows[@]}" == 10 ]]
for index in {0..9}; do
  read -r number path address <<<"${rows[$index]}"
  [[ "$number" == "$((index + 1))" ]]
  [[ "$path" == "m/44'/60'/0'/0/$index" ]]
  [[ "${address,,}" == "${expected[$index]}" ]]
done
assert_absent "$fixture" "$test_root/valid.transcript"
assert_absent '[[:xdigit:]]{64}' "$test_root/valid.transcript"
run_case --with-keys with_keys "$fixture"$'\n' 0
mapfile -t key_rows < <(grep -E '^[[:space:]]*[0-9]+[[:space:]]+m/' "$test_root/with_keys.transcript" | tr -d '\r')
[[ "${#key_rows[@]}" == 10 ]]
for index in {0..9}; do
  read -r number path address private_key extra <<<"${key_rows[$index]}"
  [[ "$number" == "$((index + 1))" && "$path" == "m/44'/60'/0'/0/$index" ]]
  [[ "${address,,}" == "${expected[$index]}" && -z "$extra" ]]
  [[ "$private_key" =~ ^0x[0-9a-fA-F]{64}$ ]]
  # These keys come only from the public fixture mnemonic, never operator input.
  key_address=$(cast wallet address --private-key "$private_key")
  [[ "${key_address,,}" == "${expected[$index]}" ]]
done
assert_absent "$fixture" "$test_root/with_keys.transcript"
run_case --with-keys keys_checksum $'test test test test test test test test test test test test test\n' 2
assert_absent '0x[[:xdigit:]]{40}' "$test_root/keys_checksum.transcript"
run_case --with-keys keys_cancelled "$fixture"$'\n' 130 $'\003'
assert_absent '0x[[:xdigit:]]{40}' "$test_root/keys_cancelled.transcript"
check_invalid_arguments() {
  if bash --noprofile --norc /tool/wallet_addresses.sh "$@" </dev/null >"$test_root/invalid-mode" 2>&1; then
    printf '%s\n' 'Wallet accepted unsupported arguments.' >&2; exit 1
  fi
  grep -q 'Usage:' "$test_root/invalid-mode"
  assert_absent 'Recovery phrase' "$test_root/invalid-mode"
}
check_invalid_arguments --with-key
check_invalid_arguments --with-keys extra
run_case '' trailing "$fixture"$'\n' 0 $'PUBLIC_TRAILING_INPUT_PROBE\n'
assert_absent PUBLIC_TRAILING_INPUT_PROBE "$test_root/trailing.transcript"
run_case '' cancelled_after_file "$fixture"$'\n' 130 $'\003'
run_case '' empty $'\n' 2
run_case '' eof $'\004' 2
run_case '' checksum $'test test test test test test test test test test test test\n' 2
assert_absent 'test test' "$test_root/checksum.transcript"
assert_absent '0x[[:xdigit:]]{40}' "$test_root/checksum.transcript"
run_case '' short $'test test\n' 2
assert_absent 'test test' "$test_root/short.transcript"
run_case '' cancel $'test\003' 130
assert_absent 'test' "$test_root/cancel.transcript"
if bash --noprofile --norc /tool/wallet_addresses.sh </dev/null >"$test_root/no-terminal" 2>&1; then
  printf '%s\n' 'Wallet accepted non-terminal input.' >&2
  exit 1
fi
printf '%s\n' 'Wallet checks passed: addresses and explicit key export for paths 0–9, hidden input, checksum, cancellation, cleanup, terminal requirement, and live isolation.'
