#!/usr/bin/env bash
# Compose the ordinary release operations; each phase owns its own admission,
# approval, source checks and immutable artifacts. Existing records never grant
# permission to deploy a replacement phase.

release_full_retry_preparation() {
  local records="$1" previous
  if [[ ! -e "$records/preparation-only" && ! -L "$records/preparation-only" ]]; then return; fi
  reject_release_path_symlinks "$records/preparation-only" 'Release preparation marker' || return
  require_release_file "$records/preparation-only" 'Release preparation marker' || return
  previous=$(mktemp -d -- "$records-preparation-XXXXXXXX") || return
  mv -T -- "$records" "$previous/records" || return
  printf 'Signing never started for this preparation attempt. Retained records: %s/records\n' "$previous"
}

release_full_read_uri_presence() {
  local CONFIG="$1" app="$2" status=0 release_config_input="$1" release_config_credentials="$1"
  require_release_config "$CONFIG"
  compose_release_config run --rm --no-deps -T --entrypoint python3 release-config -I -B -c '
import sys
from pathlib import Path
sys.path.insert(0, "/tool")
import release_config
config = release_config.read_json_file(Path("/run/release.json"), "configuration")
release_config.validate_identity(config, sys.argv[1])
settings = config.get("settings")
if not isinstance(settings, dict):
    raise ValueError("CAM configuration requires settings.")
release_config.write_private(Path("/out/cam-uri-ready"), b"0\n" if settings.get("CAM_URI") in (None, "") else b"1\n")
' "$app" || status=$?
  if [[ "$status" != 0 ]]; then
    rm -f -- "$release_config_dir/cam-uri-ready" || return "$status"
    return "$status"
  fi
  read -r release_full_has_uri < "$release_config_dir/cam-uri-ready"
  rm -- "$release_config_dir/cam-uri-ready"
  if [[ "$release_full_has_uri" != 0 && "$release_full_has_uri" != 1 ]]; then
    printf '%s\n' 'CAM configuration did not produce a URI-presence flag.' >&2
    return 2
  fi
}

release_full_cam() {
  local app="$1" config="$2" prepared="$3" records="$4" operation="$5"
  shift 5
  local attempt continuation status
  while [[ -e "$records/continuation" || -L "$records/continuation" ]]; do
    attempt="$records/artifact/cam-attempt.json"
    continuation="$records/continuation"
    if [[ "$operation" != verify ]]; then release_full_retry_preparation "$continuation" || return; fi
    if [[ ! -e "$continuation" && ! -L "$continuation" ]]; then break; fi
    require_release_file "$attempt" 'Preceding CAM attempt'
    require_release_file "$continuation/root-proof/root.json" 'Retained continuation root evidence'
    if ! cmp -s -- "$attempt" "$continuation/root-proof/root.json"; then
      printf '%s\n' 'CAM continuation records belong to different root evidence. Keep both attempts and select the intended records.' >&2
      return 2
    fi
    records="$continuation"
  done

  if [[ "$operation" != verify ]]; then release_full_retry_preparation "$records" || return; fi
  if [[ "$operation" == verify || -e "$records/artifact/cam-publication.json" || -L "$records/artifact/cam-publication.json" ]]; then
    release_full_make "$app/release/cam/artifact" "CONFIG=$config" "CAM_RECORDS=$records" "CAM_BUNDLE=$prepared" || return
  elif [[ ! -e "$records" && ! -L "$records" ]]; then
    release_full_make "$app/release/cam/publish" "CONFIG=$config" "CAM_BUNDLE=$prepared" CAM_RECORDS= "$@" "OUTPUT_DIR=$records" || return
  else
    attempt="$records/artifact/cam-attempt.json"
    if [[ ! -e "$attempt" && ! -L "$attempt" ]]; then
      status=0
      release_full_make "$app/release/cam/artifact" "CONFIG=$config" "CAM_RECORDS=$records" "CAM_BUNDLE=$prepared" || status=$?
      if [[ "$status" == 0 ]]; then
        require_release_file "$records/artifact/cam-publication.json" 'Verified CAM publication'
        printf 'Verified CAM root record: %s/artifact/cam-publication.json\n' "$records"
        return
      fi
      if [[ ! -e "$attempt" && ! -L "$attempt" ]]; then return "$status"; fi
    fi
    require_release_file "$attempt" 'Retained CAM attempt'
    # Only a new invocation reaches this branch after a paid attempt failed.
    # Fresh publication owns receipt/state admission; the file is not a trust flag.
    continuation="$records/continuation"
    release_full_make "$app/release/cam/publish" "CONFIG=$config" "CAM_BUNDLE=$prepared" CAM_RECORDS= ROOT= \
      "ROOT_ARTIFACT=$attempt" "OUTPUT_DIR=$continuation" || return
    records="$continuation"
  fi
  require_release_file "$records/artifact/cam-publication.json" 'Verified CAM publication'
  printf 'Verified CAM root record: %s/artifact/cam-publication.json\n' "$records"
}

# The Make caller supplies an admitted base output and the ordinary make runner.
# CONFIG selects the business phase for full releases and UI inputs for updates;
# UI_CONFIG and CAM_CONFIG may select independent actors; each ordinary phase
# retains its own source-admission rules.
release_full() {
  local app="$1" operation="$2" output="$3"
  local main_config="$CONFIG" ui_config="$CONFIG" cam_config="$CONFIG"
  if [[ -v UI_CONFIG && -n "$UI_CONFIG" ]]; then ui_config="$UI_CONFIG"; fi
  if [[ -v CAM_CONFIG && -n "$CAM_CONFIG" ]]; then cam_config="$CAM_CONFIG"; fi
  local contracts="$output/contracts" ui="$output/ui" prepared="$output/cam-bundle" cam="$output/cam"
  if [[ -v CAM_BUNDLE && -n "$CAM_BUNDLE" ]]; then prepared="$CAM_BUNDLE"; fi
  local business_artifact ui_artifact legacy_records
  local prepared_before=0
  if [[ -f "$prepared/artifact/cam-bundle.json" ]]; then prepared_before=1; fi
  local -a root_selection
  require_release_config "$ui_config"
  require_release_config "$cam_config"
  if [[ "$operation" == full ]]; then
    if [[ ( -v ROOT_ARTIFACT && -n "$ROOT_ARTIFACT" ) || ( -v ROOT && -n "$ROOT" && "$ROOT" != new ) ]]; then
      printf '%s\n' 'Full release creates a new root. Use release/ui/update with ROOT_ARTIFACT for an existing root.' >&2
      return 2
    fi
    root_selection=(ROOT=new ROOT_ARTIFACT=)
    business_artifact="$contracts/artifact/contract-deployment.json"
  elif [[ "$operation" == update ]]; then
    require_release_file "${CONTRACT_ARTIFACT:?Set CONTRACT_ARTIFACT to the existing business artifact}" CONTRACT_ARTIFACT
    require_release_file "${ROOT_ARTIFACT:?Set ROOT_ARTIFACT to the latest CAM publication}" ROOT_ARTIFACT
    if [[ -v ROOT && -n "$ROOT" ]]; then
      printf '%s\n' 'UI update uses ROOT_ARTIFACT; leave ROOT unset.' >&2
      return 2
    fi
    business_artifact="$CONTRACT_ARTIFACT"
    root_selection=(ROOT= "ROOT_ARTIFACT=$ROOT_ARTIFACT")
  elif [[ "$operation" == verify ]]; then
    business_artifact="$contracts/artifact/contract-deployment.json"
  else
    printf '%s\n' 'Release composition must select full, update or verify.' >&2
    return 2
  fi

  if [[ "$output" != /* || "$(realpath -ms -- "$output")" != "$output" ]]; then
    printf '%s\n' 'Release output must be a normalized absolute path.' >&2
    return 2
  fi
  if [[ -e "$output" || -L "$output" ]]; then
    reject_release_path_symlinks "$output" 'Release records'
    if [[ ! -d "$output" || "$(stat -c %a -- "$output")" != 700 || "$(stat -c %u -- "$output")" != "$(id -u)" ]]; then
      printf '%s\n' 'Existing release records must be a directory owned by this user with mode 0700.' >&2
      return 2
    fi
    case "$output" in "$(pwd -P)"|"$(pwd -P)"/*)
      printf '%s\n' 'Release records must be outside the checkout.' >&2
      return 2 ;;
    esac
  else
    if [[ "$operation" == verify ]]; then
      printf '%s\n' 'Verification requires existing release records; it will not deploy missing phases.' >&2
      return 2
    fi
    validate_new_release_output "$output" 'Release output'
    mkdir --mode=0700 -- "$output"
  fi
  for legacy_records in plan broadcast artifact approval-reference; do
    if [[ -e "$output/$legacy_records" || -L "$output/$legacy_records" ]]; then
      printf '%s\n' 'This directory contains a historical full deployment. Keep those records and choose a new OUTPUT_DIR; this wrapper will not redeploy its contracts.' >&2
      return 2
    fi
  done
  if [[ "$operation" == update && ( -e "$contracts" || -L "$contracts" ) ]]; then
    printf '%s\n' 'UI update needs its own records directory. Keep the full release and select a fresh OUTPUT_DIR.' >&2
    return 2
  fi

  if [[ "$operation" != verify ]]; then
    mkdir -p --mode=0700 -- "$output/inputs"
    local role selected
    local -a roles=(ui cam)
    if [[ "$operation" == full ]]; then roles=(business ui cam); fi
    for role in "${roles[@]}"; do
      case "$role" in business) selected="$main_config" ;; ui) selected="$ui_config" ;; cam) selected="$cam_config" ;; esac
      if [[ ! -e "$output/inputs/$role.json" ]]; then
        release_config_capture "$selected" "$output/inputs/$role.json" "$app" || return
      fi
      require_release_config "$output/inputs/$role.json"
    done
    if [[ "$operation" == full ]]; then main_config="$output/inputs/business.json"; fi
    ui_config="$output/inputs/ui.json"
    cam_config="$output/inputs/cam.json"
  fi

  if [[ "$operation" == verify ]]; then
    local checked=0
    if [[ -e "$contracts" || -L "$contracts" ]]; then
      release_full_make "$app/release/contracts/artifact" "CONFIG=$main_config" "CONTRACT_RECORDS=$contracts" || return
      checked=1
    fi
    local verify_ui="$ui"
    if [[ -n "${UI_ARTIFACT-}" ]]; then verify_ui=$(dirname -- "$(dirname -- "$UI_ARTIFACT")"); fi
    if [[ -n "${UI_ARTIFACT-}" || -e "$verify_ui" || -L "$verify_ui" ]]; then
      release_full_make "$app/release/ui/artifact" "CONFIG=$ui_config" "UI_RECORDS=$verify_ui" || return
      checked=1
    fi
    if [[ -e "$cam" || -L "$cam" ]]; then
      release_full_cam "$app" "$cam_config" "$prepared" "$cam" verify || return
      checked=1
    fi
    if [[ "$checked" == 0 ]]; then
      printf '%s\n' 'No deployment phase records exist yet. Resume this operation to begin.'
    else
      printf '%s\n' 'Verified the available deployment records. No transaction was sent.'
    fi
    return 0
  fi

  if [[ "$operation" == full ]]; then
    release_full_retry_preparation "$contracts" || return
    if [[ -e "$contracts" || -L "$contracts" ]]; then
      release_full_make "$app/release/contracts/artifact" "CONFIG=$main_config" "CONTRACT_RECORDS=$contracts" || return
    else
      release_full_make "$app/release/contracts/deploy" "CONFIG=$main_config" "OUTPUT_DIR=$contracts" || return
    fi
    require_release_file "$business_artifact" 'Verified business artifact'
  fi
  if [[ "$operation" == update && -n "${UI_ARTIFACT-}" ]]; then
    ui_artifact="$UI_ARTIFACT"
  else
    release_full_retry_preparation "$ui" || return
    if [[ -e "$ui" || -L "$ui" ]]; then
      release_full_make "$app/release/ui/artifact" "CONFIG=$ui_config" "UI_RECORDS=$ui" || return
    else
      release_full_make "$app/release/ui/deploy" "CONFIG=$ui_config" "CONTRACT_ARTIFACT=$business_artifact" "OUTPUT_DIR=$ui" || return
    fi
    ui_artifact="$ui/artifact/ui-deployment.json"
  fi
  require_release_file "$ui_artifact" 'Verified UI artifact'

  if [[ -v CAM_BUNDLE && -n "$CAM_BUNDLE" ]]; then
    require_release_file "$prepared/artifact/cam-bundle.json" 'Selected prepared CAM bundle'
  elif [[ ! -e "$prepared" && ! -L "$prepared" ]]; then
    release_full_make "$app/release/cam/bundle" "CONFIG=$cam_config" "CONTRACT_ARTIFACT=$business_artifact" \
      "UI_ARTIFACT=$ui_artifact" "${root_selection[@]}" "OUTPUT_DIR=$prepared" || return
  fi
  # Publication checks the retained bundle's exact bytes, source evidence and
  # component joins. An incomplete export must never be mistaken for a fresh lane.
  reject_release_path_symlinks "$prepared" 'Prepared CAM bundle'
  if [[ ! -e "$prepared/artifact/cam-bundle.json" && ! -L "$prepared/artifact/cam-bundle.json" ]]; then
    if [[ -n "${RELEASE_INSTANCE_ROOT-}" ]]; then
      printf 'Prepared CAM export is incomplete: %s. Repeat the same INSTANCE command and choose the keyless bundle rebuild. Core and UI records are retained.\n' "$prepared" >&2
    else
      printf 'Prepared CAM export is incomplete: %s. Keep the core/UI records, prepare a fresh bundle with the keyless cam/bundle command, then rerun with CAM_BUNDLE selecting that directory. No phase will be redeployed.\n' "$prepared" >&2
    fi
    return 2
  fi
  require_release_file "$prepared/artifact/cam-bundle.json" 'Prepared CAM bundle artifact'
  require_release_file "$prepared/inputs/business.json" 'Prepared business input'
  require_release_file "$prepared/inputs/ui.json" 'Prepared UI input'
  if ! cmp -s -- "$business_artifact" "$prepared/inputs/business.json" || ! cmp -s -- "$ui_artifact" "$prepared/inputs/ui.json"; then
    printf '%s\n' 'The prepared CAM bundle uses different business or UI artifacts. Keep these records and select a bundle prepared from the chosen components.' >&2
    return 2
  fi
  if [[ "$operation" == update ]]; then
    require_release_file "$prepared/inputs/root.json" 'Prepared root input'
    if ! cmp -s -- "$ROOT_ARTIFACT" "$prepared/inputs/root.json"; then
      printf '%s\n' 'The prepared CAM bundle uses different root evidence. Keep these records and prepare a bundle for the selected root.' >&2
      return 2
    fi
  fi

  if [[ ! -e "$cam" && ! -L "$cam" ]]; then
    release_full_read_uri_presence "$cam_config" "$app" || return
    if [[ "$release_full_has_uri" == 0 && "$prepared_before" == 0 && ! -f "$output/inputs/publication-uri" ]]; then
      printf '%s\n' 'CAM files are ready. Paused before CAM root transactions.'
      printf 'Business record: %s\nUI contract record: %s\nCAM files to upload or pin: %s/bundle\n' "$business_artifact" "$ui_artifact" "$prepared"
      printf '%s\n' 'After hosting these exact files, repeat the command to enter their manifest URI. Your instance configuration stays unchanged.'
      if [[ -n "${RELEASE_INSTANCE_ROOT-}" ]]; then
        printf 'Resume: make %q INSTANCE=%q\n' "$app/release/${RELEASE_INSTANCE_OPERATION:?}" "$RELEASE_INSTANCE_ROOT"
      else
        printf 'Resume with the same CONFIG and OUTPUT_DIR; the existing phases will be reused.\n'
      fi
      return 0
    fi
    if [[ ! -f "$output/inputs/publication-uri" ]]; then
      release_config_hosted_uri "$cam_config" "$output/inputs/publication-uri" "$app" || return
    fi
  fi
  if [[ -f "$output/inputs/publication-uri" ]]; then export RELEASE_CAM_URI_FILE="$output/inputs/publication-uri"; fi
  release_full_cam "$app" "$cam_config" "$prepared" "$cam" publish "${root_selection[@]}"
}
