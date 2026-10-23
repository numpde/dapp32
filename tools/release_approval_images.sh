#!/usr/bin/env bash
# Shared host-side image identity and replacement operations.

release_approval_installed_images() {
  local image_list image_id observations observed_id tool_source entrypoint
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
    if ! observations="$(docker image inspect --format '{{.Id}}{{printf "\t"}}{{index .Config.Labels "org.opencontainers.image.revision"}}{{printf "\t"}}{{json (index .Config "Entrypoint")}}' "${image_ids[@]}")"; then
      printf '%s\n' 'Cannot inspect the local image inventory; Docker batch inspection failed.' >&2
      return 2
    fi
    while IFS=$'\t' read -r observed_id tool_source entrypoint; do
      if [[ ! "$observed_id" =~ ^sha256:[0-9a-f]{64}$ || " ${image_ids[*]} " != *" $observed_id "* ]]; then
        printf '%s\n' 'Docker inspection returned an image ID outside the requested inventory.' >&2
        return 2
      fi
      if [[ ! "$tool_source" =~ ^[0-9a-f]{40}$ ]]; then continue; fi
      if [[ "$entrypoint" != '["node","--experimental-strip-types","/app/tools/release-approval/run.ts"]' ]]; then continue; fi
      printf '%s\t%s\n' "$observed_id" "$tool_source"
    done <<< "$observations"
  fi
}

release_approval_build_image() {
  timeout -s TERM -k 90s 120s bash tools/release_approval_image_build.sh "$1" "$2"
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

release_approval_retire_images() {
  local new_image="$1" old_images="$2" image_id tool_source failed=0
  while IFS=$'\t' read -r image_id tool_source; do
    if [[ -z "$image_id" ]]; then continue; fi
    if [[ "$image_id" == "$new_image" ]]; then
      printf 'Keeping approval image %s (source %s): this is the verified new image.\n' "$image_id" "$tool_source"
      continue
    fi
    printf 'Removing old approval image %s (source %s).\n' "$image_id" "$tool_source"
    if docker image rm --no-prune "$image_id"; then
      printf 'Removed approval image %s (source %s).\n' "$image_id" "$tool_source"
    else
      printf 'Could not remove old approval image %s (source %s); see the Docker reason above.\n' "$image_id" "$tool_source" >&2
      failed=1
    fi
  done <<< "$old_images"
  if [[ "$failed" != 0 ]]; then
    printf 'New approval image %s was built successfully; old-image cleanup was incomplete.\n' "$new_image" >&2
  fi
  return "$failed"
}
