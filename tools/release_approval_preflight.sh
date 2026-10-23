#!/bin/sh

release_approval_require_terminal() {
  if ! [ -t 0 ] || ! [ -t 1 ]; then
    printf '%s\n' 'Release approval requires an attached operator terminal.' >&2
    return 2
  fi
}

release_approval_require_image() {
  local actual digest
  if [ "${RELEASE_APPROVAL_IMAGE+x}" != x ]; then
    printf '%s\n' 'Select an existing approval-tool image by its exact local sha256 image ID.' >&2
    return 2
  fi
  case "$RELEASE_APPROVAL_IMAGE" in
    sha256:*) digest="${RELEASE_APPROVAL_IMAGE#sha256:}" ;;
    *) digest="" ;;
  esac
  if [ "${#digest}" -ne 64 ] || [ -n "$(printf '%s' "$digest" | tr -d '0-9a-f')" ]; then
    printf '%s\n' 'Select an existing approval-tool image by its exact local sha256 image ID.' >&2
    return 2
  fi
  if ! actual="$(docker image inspect --format '{{.Id}}' "$RELEASE_APPROVAL_IMAGE")"; then
    printf '%s\n' 'The selected release approval image is not present locally; install that exact image before deployment.' >&2
    return 2
  fi
  if [ "$actual" != "$RELEASE_APPROVAL_IMAGE" ]; then
    printf '%s\n' 'The local release approval image does not match the selected image ID.' >&2
    return 2
  fi
  export RELEASE_APPROVAL_IMAGE
}

release_approval_require_deployer() {
  local label="$1" address="$2" digits
  case "$address" in
    0x*) digits="${address#0x}" ;;
    *) digits="" ;;
  esac
  if [ "${#digits}" -ne 40 ] || [ -n "$(printf '%s' "$digits" | tr -d '0-9a-fA-F')" ] ||
     [ -z "$(printf '%s' "$digits" | tr -d '0')" ]; then
    printf '%s must be an independently supplied nonzero EVM address.\n' "$label" >&2
    return 2
  fi
}
