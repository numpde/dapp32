#!/usr/bin/env bash
# Materialize selected source trees and guarded public files; callers own selection and lifecycle.
copy_public_source_file() {
  reject_release_path_symlinks "$1" 'Public source input' || return "$?"
  reject_release_path_symlinks "$2" 'Public source output' || return "$?"
  cp -- "$1" "$2"
}

release_archive_source() (
  local repository="$1" commit="$2" destination="$3" archive
  shift 3
  mkdir --mode=0700 -- "$destination" || return "$?"
  archive=$(mktemp -- "$(dirname -- "$destination")/.source-archive-XXXXXXXX") || return "$?"
  trap 'status=$?; if ! rm -- "$archive"; then exit 2; fi; exit "$status"' EXIT
  GIT_NO_REPLACE_OBJECTS=1 git -C "$repository" archive --format=tar --output="$archive" "$commit" "$@" || return "$?"
  tar --extract --file="$archive" --directory="$destination"
)

# Compare independently chosen preparation tools with retained CAM authoring.
# Original business, UI and authoring sources remain pinned to their artifacts.
release_review_tool_delta() {
  if [[ $# != 3 ]]; then printf '%s\n' 'Expected repository and two full Git commits.' >&2; return 2; fi
  local repository="$1" authored="$2" tooling="$3" answer
  if [[ ! "$authored" =~ ^[0-9a-f]{40}$ || ! "$tooling" =~ ^[0-9a-f]{40}$ ]]; then
    printf '%s\n' 'Source review requires full Git commit IDs.' >&2; return 2
  fi
  if [[ "$authored" == "$tooling" ]]; then return 0; fi
  if ! GIT_NO_REPLACE_OBJECTS=1 git -C "$repository" cat-file -e "$authored^{commit}" ||
     ! GIT_NO_REPLACE_OBJECTS=1 git -C "$repository" cat-file -e "$tooling^{commit}"; then
    printf '%s\n' 'Saved authoring or selected tooling commit is missing.' >&2; return 2
  fi
  printf '\nSaved CAM authoring source: %s\nSelected preparation tools: %s\n' "$authored" "$tooling"
  printf '%s\n' 'Original business/UI artifacts and CAM authoring remain pinned.'
  printf '%s\n' 'Changed committed files:'
  GIT_NO_REPLACE_OBJECTS=1 git -C "$repository" --no-pager diff --no-ext-diff --no-renames --no-color --name-status "$authored" "$tooling" || return
  GIT_NO_REPLACE_OBJECTS=1 git -C "$repository" --no-pager diff --no-ext-diff --no-renames --no-color --stat "$authored" "$tooling" || return
  if GIT_NO_REPLACE_OBJECTS=1 git -C "$repository" diff --quiet "$authored" "$tooling" -- dapps js/apps js/packages; then
    printf '%s\n' 'Assessment: no changes to dapps or application/package source files.'
  else
    printf '%s\n' 'Assessment: application/package sources also changed in the checkout.'
    printf '%s\n' 'The actual authoring and deployed component sources remain pinned.'
  fi
  if [[ ! -t 0 || ! -t 1 ]]; then
    printf '%s\n' 'Different tool commits require an interactive review; no output was allocated.' >&2
    return 2
  fi
  while true; do
    printf '%s' 'Type diff for full patch, proceed to use newer tools, or cancel: ' >&2
    if ! IFS= read -r answer; then return 2; fi
    case "$answer" in
      diff) GIT_NO_REPLACE_OBJECTS=1 git -C "$repository" --no-pager diff --no-ext-diff --no-renames --no-color "$authored" "$tooling" || return ;;
      proceed) return 0 ;;
      cancel) return 2 ;;
      *) printf '%s\n' 'Choose diff, proceed or cancel.' >&2 ;;
    esac
  done
}
