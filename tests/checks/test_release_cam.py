from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from .common import ROOT, compose_sequence_or_empty, rendered_compose_config


class CamSourceExportTest(unittest.TestCase):
    def test_publication_prepares_existing_root_export_without_bundle_source_state(self):
        with tempfile.TemporaryDirectory() as directory:
            case = Path(directory)
            source = case / "source"
            (source / "tools").mkdir(parents=True)
            (source / "tools/release_tool_images.sh").write_text("")
            output = case / "publication"
            output.mkdir()
            script = r'''
source tools/release_cam.sh
ceremony_source="$CASE_ROOT/source"
CAM_RELEASE_ROOT=existing
CAM_RELEASE_PREPARED_DIR="$CASE_ROOT/original-bundle"
compose_release() {
  [[ -d "$CASE_ROOT/publication/root-proof/compiler/root" ]]
  printf '%040d' 1 > "$CASE_ROOT/publication/root-proof/source-commit"
}
release_cam_export() {
  [[ "$1" == root && "$3" == source-root ]]
  [[ "$CAM_RELEASE_PREPARED_DIR" == "$CASE_ROOT/publication/root-proof" ]]
  [[ -d "$CAM_RELEASE_PREPARED_DIR/compiler/root" ]]
  [[ "$RELEASE_SOURCE_DIR" == "$ceremony_source" ]]
}
release_cam_prepare_root_proof "$CASE_ROOT/publication"
[[ "$CAM_RELEASE_PREPARED_DIR" == "$CASE_ROOT/original-bundle" ]]
[[ "$RELEASE_SOURCE_DIR" == "$ceremony_source" ]]
'''
            result = subprocess.run(["bash", "-euo", "pipefail", "-c", script], cwd=ROOT,
                                    env={**os.environ, "CASE_ROOT": str(case)}, capture_output=True, text=True)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def test_original_source_export_is_offline_with_only_private_artifact_writes(self):
        services = rendered_compose_config("compose/release/cam-source.yml")["services"]
        service = services["release-cam-source"]
        self.assertEqual("service_completed_successfully", service["depends_on"]["release-cam-source-dependencies"]["condition"])
        admission = services["release-cam-source-dependencies"]
        self.assertEqual("none", admission["network_mode"])
        self.assertTrue(admission["read_only"])
        self.assertTrue(all(mount["read_only"] for mount in admission["volumes"]))
        self.assertFalse(service.get("build"))
        self.assertEqual("never", service["pull_policy"])
        self.assertEqual("none", service["network_mode"])
        self.assertTrue(service["read_only"])
        self.assertFalse(compose_sequence_or_empty(service, "secrets"))
        self.assertFalse(compose_sequence_or_empty(service, "ports"))
        self.assertNotIn("PRIVATE_KEY", service["environment"])
        mounts = {mount["target"]: mount for mount in service["volumes"]}
        self.assertEqual({"/work/dapps", "/usr/local/bin/reference-export", "/component-artifacts"}, set(mounts))
        self.assertTrue(mounts["/work/dapps"]["read_only"])
        self.assertTrue(mounts["/usr/local/bin/reference-export"]["read_only"])
        self.assertIsNot(mounts["/component-artifacts"].get("read_only"), True)
        for mount in mounts.values():
            self.assertIsNot(mount["bind"].get("create_host_path"), True)

    def test_component_export_uses_original_context_image_ids_and_rejects_failed_admission(self):
        script = r'''
source tools/release_tool_images.sh
source tools/release_cam.sh
release_command_grace=15
release_repository="$CASE_ROOT/repository"
ceremony_root="$CASE_ROOT"
ceremony_project=fixture
RELEASE_SOURCE_DIR="$PWD"
CAM_RELEASE_PREPARED_DIR="$CASE_ROOT/prepared"
CAM_RELEASE_APP=escrow
# Ambient selections must not bypass the original-context image admission.
CAM_COMPONENT_FOUNDRY_IMAGE=mutable:ambient
CAM_COMPONENT_CHECKS_IMAGE=mutable:ambient
release_archive_source() { mkdir -p "$3/dapps"; }
release_run_owned() { shift; "$@"; }
git() {
  [[ "$1" == -C && "$2" == "$release_repository" && "$3" == rev-parse ]]
  [[ "$4" == "$SOURCE:containers/foundry" || "$4" == "$SOURCE:containers/checks" ]]
  printf '%s\n' "$CONTEXT"
}
docker() {
  if [[ "$1 $2" == 'image ls' ]]; then
    local selected="$FOUNDRY_IMAGE"
    if [[ "$*" == *cam-release-tool-checks:* ]]; then selected="$CHECKS_IMAGE"; fi
    if [[ "$FAULT" == mutable-id ]]; then selected=mutable:latest; fi
    printf '%s\n' "$selected"
  elif [[ "$1 $2" == 'image inspect' ]]; then
    local context="$CONTEXT" observed="$5"
    if [[ "$FAULT" == wrong-context ]]; then context=wrong-context; fi
    if [[ "$FAULT" == wrong-id ]]; then observed="$CHECKS_IMAGE"; fi
    printf '%s %s\n' "$observed" "$context"
  elif [[ "$1" == compose ]]; then
    printf '%s\n%s\n' "$CAM_COMPONENT_FOUNDRY_IMAGE" "$CAM_COMPONENT_CHECKS_IMAGE" > "$CASE_ROOT/executed-images"
  else return 90; fi
}
release_cam_export business "$SOURCE" source-contracts
'''
        for fault in ("none", "mutable-id", "wrong-context", "wrong-id"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                (root / "repository/dapps/dependencies").mkdir(parents=True)
                (root / "prepared/sources").mkdir(parents=True)
                (root / "prepared/compiler/business").mkdir(parents=True)
                foundry = "sha256:" + "a" * 64
                checks = "sha256:" + "b" * 64
                result = subprocess.run(
                    ["bash", "-eu", "-o", "pipefail", "-c", script], cwd=ROOT,
                    env={**os.environ, "CASE_ROOT": str(root), "FAULT": fault,
                         "SOURCE": "d" * 40, "CONTEXT": "c" * 40,
                         "FOUNDRY_IMAGE": foundry, "CHECKS_IMAGE": checks},
                    capture_output=True, text=True, timeout=10,
                )
                if fault == "none":
                    self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                    self.assertEqual([foundry, checks], (root / "executed-images").read_text().splitlines())
                else:
                    self.assertNotEqual(0, result.returncode, result.stdout + result.stderr)
                    self.assertFalse((root / "executed-images").exists())

    def test_root_source_export_needs_only_its_native_source_file(self):
        script = r'''
forge() { printf '%s\0' "$@" > "$TRACE"; return 41; }
export -f forge
RELEASE_OPERATION=source-root FOUNDRY_OUT=/tmp/foundry-out bash "$EXPORTER" pay-to-play "$OUTPUT"
'''
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "cam/src").mkdir(parents=True)
            (root / "cam/src/CamRoot.sol").write_text("pragma solidity 0.8.35; contract CamRoot {}\n")
            output = root / "artifacts"
            output.mkdir()
            trace = root / "argv"
            result = subprocess.run(["bash", "-c", script], cwd=root,
                                    env={**os.environ, "TRACE": str(trace), "OUTPUT": str(output),
                                         "EXPORTER": str(ROOT / "js/tools/release-approval/reference-export.sh")},
                                    capture_output=True, text=True, timeout=10)
            self.assertEqual(41, result.returncode, result.stderr)
            self.assertEqual(["build", "--offline", "cam/src/CamRoot.sol"], trace.read_text().split("\0")[:-1])
            self.assertFalse((root / "pay-to-play").exists())
            self.assertEqual([], list(output.iterdir()))
