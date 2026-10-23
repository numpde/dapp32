from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import sys
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
  [[ "$1 $2 $3" == 'image inspect --format' ]] || return 91
  printf '%s\t%s\n' "$4" "$5" >> "$CASE_ROOT/inspections"
  if [[ "$IMAGE_MISSING" == 1 || "$5" == "sha256:$(printf 'b%.0s' {1..64})" ]]; then return 1; fi
  if [[ "$4" == '{{.Id}}' ]]; then
    if [[ "$5" == "sha256:$(printf 'd%.0s' {1..64})" ]]; then printf '%s\n' "$SAVED_IMAGE";
    else printf '%s\n' "$5"; fi
  elif [[ "$4" == '{{index .Config.Labels "org.opencontainers.image.revision"}}' ]]; then
    printf '%s\n' "$TOOL_SOURCE"
  else return 92; fi
}
'''


class ReleaseConfigImagesTest(unittest.TestCase):
    def run_shell(self, root: Path, script: str, *, answer: str = "", missing: bool = False) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            ["bash", "-eu", "-o", "pipefail", "-c", HOST_SETUP + script],
            cwd=ROOT, input=answer, capture_output=True, text=True, check=False, timeout=10,
            env={**os.environ, "CASE_ROOT": str(root), "PYTHON": sys.executable,
                 "REPO": str(ROOT), "SAVED_IMAGE": IMAGE, "TOOL_SOURCE": SOURCE,
                 "IMAGE_MISSING": str(int(missing)), "RELEASE_APPROVAL_IMAGE": "sha256:" + "f" * 64},
        )

    def test_record_selection_is_shallow_and_filters_missing_or_mismatched_local_images(self):
        for explicit in (False, True):
            with self.subTest(explicit=explicit), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                records = root / "records"
                for relative, byte in (("approval-image.json", "a"), ("missing/approval-image.json", "b"),
                                       ("wrong-source/approval-image.json", "c"), ("wrong-id/approval-image.json", "d"),
                                       ("nested/deeper/approval-image.json", "e")):
                    record = records / relative
                    record.parent.mkdir(parents=True, exist_ok=True)
                    record.write_text(json.dumps({"imageId": "sha256:" + byte * 64,
                                                 "approvalToolSourceCommit": byte * 40,
                                                 "packageLockSha256": "1" * 64, "dockerfileSha256": "2" * 64}))
                script = r'''
CONFIG="$CASE_ROOT/records/release.json"
release_config_dir="$CASE_ROOT/stage"
mkdir "$release_config_dir"
compose_release_config() {
  [[ "$*" == 'run --rm --no-deps -T release-setup approval-records bike-nft '* ]] || return 93
  "$PYTHON" -I -B -c 'import sys; sys.path.insert(0, sys.argv[1]); from pathlib import Path; from tools.release_config import approval_records; approval_records(Path(sys.argv[2]))' "$REPO" "$release_config_dir"
}
release_config_prepare_approval_images bike-nft "$TOOL_SOURCE"
'''
                answer = "\n"
                if explicit:
                    answer = str(records / "approval-image.json") + "\n"
                result = self.run_shell(root, script, answer=answer)
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                self.assertEqual(f"{IMAGE}\t{SOURCE}\n", (root / "stage/approval-images").read_text())
                copied = list((root / "stage").glob("approval-image-*.json"))
                expected = 4
                if explicit:
                    expected = 1
                self.assertEqual(expected, len(copied))
                inspected = (root / "inspections").read_text()
                self.assertNotIn("sha256:" + "e" * 64, inspected)
                self.assertIn("{{.Id}}\t" + IMAGE, inspected)
                self.assertIn('org.opencontainers.image.revision', inspected)
                if not explicit:
                    self.assertIn("Skipping unavailable approval image", result.stderr)
                    self.assertIn("local tool source does not match", result.stderr)

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
                    self.assertIn("not present locally", result.stderr)
                    self.assertFalse((root / "continued").exists())
                else:
                    self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                    expected = IMAGE
                    if mode == "verify":
                        expected = "unset"
                        self.assertFalse((root / "inspections").exists())
                    self.assertEqual(expected + "\n", (root / "loaded-image").read_text())
                if mode == "deploy":
                    self.assertEqual("{{.Id}}\t" + IMAGE + "\n", (root / "inspections").read_text())

    def test_stage_cleanup_removes_catalogs_and_copied_records(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "unrelated").write_text("keep")
            result = self.run_shell(root, r'''
release_command_grace=2
release_process_cleanup_begin() { :; }
compose_release_config() { return 94; }
release_config_stage "$CASE_ROOT"
printf '%s\n' "$release_config_dir" > "$CASE_ROOT/stage-path"
for file in inputs rpc-url deployer-key release.json approval-images approval-records approval-image-0.json approval-image-63.json; do
  printf 'fixture\n' > "$release_config_dir/$file"
done
''')
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            stage = Path((root / "stage-path").read_text().strip())
            self.assertFalse(stage.exists())
            self.assertEqual("keep", (root / "unrelated").read_text())
