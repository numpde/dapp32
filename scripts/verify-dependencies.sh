#!/usr/bin/env bash
set -euo pipefail

mode="verify_local"
root="/work"

if [[ "${1:-}" == "--stage" ]]; then
  mode="stage"
  shift
elif [[ "${1:-}" == --* ]]; then
  printf 'deps-verify: unknown option: %s\n' "$1" >&2
  exit 2
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

require_tool() {
  command -v "$1" >/dev/null 2>&1 || die "missing required tool: $1"
}

dependency_records() {
  awk '
    function value(line) {
      sub(/^[^"]*"/, "", line)
      sub(/".*$/, "", line)
      return line
    }

    function emit() {
      if (name != "" || version != "" || url != "" || checksum != "") {
        if (name == "" || version == "" || url == "" || checksum == "") {
          exit 2
        }
        print name "\t" version "\t" url "\t" checksum
      }
    }

    function reset() {
      name = ""
      version = ""
      url = ""
      checksum = ""
    }

    BEGIN {
      reset()
    }

    /^\[\[dependencies\]\]/ {
      emit()
      reset()
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

    /^url = / {
      url = value($0)
      next
    }

    /^checksum = / {
      checksum = value($0)
      next
    }

    END {
      emit()
    }
  ' "$lock_file"
}

tree_hash() {
  local dir="$1"
  local unsupported

  unsupported="$(find "$dir" ! -type d ! -type f | LC_ALL=C sort)"
  [[ -z "$unsupported" ]] || die "unsupported dependency entries under $dir: $unsupported"

  (
    cd "$dir"
    find . -type f | LC_ALL=C sort | while IFS= read -r path; do
      rel="${path#./}"
      file_hash="$(sha256sum -- "$rel" | awk '{ print $1 }')"
      printf '%s  %s\n' "$file_hash" "$rel"
    done
  ) | sha256sum | awk '{ print $1 }'
}

load_dependency_records() {
  local records

  records="$(dependency_records)" || die "could not parse $lock_file"
  [[ -n "$records" ]] || die "no dependencies found in $lock_file"
  printf '%s\n' "$records"
}

records_to_dependencies() {
  awk -F '\t' '{ print $1 "\t" $2 }'
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

validate_archive_checksum() {
  local key="$1"
  local checksum="$2"

  [[ "${#checksum}" == "64" && "$checksum" =~ ^[0-9a-f]+$ ]] \
    || die "$key has invalid upstream checksum in $lock_file"
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

archive_payload_dir() {
  local extract_dir="$1"
  local first
  local count

  count="$(find "$extract_dir" -mindepth 1 -maxdepth 1 | wc -l | tr -d '[:space:]')"
  if [[ "$count" == "1" ]]; then
    first="$(find "$extract_dir" -mindepth 1 -maxdepth 1 -print -quit)"
    if [[ -d "$first" ]]; then
      printf '%s\n' "$first"
      return
    fi
  fi

  printf '%s\n' "$extract_dir"
}

verify_zip_paths() {
  local key="$1"
  local archive="$2"

  zipinfo -1 "$archive" | awk '
    $0 == "" || /^\// || /(^|\/)\.\.(\/|$)/ {
      exit 1
    }
  ' || die "$key archive contains an unsafe path"
}

verify_upstream_one() {
  local tmp_dir="$1"
  local name="$2"
  local version="$3"
  local url="$4"
  local checksum="$5"
  local key="$name-$version"
  local archive="$tmp_dir/$key.zip"
  local extract_dir="$tmp_dir/extract/$key"
  local payload_dir
  local actual_archive_checksum
  local expected_tree_hash
  local actual_tree_hash

  validate_archive_checksum "$key" "$checksum"
  [[ "$url" == https://* ]] || die "$key upstream URL must use https: $url"
  require_dir "$dependencies_dir/$key"

  curl \
    --fail \
    --location \
    --silent \
    --show-error \
    --proto '=https' \
    --proto-redir '=https' \
    --retry 3 \
    --retry-delay 2 \
    --connect-timeout 15 \
    --max-time 300 \
    --output "$archive" \
    "$url"

  actual_archive_checksum="$(sha256sum "$archive" | awk '{ print $1 }')"
  if [[ "$actual_archive_checksum" != "$checksum" ]]; then
    die "$key upstream archive checksum mismatch: expected $checksum, got $actual_archive_checksum"
  fi

  mkdir -p "$extract_dir"
  verify_zip_paths "$key" "$archive"
  unzip -qq "$archive" -d "$extract_dir"
  payload_dir="$(archive_payload_dir "$extract_dir")"

  expected_tree_hash="$(tree_hash "$payload_dir")"
  actual_tree_hash="$(tree_hash "$dependencies_dir/$key")"
  if [[ "$actual_tree_hash" != "$expected_tree_hash" ]]; then
    die "$key installed tree does not match verified upstream archive"
  fi

  printf 'deps-verify: %s upstream archive ok\n' "$key"
}

verify_upstream() {
  local records="$1"
  local tmp_dir
  local name
  local version
  local url
  local checksum

  require_tool curl
  require_tool unzip
  require_tool zipinfo

  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT

  while IFS=$'\t' read -r name version url checksum; do
    verify_upstream_one "$tmp_dir" "$name" "$version" "$url" "$checksum"
  done <<< "$records"

  rm -rf "$tmp_dir"
  trap - EXIT
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

records="$(load_dependency_records)"
dependencies="$(records_to_dependencies <<< "$records")"
verify_dependency_set "$dependencies"

if [[ "$mode" == "stage" ]]; then
  verify_upstream "$records"
  write_checksums "$dependencies"
  exit 0
fi

require_file "$checksums_file"
verify_checksum_set "$dependencies"

while IFS=$'\t' read -r name version; do
  verify_one "$name" "$version"
done <<< "$dependencies"
