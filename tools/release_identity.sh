#!/usr/bin/env bash
# Resolve the selected engine's default-namespace identity for a private host owner.
# Host LOCAL_UID/GID remain unchanged; these IDs are container coordinates only.
release_select_container_identity() {
  local wheel_image selected uid gid status host_uid host_gid
  # Exported numbers from a previous call are not evidence for a new selection.
  unset RELEASE_CONTAINER_UID RELEASE_CONTAINER_GID
  host_uid=$(id -u) host_gid=$(id -g)
  if [[ "${LOCAL_UID:?missing host UID}:${LOCAL_GID:?missing host GID}" != "$host_uid:$host_gid" ]]; then
    printf '%s\n' 'Host-owned release operations require the invoking user and group IDs.' >&2
    return 2
  fi
  # Cache only in this shell and only for this endpoint, host owner and namespace
  # policy; a different invocation remeasures its selected engine.
  if [[ ${_release_identity_endpoint-} == "${CAM_DOCKER_ENDPOINT:?Docker context was not selected}" &&
        ${_release_identity_host-} == "$host_uid:$host_gid" &&
        ${_release_identity_userns-} == default &&
        ${_release_identity_pair-} =~ ^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$ ]]; then
    IFS=: read -r uid gid <<< "$_release_identity_pair"
    export RELEASE_CONTAINER_UID="$uid" RELEASE_CONTAINER_GID="$gid"
    return 0
  fi
  unset _release_identity_endpoint _release_identity_host _release_identity_userns _release_identity_pair
  wheel_image='docker.io/library/python:3.13-alpine@sha256:420cd0bf0f3998275875e02ecd5808168cf0843cbb4d3c536432f729247b2acc'
  source tools/release_tool_images.sh
  release_acquire_image "$wheel_image" || return 2
  if selected=$(python3 -I -S -B tools/release_identity.py \
    --endpoint "${CAM_DOCKER_ENDPOINT:?Docker context was not selected}" --image "$wheel_image"); then
    :
  else
    status=$?
    return "$status"
  fi
  if [[ ! "$selected" =~ ^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$ ]]; then
    printf '%s\n' 'Selected Docker engine returned an invalid mapped release identity.' >&2
    return 2
  fi
  IFS=: read -r uid gid <<< "$selected"
  _release_identity_endpoint="$CAM_DOCKER_ENDPOINT"
  _release_identity_host="$host_uid:$host_gid"
  _release_identity_userns=default
  _release_identity_pair="$selected"
  export RELEASE_CONTAINER_UID="$uid" RELEASE_CONTAINER_GID="$gid"
}
