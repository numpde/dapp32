#!/usr/bin/env bash
# Resolve the operator's Docker context once, or validate a recursive handoff.
set -euo pipefail

fail() { printf 'Docker context selection: %s\n' "$1" >&2; exit 2; }
local_endpoint() {
  [[ ${#1} -le 4096 && $1 == unix:///* && ${1#unix:///} != '' && $1 != *'?'* && $1 != *'#'* && ! $1 =~ [[:cntrl:]] ]]
}
inspect_context() (
  local name=$1 endpoint output probe
  local -a lines
  [[ $name =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ ]] || return 1
  output=$(mktemp) || return 1
  trap 'rm -f -- "$output"' EXIT
  ulimit -f 128
  timeout -k 2s 10s env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
    docker context inspect --format '{{.Endpoints.docker.Host}}' "$name" >"$output" 2>/dev/null || return 1
  (( $(wc -c < "$output") <= 4097 )) || return 1
  if IFS= read -r -d '' probe < "$output"; then return 1; fi
  mapfile -t lines < "$output"
  (( ${#lines[@]} == 1 )) || return 1
  endpoint=${lines[0]}
  local_endpoint "$endpoint" || return 1
  printf '%s\n' "$endpoint"
)

[[ $# == 5 ]] || fail 'invalid selector invocation.'
context_origin=$1 context_name=$2 handoff_origin=$3 handoff_endpoint=$4 make_level=$5
if [[ $make_level =~ ^[1-9][0-9]*$ && $handoff_origin == 'command line' && -n $handoff_endpoint ]]; then
  [[ $context_origin != 'command line' || -z $context_name ]] || fail 'a recursive endpoint cannot be combined with an explicit context.'
  local_endpoint "$handoff_endpoint" || fail 'the inherited endpoint is not an absolute local Unix socket.'
  printf '%s\n' "$handoff_endpoint"
  exit 0
fi
if [[ $context_origin == 'command line' ]]; then
  [[ -n $context_name ]] || fail 'DOCKER_CONTEXT is empty; pass a local context name.'
  [[ $context_name =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ ]] || fail 'the context name is invalid.'
  endpoint=$(inspect_context "$context_name") || fail "cannot use context '$context_name'; select an existing local Unix-socket context."
  printf '%s\n' "$endpoint"
  exit 0
fi

if ! { exec {tty_fd}<>/dev/tty; } 2>/dev/null; then
  fail 'no interactive terminal is available; pass DOCKER_CONTEXT=<local-context> on the make command line.'
fi
listing_file=$(mktemp) || fail 'cannot create temporary context listing.'
trap 'rm -f -- "$listing_file"' EXIT
(ulimit -f 128; timeout -k 2s 10s env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
  docker context ls --format $'{{.Name}}\t{{.DockerEndpoint}}' >"$listing_file") || fail 'cannot list Docker contexts.'
(( $(wc -c < "$listing_file") <= 65536 )) || fail 'Docker returned an oversized context listing.'
[[ -s $listing_file ]] || fail 'Docker lists no local Unix-socket contexts.'
if IFS= read -r -d '' probe < "$listing_file"; then fail 'Docker returned a malformed context listing.'; fi
mapfile -t listing < "$listing_file"
(( ${#listing[@]} <= 128 )) || fail 'Docker returned too many contexts.'
names=() endpoints=()
declare -A seen_names=()
for entry in "${listing[@]}"; do
  [[ $entry == *$'\t'* ]] || fail 'Docker returned a malformed context listing.'
  name=${entry%%$'\t'*} endpoint=${entry#*$'\t'}
  [[ $name =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$ && -n $endpoint && ! $endpoint =~ [[:cntrl:]] ]] \
    || fail 'Docker returned a malformed context listing.'
  [[ ! -v "seen_names[$name]" ]] || fail 'Docker returned duplicate context names.'
  seen_names[$name]=1
  if local_endpoint "$endpoint"; then names+=("$name"); endpoints+=("$endpoint"); fi
done
(( ${#names[@]} )) || fail 'Docker lists no local Unix-socket contexts.'
printf 'Select a local Docker context (no default):\n' >&"$tty_fd"
for index in "${!names[@]}"; do printf '  %d) %s\n' "$((index + 1))" "${names[index]}" >&"$tty_fd"; done
printf 'Choice [1-%d]: ' "${#names[@]}" >&"$tty_fd"
IFS= read -r answer <&"$tty_fd" || fail 'context selection was cancelled.'
exec {tty_fd}>&-
for index in "${!names[@]}"; do
  if [[ $answer == "$((index + 1))" ]]; then printf '%s\n' "${endpoints[index]}"; exit 0; fi
done
fail 'choose one of the listed contexts.'
