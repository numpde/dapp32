#!/usr/bin/env bash
# Resolve the selected engine's default-namespace identity for a private host owner.
# Host LOCAL_UID/GID remain unchanged; these IDs are container coordinates only.
release_identity_image() {
  printf '%s\n' 'docker.io/library/python:3.13-alpine@sha256:420cd0bf0f3998275875e02ecd5808168cf0843cbb4d3c536432f729247b2acc'
}

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
  if [[ -v _release_identity_endpoint && -v _release_identity_host &&
        -v _release_identity_userns && -v _release_identity_pair ]]; then
    if [[ "$_release_identity_endpoint" == "${CAM_DOCKER_ENDPOINT:?Docker context was not selected}" &&
          "$_release_identity_host" == "$host_uid:$host_gid" &&
          "$_release_identity_userns" == default &&
          "$_release_identity_pair" =~ ^(0|[1-9][0-9]*):(0|[1-9][0-9]*)$ ]]; then
      IFS=: read -r uid gid <<< "$_release_identity_pair"
      export RELEASE_CONTAINER_UID="$uid" RELEASE_CONTAINER_GID="$gid"
      return 0
    fi
  fi
  unset _release_identity_endpoint _release_identity_host _release_identity_userns _release_identity_pair
  wheel_image=$(release_identity_image)
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

# Scope Docker Compose's legacy LOCAL_UID/GID parameters to the verified
# container identity. The caller's LOCAL_UID/GID continue to mean host IDs.
# Only a selection made in THIS shell for THIS engine is sufficient.
release_with_mapped_owner() {
  # An EXIT trap can execute before identity selection completed. Check the
  # selection's presence before using its values under Bash nounset.
  if [[ $# -eq 0 || ! -v LOCAL_UID || ! -v LOCAL_GID ||
        ! -v CAM_DOCKER_ENDPOINT || ! -v _release_identity_endpoint ||
        ! -v _release_identity_host || ! -v _release_identity_userns ||
        ! -v _release_identity_pair || ! -v RELEASE_CONTAINER_UID ||
        ! -v RELEASE_CONTAINER_GID ]]; then
    printf '%s\n' 'Private bind mount requires a verified container identity for the selected local Docker engine.' >&2
    return 2
  fi
  local supplied="$LOCAL_UID:$LOCAL_GID" host="$(id -u):$(id -g)"
  # Host and mapped identity may both appear during a nested cleanup scope,
  # but stale identities cannot cross Docker endpoints or owners.
  if [[ "$_release_identity_endpoint" != "$CAM_DOCKER_ENDPOINT" ||
        "$_release_identity_host" != "$host" ||
        ( "$supplied" != "$host" && "$supplied" != "$_release_identity_pair" ) ||
        "$_release_identity_userns" != default ||
        -z "$_release_identity_pair" ||
        "$_release_identity_pair" != "$RELEASE_CONTAINER_UID:$RELEASE_CONTAINER_GID" ]]; then
    printf '%s\n' 'Private bind mount requires a verified container identity for the selected local Docker engine.' >&2
    return 2
  fi
  LOCAL_UID="$RELEASE_CONTAINER_UID" LOCAL_GID="$RELEASE_CONTAINER_GID" "$@"
}
