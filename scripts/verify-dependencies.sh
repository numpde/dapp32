#!/usr/bin/env bash
set -euo pipefail

mode="verify"
root="/work"

if [[ "${1:-}" == "--write" ]]; then
  mode="write"
  shift
fi

if [[ $# -gt 0 ]]; then
  root="$1"
fi

lock_file="$root/soldeer.lock"
remappings_file="$root/remappings.txt"
checksums_file="$root/dependency-checksums.txt"
dependencies_dir="$root/dependencies"

die() {
  printf 'deps-verify: %s\n' "$*" >&2
  exit 1
}

require_file() {
  [[ -f "$1" ]] || die "missing required file: $1"
}

require_dir() {
  [[ -d "$1" ]] || die "missing required directory: $1"
}

dependency_list() {
  awk '
    function value(line) {
      sub(/^[^"]*"/, "", line)
      sub(/".*$/, "", line)
      return line
    }

    /^\[\[dependencies\]\]/ {
      if (name != "" || version != "") {
        if (name == "" || version == "") {
          exit 2
        }
        print name "\t" version
      }
      name = ""
      version = ""
      next
    }

    /^name = / {
      name = value($0)
      next
    }

    /^version = / {
      version = value($0)
      next
    }

    END {
      if (name != "" || version != "") {
        if (name == "" || version == "") {
          exit 2
        }
        print name "\t" version
      }
    }
  ' "$lock_file"
}

tree_hash() {
  local dir="$1"

  (
    cd "$dir"
    find . -type f | LC_ALL=C sort | while IFS= read -r path; do
      rel="${path#./}"
      file_hash="$(sha256sum -- "$rel" | awk '{ print $1 }')"
      printf '%s  %s\n' "$file_hash" "$rel"
    done
  ) | sha256sum | awk '{ print $1 }'
}

load_dependency_list() {
  local dependencies

  dependencies="$(dependency_list)" || die "could not parse $lock_file"
  [[ -n "$dependencies" ]] || die "no dependencies found in $lock_file"
  printf '%s\n' "$dependencies"
}

dependency_keys() {
  local dependencies="$1"
  local name
  local version

  while IFS=$'\t' read -r name version; do
    printf '%s\n' "$name-$version"
  done <<< "$dependencies"
}

actual_dependency_dirs() {
  find "$dependencies_dir" -mindepth 1 -maxdepth 1 -type d | while IFS= read -r dir; do
    basename "$dir"
  done | LC_ALL=C sort
}

verify_dependency_set() {
  local dependencies="$1"
  local duplicate
  local missing
  local unexpected
  local unexpected_files

  duplicate="$(dependency_keys "$dependencies" | LC_ALL=C sort | uniq -d)"
  missing="$(comm -23 <(dependency_keys "$dependencies" | LC_ALL=C sort) <(actual_dependency_dirs))"
  unexpected="$(comm -13 <(dependency_keys "$dependencies" | LC_ALL=C sort) <(actual_dependency_dirs))"
  unexpected_files="$(find "$dependencies_dir" -mindepth 1 -maxdepth 1 ! -type d | LC_ALL=C sort)"

  [[ -z "$duplicate" ]] || die "duplicate dependencies in $lock_file: $duplicate"
  [[ -z "$missing" ]] || die "missing dependency directories: $missing"
  [[ -z "$unexpected" ]] || die "unexpected dependency directories: $unexpected"
  [[ -z "$unexpected_files" ]] || die "unexpected dependency files: $unexpected_files"
}

checksum_keys() {
  awk '
    /^[[:space:]]*#/ || /^[[:space:]]*$/ {
      next
    }
    length($1) == 64 && $1 ~ /^[0-9a-f]+$/ && NF == 2 {
      print $2
      next
    }
    {
      exit 2
    }
  ' "$checksums_file"
}

verify_checksum_set() {
  local dependencies="$1"
  local keys
  local duplicate
  local missing
  local unexpected

  keys="$(checksum_keys)" || die "could not parse $checksums_file"
  duplicate="$(printf '%s\n' "$keys" | sed '/^$/d' | LC_ALL=C sort | uniq -d)"
  missing="$(comm -23 <(dependency_keys "$dependencies" | LC_ALL=C sort) <(printf '%s\n' "$keys" | sed '/^$/d' | LC_ALL=C sort))"
  unexpected="$(comm -13 <(dependency_keys "$dependencies" | LC_ALL=C sort) <(printf '%s\n' "$keys" | sed '/^$/d' | LC_ALL=C sort))"

  [[ -z "$duplicate" ]] || die "duplicate checksums in $checksums_file: $duplicate"
  [[ -z "$missing" ]] || die "missing checksums in $checksums_file: $missing"
  [[ -z "$unexpected" ]] || die "unexpected checksums in $checksums_file: $unexpected"
}

expected_hash() {
  local key="$1"

  awk -v key="$key" '
    length($1) == 64 && $1 ~ /^[0-9a-f]+$/ && $2 == key {
      print $1
      found = 1
    }
    END {
      if (!found) {
        exit 1
      }
    }
  ' "$checksums_file"
}

require_remapping() {
  local key="$1"

  grep -Fxq "$key/=dependencies/$key/" "$remappings_file" \
    || die "missing remapping for $key in $remappings_file"
}

verify_one() {
  local name="$1"
  local version="$2"
  local key="$name-$version"
  local dir="$dependencies_dir/$key"
  local expected
  local actual

  require_dir "$dir"

  expected="$(expected_hash "$key")" || die "missing expected checksum for $key in $checksums_file"
  actual="$(tree_hash "$dir")"

  if [[ "$actual" != "$expected" ]]; then
    die "$key checksum mismatch: expected $expected, got $actual"
  fi

  require_remapping "$key"

  printf 'deps-verify: %s ok\n' "$key"
}

write_checksums() {
  local dependencies="$1"
  local tmp
  local name
  local version
  local key
  local dir

  tmp="$(mktemp)"
  trap 'rm -f "$tmp"' EXIT

  {
    printf '# Deterministic SHA-256 of installed dependency file manifests.\n'
    printf '# Format: <sha256>  <dependency-name-version>\n'
    while IFS=$'\t' read -r name version; do
      key="$name-$version"
      dir="$dependencies_dir/$key"
      require_dir "$dir"
      require_remapping "$key"
      printf '%s  %s\n' "$(tree_hash "$dir")" "$key"
    done <<< "$dependencies"
  } > "$tmp"

  mv "$tmp" "$checksums_file"
  trap - EXIT
}

require_file "$lock_file"
require_file "$remappings_file"
require_dir "$dependencies_dir"

dependencies="$(load_dependency_list)"
verify_dependency_set "$dependencies"

if [[ "$mode" == "write" ]]; then
  write_checksums "$dependencies"
  exit 0
fi

require_file "$checksums_file"
verify_checksum_set "$dependencies"

while IFS=$'\t' read -r name version; do
  verify_one "$name" "$version"
done <<< "$dependencies"
