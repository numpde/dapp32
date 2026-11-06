#!/usr/bin/env bash
# Resolve the selected engine's default-namespace identity for a private host owner.
# Host LOCAL_UID/GID remain unchanged; these IDs are container coordinates only.
release_select_container_identity() {
  local wheel_image selected uid gid
  if [[ "${LOCAL_UID:?missing host UID}:${LOCAL_GID:?missing host GID}" != "$(id -u):$(id -g)" ]]; then
    printf '%s\\n' 'Host-owned release operations require the invoking user and group IDs.' >&2
    return 2
  fi
  wheel_image='docker.io/library/python:3.13-alpine@sha256:420cd0bf0f3998275875e02ecd5808168cf0843cbb4d3c536432f729247b2acc'
  source tools/release_tool_images.sh
  release_acquire_image "$wheel_image" || return 2
  selected=$(python3 -I -S -B tools/release_identity.py \
    --endpoint "${CAM_DOCKER_ENDPOINT:?Docker context was not selected}" --image "$wheel_image") || return 2
  if [[ ! "$selected" =~ ^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$ ]]; then
    printf '%s\\n' 'Selected Docker engine returned an invalid mapped release identity.' >&2
    return 2
  fi
  IFS=: read -r uid gid <<< "$selected"
  if [[ -z "$uid" || -z "$gid" ]]; then
    printf '%s\n' 'Selected Docker engine returned an invalid mapped release identity.' >&2
    return 2
  fi
  export RELEASE_CONTAINER_UID="$uid" RELEASE_CONTAINER_GID="$gid"
}
