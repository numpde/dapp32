from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from .common import ROOT


IMAGE = "sha256:" + "a" * 64
SOURCE = "a" * 40
HOST_SETUP = r'''
source tools/release-config.sh
reject_release_path_symlinks() { [[ ! -L "$1" ]]; }
require_release_file() { [[ -f "$1" && ! -L "$1" ]]; }
require_protected_release_file() { [[ -f "$1" && ! -L "$1" ]]; }
docker() {
  if [[ "$1 $2" == 'image ls' ]]; then
    [[ " $* " == *' --all '* && " $* " == *' --filter label=org.opencontainers.image.revision '* && " $* " == *' --no-trunc '* && " $* " == *' --quiet '* ]] || return 90
    if [[ "$DISCOVERY_FAULT" == list-failure ]]; then return 1; fi
    if [[ "$DISCOVERY_FAULT" == empty ]]; then return 0; fi
    if [[ "$IMAGE_MISSING" == 1 ]]; then return 0; fi
    printf '%s\n' "$SAVED_IMAGE" "$SAVED_IMAGE" "sha256:$(printf 'b%.0s' {1..64})" "sha256:$(printf 'c%.0s' {1..64})" "sha256:$(printf 'd%.0s' {1..64})"
    return
  fi
  [[ "$1 $2 $3" == 'image inspect --format' ]] || return 91
  printf '%s' "$4" >> "$CASE_ROOT/inspections"
  printf '\t%s' "${@:5}" >> "$CASE_ROOT/inspections"
  printf '\n' >> "$CASE_ROOT/inspections"
  if [[ "$4" == '{{.Id}}' ]]; then
    [[ "$#" == 5 ]] || return 93
    if [[ "$IMAGE_MISSING" == 1 ]]; then return 1; fi
    printf '%s\n' "$5"
    return
  fi
  [[ "$4" == *'{{json (index .Config "Entrypoint")}}'* ]] || return 92
  shift 4
  local image observed_id observed_source entrypoint owner
  for image in "$@"; do
    observed_id="$image"; observed_source="$TOOL_SOURCE"; owner=operator
    entrypoint='["node","--experimental-strip-types","/app/tools/release-approval/run.ts"]'
    if [[ "$image" == "sha256:$(printf 'b%.0s' {1..64})" ]]; then entrypoint='["node","unrelated.js"]'; fi
    if [[ "$image" == "sha256:$(printf 'c%.0s' {1..64})" ]]; then observed_source=not-a-commit; fi
    if [[ "$image" == "sha256:$(printf 'd%.0s' {1..64})" ]]; then
      owner=cam-rehearsal-fixture
      if [[ "$DISCOVERY_FAULT" == unknown-id ]]; then observed_id="sha256:$(printf 'e%.0s' {1..64})"; fi
    fi
    printf '%s\t%s\t%s\t%s\n' "$observed_id" "$observed_source" "$entrypoint" "$owner"
    if [[ "$DISCOVERY_FAULT" == batch-failure ]]; then return 1; fi
  done
}
'''


class ReleaseConfigImagesTest(unittest.TestCase):
    def run_shell(self, root: Path, script: str, *, missing: bool) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", "-eu", "-o", "pipefail", "-c", HOST_SETUP + script],
            cwd=ROOT, input="", capture_output=True, text=True, check=False, timeout=10,
            env={**os.environ, "CASE_ROOT": str(root), "SAVED_IMAGE": IMAGE, "TOOL_SOURCE": SOURCE,
                 "IMAGE_MISSING": str(int(missing)), "DISCOVERY_FAULT": "none", "RELEASE_APPROVAL_IMAGE": "sha256:" + "f" * 64},
        )

    def test_installed_image_discovery_needs_no_input_and_filters_exact_metadata(self):
        for fault in ("none", "list-failure", "batch-failure", "unknown-id", "empty"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                result = self.run_shell(root, 'DISCOVERY_FAULT=' + fault + '\n' + r'''
release_config_dir="$CASE_ROOT/stage"
mkdir "$release_config_dir"
release_config_prepare_approval_images "$SAVED_IMAGE"
touch "$CASE_ROOT/continued"
''', missing=False)
                if fault != "none":
                    self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)
                    self.assertFalse((root / "continued").exists())
                    if fault == "list-failure":
                        self.assertIn("listing failed", result.stderr)
                    continue
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                self.assertEqual(f"{IMAGE}\n", (root / "stage/approval-image").read_text())
                inspected = (root / "inspections").read_text().splitlines()
                self.assertEqual(1, len(inspected), "Discover metadata in one batch instead of one Docker invocation per image")
                self.assertEqual({"sha256:" + byte * 64 for byte in "abcd"}, set(inspected[0].split("\t")[-4:]))
                self.assertNotIn("unrelated.js", result.stdout + result.stderr)
                self.assertNotIn("record file", result.stdout + result.stderr)

    def test_saved_operation_cannot_substitute_current_tooling_for_its_missing_image(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            result = self.run_shell(root, r'''
release_config_dir="$CASE_ROOT/stage"
mkdir "$release_config_dir"
printf retained-source > "$release_config_dir/retained-source"
release_config_prepare_approval_images "$SAVED_IMAGE"
touch "$CASE_ROOT/continued"
''', missing=True)
            self.assertEqual(2, result.returncode, result.stdout + result.stderr)
            self.assertIn(IMAGE, result.stderr)
            self.assertIn("Restore that exact image", result.stderr)
            self.assertFalse((root / "continued").exists())

    def test_rehearsal_can_use_only_its_explicitly_pinned_fixture_image(self):
        for network, admitted in (("cam-rehearsal-fixture-rehearsal", True), ("another-rehearsal", False)):
            with self.subTest(network=network), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                result = self.run_shell(root, 'RELEASE_REHEARSAL_NETWORK=' + network + '\n' + r'''
release_config_dir="$CASE_ROOT/stage"
mkdir "$release_config_dir"
SAVED_IMAGE="sha256:$(printf 'd%.0s' {1..64})"
release_config_prepare_approval_images "$SAVED_IMAGE"
touch "$CASE_ROOT/continued"
''', missing=False)
                self.assertEqual(admitted, result.returncode == 0, result.stdout + result.stderr)
                self.assertEqual(admitted, (root / "continued").exists())

    def test_saved_image_overrides_ambient_and_missing_exact_image_blocks_deploy_only(self):
        for mode, missing in (("deploy", False), ("deploy", True), ("verify", True)):
            with self.subTest(mode=mode, missing=missing), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                config = root / "release.json"
                config.write_text("{}")
                config.chmod(0o600)
                script = r'''
CONFIG="$CASE_ROOT/release.json"
source_commit="$TOOL_SOURCE"
release_config_stage() { release_config_dir="$CASE_ROOT/stage"; mkdir "$release_config_dir"; }
compose_release_config() {
  if [[ "$*" == *' release-config credential-source '* ]]; then printf '%s\n' "$CONFIG" > "$release_config_dir/credential-source"; return; fi
  if [[ "$*" == *' release-config retain '* ]]; then printf '{}\n' > "$release_config_dir/operation-inputs.json"; return; fi
  if [[ "$*" == *' release-config approval-pin '* ]]; then
    printf '%s\n' "$SAVED_IMAGE" > "$release_config_dir/approval-pin"
    return
  fi
  printf 'rpc fixture\n' > "$release_config_dir/rpc-url"
  if [[ "$*" == *' release-config deploy '* ]]; then
    printf 'RELEASE_APPROVAL_IMAGE=%s\0' "$SAVED_IMAGE" > "$release_config_dir/inputs"
    printf 'key fixture\n' > "$release_config_dir/deployer-key"
  else
    printf 'BIKE_NFT_DEPLOYMENT_ARTIFACT_FILE=/tmp/fixture/artifact/deployment.json\0' > "$release_config_dir/inputs"
  fi
}
load_release_config bike-nft "$MODE"
printf '%s\n' "${RELEASE_APPROVAL_IMAGE-unset}" > "$CASE_ROOT/loaded-image"
touch "$CASE_ROOT/continued"
'''
                script = 'MODE=' + mode + '\n' + script
                result = self.run_shell(root, script, missing=missing)
                if mode == "deploy" and missing:
                    self.assertNotEqual(0, result.returncode)
                    self.assertIn("interactively", result.stderr)
                    self.assertFalse((root / "continued").exists())
                else:
                    self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                    expected = IMAGE
                    if mode == "verify":
                        expected = "unset"
                        self.assertFalse((root / "inspections").exists())
                    self.assertEqual(expected + "\n", (root / "loaded-image").read_text())
                if mode == "deploy" and not missing:
                    inspected = (root / "inspections").read_text()
                    self.assertIn("io.cam.approval-owner", inspected)
                    self.assertTrue(inspected.endswith("{{.Id}}\t" + IMAGE + "\n"))

    def test_stage_cleanup_removes_installed_image_choices(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "unrelated").write_text("keep")
            result = self.run_shell(root, r'''
release_command_grace=2
release_process_cleanup_begin() { :; }
compose_release_config() { return 94; }
release_config_stage "$CASE_ROOT"
printf '%s\n' "$release_config_dir" > "$CASE_ROOT/stage-path"
for file in inputs rpc-url deployer-key release.json approval-pin approval-image approval-built; do
  printf 'fixture\n' > "$release_config_dir/$file"
done
''', missing=False)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            stage = Path((root / "stage-path").read_text().strip())
            self.assertFalse(stage.exists())
            self.assertEqual("keep", (root / "unrelated").read_text())
