#!/usr/bin/env bash
# Reusable release tools are keyed by their exact archived build contexts.

release_tool_image() {
  local repository="$1" commit="$2" tool="$3" tree tag image metadata observed context extra reused=0
  case "$tool" in checks|foundry|node-deps|rpc-proxy) ;; *) printf 'Unknown release tool: %s\n' "$tool" >&2; return 2 ;; esac
  tree=$(GIT_NO_REPLACE_OBJECTS=1 git -C "$repository" rev-parse "$commit:containers/$tool") || return
  if [[ ! "$tree" =~ ^[0-9a-f]{40}$ ]]; then printf 'Invalid Git context identity for %s.\n' "$tool" >&2; return 2; fi
  tag="cam-release-tool-$tool:$tree"
  image=$(docker image ls --filter "reference=$tag" --quiet --no-trunc) || return
  if [[ -z "$image" ]]; then
    printf 'Building release tool %s for changed or missing context %s.\n' "$tool" "$tree" >&2
    if ! image=$(GIT_NO_REPLACE_OBJECTS=1 git -C "$repository" archive --format=tar "$commit:containers/$tool" |
        timeout -s TERM -k 15s 120s docker build --pull=false --quiet --tag "$tag" \
          --label "io.dapp32.release-tool-context=$tree" -); then
      printf 'Could not build release tool %s; deployment has not started.\n' "$tool" >&2
      return 2
    fi
  else reused=1; fi
  if [[ ! "$image" =~ ^sha256:[0-9a-f]{64}$ ]]; then printf 'Invalid image identity for release tool %s.\n' "$tool" >&2; return 2; fi
  metadata=$(docker image inspect --format '{{.Id}} {{index .Config.Labels "io.dapp32.release-tool-context"}}' "$image") || return
  read -r observed context extra <<< "$metadata"
  if [[ "$observed" != "$image" || "$context" != "$tree" || -n "$extra" ]]; then
    printf 'Release tool %s does not match its saved build-context identity.\n' "$tool" >&2
    return 2
  fi
  if [[ "$reused" == 1 ]]; then printf 'Reusing release tool %s: %s\n' "$tool" "$image" >&2; fi
  printf '%s\n' "$image"
}

release_tool_image_overlay() {
  local output="$1" pair service image
  shift
  {
    printf 'services:\n'
    for pair in "$@"; do
      read -r service image <<< "$pair"
      printf '  %s:\n    build: !reset null\n    image: %s\n    pull_policy: never\n' "$service" "$image"
    done
  } > "$output"
}

release_tool_images_prepare() {
  local repository="$1" commit="$2" output="$3" operation="${4:-deployment}" checks foundry node rpc
  checks=$(release_tool_image "$repository" "$commit" checks) || return
  foundry=$(release_tool_image "$repository" "$commit" foundry) || return
  node=$(release_tool_image "$repository" "$commit" node-deps) || return
  rpc=$(release_tool_image "$repository" "$commit" rpc-proxy) || return
  release_tool_image_overlay "$output/images-dependencies.yml" "soldeer-verify $checks"
  release_tool_image_overlay "$output/images-check.yml" "release-check $node"
  local -a deploy_images=( \
    "release-plan $node" "release-reference-export $foundry" "release-reference-prepare $node" \
    "release-rpc-proxy $rpc" "deploy-release $foundry" "release-artifact-dependencies $node" \
    "release-artifact-rpc-proxy $rpc" "release-artifact $node" )
  if [[ "$operation" == ui ]]; then deploy_images+=("release-ui-verify $foundry" "release-ui-publish $node"); fi
  release_tool_image_overlay "$output/images-deploy.yml" "${deploy_images[@]}"
  release_tool_image_overlay "$output/images-verify.yml" \
    "verify-input $node" "verify-rpc-proxy $rpc" "verify-provenance $node" "verify-release $foundry"
}

release_tool_images_prepare_network() {
  local repository="$1" commit="$2" output="$3" rpc
  rpc=$(release_tool_image "$repository" "$commit" rpc-proxy) || return
  release_tool_image_overlay "$output/images-setup-rpc.yml" "rpc-proxy $rpc"
}

release_tool_images_prepare_artifact() {
  local repository="$1" app_commit="$2" tool_commit="$3" output="$4" operation="${5:-deployment}" node admission rpc foundry checks
  node=$(release_tool_image "$repository" "$app_commit" node-deps) || return
  admission=$(release_tool_image "$repository" "$tool_commit" node-deps) || return
  rpc=$(release_tool_image "$repository" "$tool_commit" rpc-proxy) || return
  local -a artifact_images=("release-artifact-dependencies $admission" "release-artifact-rpc-proxy $rpc" "release-artifact $node")
  if [[ "$operation" == ui ]]; then
    foundry=$(release_tool_image "$repository" "$app_commit" foundry) || return
    checks=$(release_tool_image "$repository" "$app_commit" checks) || return
    release_tool_image_overlay "$output/images-dependencies.yml" "soldeer-verify $checks"
    artifact_images+=("release-ui-verify $foundry" "release-ui-publish $node")
  fi
  release_tool_image_overlay "$output/images-artifact.yml" "${artifact_images[@]}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
  if [[ "${1-}" == artifact || "${1-}" == ui-artifact ]]; then
    if [[ "$#" != 5 ]]; then printf '%s\n' 'Usage: release_tool_images.sh artifact|ui-artifact REPOSITORY APP_SOURCE_COMMIT TOOL_SOURCE_COMMIT PRIVATE_OUTPUT_DIR' >&2; exit 2; fi
    operation=deployment
    if [[ "$1" == ui-artifact ]]; then operation=ui; fi
    release_tool_images_prepare_artifact "$2" "$3" "$4" "$5" "$operation"
    exit
  fi
  if [[ "$#" != 4 ]]; then printf '%s\n' 'Usage: release_tool_images.sh release|ui|network REPOSITORY SOURCE_COMMIT PRIVATE_OUTPUT_DIR' >&2; exit 2; fi
  case "$1" in
    release) release_tool_images_prepare "$2" "$3" "$4" ;;
    ui) release_tool_images_prepare "$2" "$3" "$4" ui ;;
    network) release_tool_images_prepare_network "$2" "$3" "$4" ;;
    *) printf '%s\n' 'Choose release, ui, network, artifact or ui-artifact tool images.' >&2; exit 2 ;;
  esac
fi
