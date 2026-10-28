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
