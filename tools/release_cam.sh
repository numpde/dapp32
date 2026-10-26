#!/usr/bin/env bash
# CAM root selection and original component exports for preparation/publication.

release_cam_source_projects=()

release_cam_select_root() {
  if [[ -v ROOT && "$ROOT" == new && ( ! -v ROOT_ARTIFACT || -z "$ROOT_ARTIFACT" ) ]]; then
    export CAM_RELEASE_ROOT=new
    unset CAM_RELEASE_ROOT_ARTIFACT_FILE
  elif [[ -v ROOT_ARTIFACT && -n "$ROOT_ARTIFACT" && ( ! -v ROOT || -z "$ROOT" ) ]]; then
    require_release_file "$ROOT_ARTIFACT" ROOT_ARTIFACT
    export CAM_RELEASE_ROOT=existing CAM_RELEASE_ROOT_ARTIFACT_FILE="$ROOT_ARTIFACT"
  else
    printf '%s\n' 'Choose ROOT=new or ROOT_ARTIFACT identifying an existing root.' >&2
    return 2
  fi
}

release_cam_sources_cleanup() {
  local project failed=0
  for project in "${release_cam_source_projects[@]}"; do
    if ! COMPOSE_PROJECT_NAME="$project" ALLOW_UPDATE=0 release_run_owned "$release_command_grace" \
        docker compose -f "$RELEASE_SOURCE_DIR/compose/release/cam-source.yml" down --timeout 10 --volumes --remove-orphans >/dev/null; then failed=1; fi
  done
  return "$failed"
}

release_cam_archive() {
  local commit="$1" destination="$2" archive="$ceremony_root/component-source.tar"
  mkdir --mode=0700 -- "$destination"
  GIT_NO_REPLACE_OBJECTS=1 git archive --format=tar --output="$archive" "$commit"
  tar --extract --file="$archive" --directory="$destination"
  rm -- "$archive"
}

release_cam_export() {
  local class="$1" commit="$2" purpose="$3" project="$ceremony_project-source-$1"
  export CAM_COMPONENT_SOURCE_DIR="$CAM_RELEASE_PREPARED_DIR/sources/$class"
  export CAM_COMPONENT_ARTIFACTS_DIR="$CAM_RELEASE_PREPARED_DIR/compiler/$class"
  export CAM_COMPONENT_SOURCE_PURPOSE="$purpose" CAM_COMPONENT_APP="$CAM_RELEASE_APP"
  CAM_COMPONENT_FOUNDRY_IMAGE=$(release_tool_image "$release_repository" "$commit" foundry)
  CAM_COMPONENT_CHECKS_IMAGE=$(release_tool_image "$release_repository" "$commit" checks)
  export CAM_COMPONENT_FOUNDRY_IMAGE CAM_COMPONENT_CHECKS_IMAGE
  release_cam_archive "$commit" "$CAM_COMPONENT_SOURCE_DIR"
  cp -a -- "$release_repository/dapps/dependencies" "$CAM_COMPONENT_SOURCE_DIR/dapps/dependencies"
  release_cam_source_projects+=("$project")
  COMPOSE_PROJECT_NAME="$project" ALLOW_UPDATE=0 release_run_owned "$release_command_grace" \
    docker compose -f "$RELEASE_SOURCE_DIR/compose/release/cam-source.yml" run --rm release-cam-source \
    > "$CAM_RELEASE_PREPARED_DIR/$class-compilation.log" 2>&1
}

release_cam_prepare_sources() {
  local -a sources
  compose_release run --rm --no-deps -T release-cam-inputs
  mapfile -d '' -t sources < "$CAM_RELEASE_PREPARED_DIR/inputs/sources"
  export "${sources[@]}"
  release_cam_export business "$CAM_BUSINESS_SOURCE_COMMIT" source-contracts
  release_cam_export ui "$CAM_UI_SOURCE_COMMIT" source-ui
  if [[ "$CAM_RELEASE_APP" == bike-nft || "$CAM_RELEASE_ROOT" == existing ]]; then
    release_cam_export root "$CAM_ROOT_SOURCE_COMMIT" source-root
  fi
  release_cam_archive "$CAM_AUTHORING_SOURCE_COMMIT" "$CAM_RELEASE_PREPARED_DIR/sources/authoring"
}

release_cam_prepare_root_proof() {
  local output="$1" selected_commit release_repository="$PWD"
  source "$ceremony_source/tools/release_tool_images.sh"
  export RELEASE_SOURCE_DIR="$ceremony_source"
  mkdir --mode=0700 -- "$output/root-proof" "$output/root-proof/sources" "$output/root-proof/compiler" "$output/root-proof/compiler/root"
  if [[ "$CAM_RELEASE_ROOT" == existing ]]; then
    compose_release run --rm --no-deps -T release-cam-root-source
    selected_commit=$(< "$output/root-proof/source-commit")
    local CAM_RELEASE_PREPARED_DIR="$output/root-proof"
    release_cam_export root "$selected_commit" source-root
  fi
}
