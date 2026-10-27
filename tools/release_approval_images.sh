#!/usr/bin/env bash
# Shared host-side approval-image discovery, preparation and fixture cleanup.

release_approval_is_entrypoint() {
  [[ "$1" == '["node","--experimental-strip-types","/app/tools/release-approval/run.ts"]' ]]
}

release_approval_installed_images() {
  local pinned="$1" image_list image_id observations observed_id tool_source entrypoint owner
  local -a image_ids=()
  if ! image_list="$(docker image ls --all --filter label=org.opencontainers.image.revision --no-trunc --quiet)"; then
    printf '%s\n' 'Cannot discover installed approval-tool images: Docker image listing failed.' >&2
    return 2
  fi
  while IFS= read -r image_id; do
    if [[ -z "$image_id" ]]; then continue; fi
    if [[ ! "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
      printf '%s\n' 'Docker image listing returned an invalid image ID.' >&2
      return 2
    fi
    image_ids+=("$image_id")
  done < <(printf '%s\n' "$image_list" | sort -u)
  if [[ "${#image_ids[@]}" -gt 0 ]]; then
    if ! observations="$(docker image inspect --format '{{.Id}}{{printf "\t"}}{{index .Config.Labels "org.opencontainers.image.revision"}}{{printf "\t"}}{{json (index .Config "Entrypoint")}}{{printf "\t"}}{{index .Config.Labels "io.cam.approval-owner"}}' "${image_ids[@]}")"; then
      printf '%s\n' 'Cannot inspect the local image inventory; Docker batch inspection failed.' >&2
      return 2
    fi
    while IFS=$'\t' read -r observed_id tool_source entrypoint owner; do
      if [[ ! "$observed_id" =~ ^sha256:[0-9a-f]{64}$ || " ${image_ids[*]} " != *" $observed_id "* ]]; then
        printf '%s\n' 'Docker inspection returned an image ID outside the requested inventory.' >&2
        return 2
      fi
      if [[ ! "$tool_source" =~ ^[0-9a-f]{40}$ ]]; then continue; fi
      if ! release_approval_is_entrypoint "$entrypoint"; then continue; fi
      if [[ "$owner" != operator && "$owner" != '<no value>' && -n "$owner" ]]; then
        if [[ "$observed_id" != "$pinned" || ! -v RELEASE_REHEARSAL_NETWORK ]]; then continue; fi
        if [[ "$RELEASE_REHEARSAL_NETWORK" != "$owner-rehearsal" ]]; then continue; fi
      fi
      printf '%s\t%s\n' "$observed_id" "$tool_source"
    done <<< "$observations"
  fi
}

release_approval_build_image() {
  timeout -s TERM -k 90s 120s bash tools/release_approval_image_build.sh "$@"
}

release_approval_default_output() {
  local source_commit="$1" stamp parent current=/ part
  local -a parts
  stamp=$(date -u +%Y%m%dT%H%M%S%NZ)
  parent="$HOME/Documents/${stamp:0:8}--dapp32-approval"
  if [[ "$parent" != /* || "$(realpath -ms -- "$parent")" != "$parent" ]]; then
    printf '%s\n' 'The default approval-image output parent must be a normalized absolute path.' >&2
    return 2
  fi
  IFS=/ read -r -a parts <<< "$parent"
  for part in "${parts[@]}"; do
    if [[ -z "$part" ]]; then continue; fi
    if [[ "$current" == / ]]; then current="/$part"; else current="$current/$part"; fi
    if [[ -L "$current" || ( -e "$current" && ! -d "$current" ) ]]; then
      printf 'Cannot create approval-image output parent through a symlink or non-directory: %s\n' "$current" >&2
      return 2
    fi
  done
  mkdir -p -- "$parent"
  printf '%s/%s-%s\n' "$parent" "$stamp" "${source_commit:0:8}"
}

release_approval_fixture_tag() {
  if [[ ! "$1" =~ ^cam-rehearsal-[a-z0-9]+$ ]]; then
    printf '%s\n' 'Approval-image cleanup requires its exact rehearsal project.' >&2
    return 2
  fi
  printf 'cam-rehearsal-approval:%s\n' "$1"
}

release_approval_remove_fixture() {
  local project="$1" tag image metadata observed owner
  tag=$(release_approval_fixture_tag "$project") || return
  image=$(docker image ls --filter "reference=$tag" --quiet --no-trunc) || return
  if [[ -z "$image" ]]; then return 0; fi
  metadata=$(docker image inspect --format '{{.Id}} {{index .Config.Labels "io.cam.approval-owner"}}' "$image") || return
  read -r observed owner <<< "$metadata"
  if [[ ! "$image" =~ ^sha256:[0-9a-f]{64}$ || "$observed" != "$image" || "$owner" != "$project" ]]; then
    printf 'Approval image at %s does not belong to this rehearsal; retained.\n' "$tag" >&2
    return 2
  fi
  printf 'Removing approval image owned by this rehearsal: %s\n' "$tag"
  docker image rm --no-prune "$tag"
}
