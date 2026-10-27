#!/usr/bin/env bash
set -euo pipefail
# Stdout carries only the immutable result; callers must also require exit 0.
exec 3>&1
exec 1>&2

if [[ ( $# != 2 && $# != 3 ) || ! $1 =~ ^[0-9a-f]{40}$ ]]; then
  printf '%s\n' 'Usage: release_approval_image_build.sh SOURCE_COMMIT NEW_OUTPUT_DIR' >&2
  exit 2
fi

source_commit=$1
output_dir=$2
image_owner=operator
if [[ $# == 3 ]]; then image_owner="$3"; fi
if [[ "$image_owner" != operator && ! "$image_owner" =~ ^cam-rehearsal-[a-z0-9]+$ ]]; then
  printf '%s\n' 'Approval-image owner must be operator or the owning rehearsal project.' >&2
  exit 2
fi
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
if [[ $(id -u) == 0 ]]; then
  printf '%s\n' 'Build the approval image as a non-root operator.' >&2
  exit 2
fi
validate_output_path() {
  local path=$1 parent=$2 current=/ part
  local -a parts
  if [[ $path != /* || $(realpath -ms -- "$path") != "$path" ]]; then
    printf '%s\n' 'The approval image output must be a normalized absolute path.' >&2
    exit 2
  fi
  IFS=/ read -r -a parts <<< "$parent"
  for part in "${parts[@]}"; do
    if [[ -z $part ]]; then continue; fi
    if [[ $current == / ]]; then current=/$part; else current=$current/$part; fi
    if [[ -L $current ]]; then
      printf '%s\n' 'The approval image output parent must not pass through a symlink.' >&2
      exit 2
    fi
  done
  if [[ ! -d $parent ]]; then
    printf '%s\n' 'The approval image output parent must be an existing directory.' >&2
    exit 2
  fi
  case $path in
    "$repo_root"|"$repo_root"/*)
      printf '%s\n' 'The approval image output must be outside the repository.' >&2
      exit 2 ;;
  esac
  if [[ -e $path || -L $path ]]; then
    printf '%s\n' 'The approval image output directory must be new.' >&2
    exit 2
  fi
}
output_parent=$(dirname -- "$output_dir")
validate_output_path "$output_dir" "$output_parent"
if [[ $(git -C "$repo_root" cat-file -t "$source_commit" 2>/dev/null) != commit ]]; then
  printf '%s\n' 'SOURCE_COMMIT must identify a local Git commit.' >&2
  exit 2
fi

source "$repo_root/tools/release_process.sh"
source "$repo_root/tools/release_approval_images.sh"
release_process_init
# Internal allocation state; not an optional operator input.
declare work_dir=""
stage_started=0
identity_started=0
cleanup() {
  local status=$? cleanup_failed=0
  set +e
  if ! release_process_cleanup_begin; then
    printf '%s\n' 'Approval image launch command did not shut down cleanly; retaining its mounted inputs.' >&2
    status=1
    cleanup_failed=1
  fi
  if [[ $identity_started == 1 ]] && ! release_run_owned 60 "${identity_compose[@]}" down --timeout 10 --volumes --remove-orphans >&2; then
    printf 'Approval identity cleanup failed; inspect project %s-identity.\n' "$project_name" >&2
    status=1
    cleanup_failed=1
  fi
  if [[ $stage_started == 1 ]]; then
    if ! release_run_owned 60 docker compose -p "$project_name" "${compose_files[@]}" down --timeout 10 --volumes --remove-orphans >&2; then
      printf 'Approval image teardown failed; inspect project %s. Mounted inputs retained at %s.\n' "$project_name" "$work_dir" >&2
      status=1
      cleanup_failed=1
    fi
  fi
  if [[ ${artifact_dir+x} == x ]] && ! rm -rf -- "$artifact_dir"; then
    printf 'Could not remove temporary image provenance: %s\n' "$artifact_dir" >&2
    status=1
  fi
  if [[ -n $work_dir && $cleanup_failed == 0 ]] && ! rm -rf -- "$work_dir"; then
    printf 'Could not remove approval image build inputs: %s\n' "$work_dir" >&2
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT

# All image inputs come from this archive, not from the checkout being deployed.
work_dir=$(mktemp -d)
source_dir=$work_dir/source
manifest_dir=$work_dir/manifests
context_dir=$work_dir/context
mkdir -m 0700 "$source_dir" "$manifest_dir" "$context_dir"
project_name=cam-approval-image-$(basename "$work_dir" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9')
compose_files=(-f "$source_dir/compose/package-deps.yml" -f "$source_dir/compose/release/approval-image.yml")

release_run_owned 15 git -C "$repo_root" archive --format=tar --output="$work_dir/source.tar" "$source_commit"
release_run_owned 15 tar -xf "$work_dir/source.tar" -C "$source_dir"
rm -- "$work_dir/source.tar"
for input in \
  "$source_dir/js/package.json" \
  "$source_dir/js/package-lock.json" \
  "$source_dir/containers/release-approval/Dockerfile" \
  "$source_dir/containers/release-approval/prepare-context.mjs" \
  "$source_dir/compose/release/approval-image.yml"; do
  if [[ -L $input || ! -f $input ]]; then
    printf 'Missing or unsafe approval image source input: %s\n' "$input" >&2
    exit 2
  fi
done
cp "$source_dir/js/package.json" "$source_dir/js/package-lock.json" "$manifest_dir/"
for manifest in "$source_dir"/js/packages/*/package.json "$source_dir"/js/apps/*/package.json; do
  if [[ -L $manifest || ! -f $manifest ]]; then
    printf 'Missing or unsafe npm workspace manifest: %s\n' "$manifest" >&2
    exit 2
  fi
  relative=${manifest#"$source_dir/js/"}
  mkdir -p "$manifest_dir/$(dirname "$relative")"
  cp "$manifest" "$manifest_dir/$relative"
done

export LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) ALLOW_UPDATE=0
export PACKAGE_INPUT_DIR=$manifest_dir
export RELEASE_APPROVAL_SOURCE_DIR=$source_dir RELEASE_APPROVAL_CONTEXT_DIR=$context_dir

identity_compose=(docker compose --env-file /dev/null -p "$project_name-identity" -f "$repo_root/compose/release/approval-image.yml")
identity_started=1
release_run_owned 15 "${identity_compose[@]}" run --pull never --rm --no-deps -T release-approval-identity > "$work_dir/input-digest"
input_digest=$(<"$work_dir/input-digest")
if [[ ! "$input_digest" =~ ^[0-9a-f]{64}$ ]]; then
  printf '%s\n' 'Approval-input identification returned an invalid digest.' >&2
  exit 2
fi
built=0
cache_tag="cam-release-approval:$input_digest"
image_id=$(docker image ls --filter "reference=$cache_tag" --quiet --no-trunc)
if [[ -z "$image_id" ]]; then
  built=1
  if [[ "$image_owner" != operator ]]; then
    source "$repo_root/tools/release_approval_images.sh"
    cache_tag=$(release_approval_fixture_tag "$image_owner")
  fi
  for base in \
    $(sed -n 's/^FROM \([^ ]*\).*/\1/p' "$source_dir/containers/release-approval/Dockerfile") \
    $(sed -n 's/^FROM \([^ ]*\).*/\1/p' "$source_dir/containers/node-deps/Dockerfile") \
    $(sed -n 's/^FROM \([^ ]*\).*/\1/p' "$source_dir/containers/https-egress-proxy/Dockerfile"); do
    if ! docker image inspect "$base" >/dev/null 2>&1; then
      printf 'Pinned image prerequisite is absent locally: %s\n' "$base" >&2
      printf '%s\n' 'Acquire and review this base explicitly before running the approval image build.' >&2
      exit 2
    fi
  done

  # The npm stage sees manifests through the registry-only proxy, not repository source.
  stage_started=1
  release_run_owned 15 docker compose -p "$project_name" "${compose_files[@]}" build --pull=false package-stage package-egress-proxy
  release_run_owned 15 docker compose -p "$project_name" "${compose_files[@]}" run --pull never --rm package-stage
  release_run_owned 15 docker compose -p "$project_name" "${compose_files[@]}" run --pull never --no-deps --rm -T release-approval-context

  release_run_owned 15 docker build --network=none --pull=false --tag "$cache_tag" \
  --label "org.opencontainers.image.revision=$source_commit" \
  --label "io.cam.approval-inputs=$input_digest" --label "io.cam.approval-owner=$image_owner" \
  --quiet "$context_dir" >"$work_dir/image-id"
  image_id=$(<"$work_dir/image-id")
fi
lock_sha256=$(sha256sum "$source_dir/js/package-lock.json" | cut -d ' ' -f1)
dockerfile_sha256=$(sha256sum "$source_dir/containers/release-approval/Dockerfile" | cut -d ' ' -f1)
if [[ ! $image_id =~ ^sha256:[0-9a-f]{64}$ ]]; then
  printf 'Docker build returned an invalid image ID: %s\n' "$image_id" >&2
  exit 1
fi
metadata=$(docker image inspect --format '{{.Id}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{index .Config.Labels "io.cam.approval-inputs"}} {{index .Config.Labels "io.cam.approval-owner"}} {{json (index .Config "Entrypoint")}}' "$image_id")
read -r observed_id observed_commit observed_digest observed_owner observed_entrypoint extra <<< "$metadata"
if ! release_approval_is_entrypoint "$observed_entrypoint" || [[ "$built" == 1 && "$observed_commit" != "$source_commit" ]]; then
  printf '%s\n' 'Approval image entrypoint or fresh-build source differs from the selected tool.' >&2
  exit 1
fi
if [[ "$observed_id" != "$image_id" || ! "$observed_commit" =~ ^[0-9a-f]{40}$ || "$observed_digest" != "$input_digest" || -n "$extra" || ( "$observed_owner" != operator && "$observed_owner" != "$image_owner" ) ]]; then
  printf '%s\n' 'The approval image metadata differs from its selected input identity or owner.' >&2
  exit 1
fi
if [[ "$built" == 0 ]]; then printf 'Reusing approval tool for unchanged inputs: %s\n' "$image_id" >&2; fi
artifact_dir=$(mktemp -d "$output_dir.tmp.XXXXXX")
printf '{"imageId":"%s","approvalToolSourceCommit":"%s","packageLockSha256":"%s","dockerfileSha256":"%s","approvalInputSha256":"%s","imageOwner":"%s"}\n' \
  "$image_id" "$observed_commit" "$lock_sha256" "$dockerfile_sha256" "$input_digest" "$observed_owner" > "$artifact_dir/approval-image.json"
validate_output_path "$output_dir" "$output_parent"
mv -T -- "$artifact_dir" "$output_dir"
unset artifact_dir
printf 'Approval tool image ready: %s (source %s). Build record: %s\n' \
  "$image_id" "$observed_commit" "$output_dir/approval-image.json"
printf '%s\n' "$image_id" >&3
