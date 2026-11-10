from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from .common import ROOT, compose_sequence_or_empty, rendered_compose_config

from .docker_test_support import docker_environment_fixture

setUpModule, tearDownModule = docker_environment_fixture()


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
source tools/release_process.sh
release_process_init
release_preparation_log="$CASE_ROOT/preparation.log"
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
source tools/release_identity.sh
# Simulate one already-verified rootless mapping from the selected engine.
# The fixture never contacts Docker or executes a user-namespace probe.
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)"
RELEASE_CONTAINER_UID=0 RELEASE_CONTAINER_GID=0
_release_identity_endpoint="$CAM_DOCKER_ENDPOINT"
_release_identity_host="$LOCAL_UID:$LOCAL_GID"
_release_identity_userns=default
_release_identity_pair=0:0
if [[ "$FAULT" == unmapped ]]; then unset _release_identity_pair; fi
release_log_step() { shift 2; "$@"; }
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
docker() { [[ "$1" == --host && "$2" == "$TEST_EXPECTED_DOCKER_ENDPOINT" ]] || return 91; shift 2;
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
    [[ "$LOCAL_UID:$LOCAL_GID" == 0:0 ]] || return 92
    printf '%s\n%s\n' "$CAM_COMPONENT_FOUNDRY_IMAGE" "$CAM_COMPONENT_CHECKS_IMAGE" > "$CASE_ROOT/executed-images"
  else return 90; fi
}
release_cam_export business "$SOURCE" source-contracts
'''
        for fault in ("none", "mutable-id", "wrong-context", "wrong-id", "unmapped"):
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

    def test_component_cleanup_uses_same_verified_mapped_identity(self):
        script = r'''
source tools/release_identity.sh
source tools/release_cam.sh
LOCAL_UID="$(id -u)" LOCAL_GID="$(id -g)"
RELEASE_CONTAINER_UID=0 RELEASE_CONTAINER_GID=0
_release_identity_endpoint="$CAM_DOCKER_ENDPOINT"
_release_identity_host="$LOCAL_UID:$LOCAL_GID"
_release_identity_userns=default
_release_identity_pair=0:0
if [[ "$FAULT" == unmapped ]]; then unset _release_identity_pair; fi
release_command_grace=15
RELEASE_SOURCE_DIR="$CASE_ROOT"
release_cam_source_projects=(fixture)
release_run_owned() { shift; "$@"; }
docker() {
  [[ "$1" == --host && "$2" == "$CAM_DOCKER_ENDPOINT" ]] || return 91
  [[ "$LOCAL_UID:$LOCAL_GID" == 0:0 ]] || return 92
  printf '%s\n' "$*" > "$CASE_ROOT/cleanup-call"
}
release_cam_sources_cleanup
'''
        for fault in ("none", "unmapped"):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                result = subprocess.run(
                    ["bash", "-euo", "pipefail", "-c", script], cwd=ROOT,
                    env={**os.environ, "CASE_ROOT": str(root), "FAULT": fault,
                         "CAM_DOCKER_ENDPOINT": "unix:///tmp/cam-source-fixture.sock"},
                    capture_output=True, text=True, timeout=10,
                )
                if fault == "none":
                    self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                    self.assertIn("down --timeout 10 --volumes --remove-orphans",
                                  (root / "cleanup-call").read_text())
                else:
                    self.assertNotEqual(0, result.returncode)
                    self.assertFalse((root / "cleanup-call").exists())


    def test_bundle_recovery_preserves_commit_values_after_gnu_make_expansion(self):
        # Test the real recipe lines under GNU Make, not just the Bash helper.
        # Extract only this side-effect-free boundary: the full release target
        # can start containers and must never be executed by this check.
        source = (ROOT / "Makefile").read_text()
        bundle = source.split("\ndefine release_cam_bundle\n", 1)[1].split("\nendef", 1)[0]
        def recipe_line(prefix):
            lines = [line.strip() for line in bundle.splitlines()
                     if line.strip().startswith(prefix)]
            self.assertEqual(1, len(lines), (prefix, lines))
            return lines[0]
        review = recipe_line("release_review_tool_delta ")
        receipt = recipe_line("printf '%s\\n' ")
        saved, tooling = "a" * 40, "b" * 40
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "inputs").mkdir()
            makefile = output / "Makefile"
            makefile.write_text(
                "SHELL := /bin/bash\ncheck:\n"
                "\t@set -euo pipefail; \\\n"
                f"\tCAM_RELEASE_SOURCE_COMMIT={saved}; source_commit={tooling}; output_dir={output}; \\\n"
                '\trelease_review_tool_delta() { printf "%s\\n" "$$1" "$$2" "$$3"; }; \\\n'
                f"\t{review}\n"
                f"\t{receipt}\n"
            )
            result = subprocess.run(["make", "--no-print-directory", "-s",
                                     "-f", str(makefile), "check"], cwd=ROOT,
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            self.assertEqual([str(ROOT), saved, tooling], result.stdout.splitlines())
            self.assertEqual(tooling + "\n",
                             (output / "inputs/preparation-tool-commit").read_text())

    def test_review_keyless_recovery_uses_explicit_accepted_tooling(self):
        import pty

        with tempfile.TemporaryDirectory() as temp:
            repository = Path(temp) / "repo"
            repository.mkdir()
            old, new = "a" * 40, "b" * 40
            # The repository checks container has no Git executable. Exercise
            # the review protocol against an exact-argv peer instead of adding
            # network-accessible tool installation to an offline test image.
            git_fixture = r'''git() {
  [[ "$1" == -C && "$2" == "$REVIEW_REPO" ]] || return 95
  shift 2
  case "$*" in
    "cat-file -e $REVIEW_OLD^{commit}"|"cat-file -e $REVIEW_NEW^{commit}") return 0 ;;
    "--no-pager diff --no-ext-diff --no-renames --no-color --name-status $REVIEW_OLD $REVIEW_NEW")
      printf 'M\ttools/release_cam.sh\n' ;;
    "--no-pager diff --no-ext-diff --no-renames --no-color --stat $REVIEW_OLD $REVIEW_NEW")
      printf ' tools/release_cam.sh | 2 +1 -1\n' ;;
    "diff --quiet $REVIEW_OLD $REVIEW_NEW -- dapps js/apps js/packages") return 0 ;;
    "--no-pager diff --no-ext-diff --no-renames --no-color $REVIEW_OLD $REVIEW_NEW")
      printf '%s\n' '-before' '+after' ;;
    *) printf 'Unexpected Git request: %s\n' "$*" >&2; return 95 ;;
  esac
}
'''
            cmd = ["bash", "-euo", "pipefail", "-c", git_fixture +
                   'source tools/release_source_files.sh\n'
                   'release_review_tool_delta "$REVIEW_REPO" "$REVIEW_OLD" "$REVIEW_NEW"\n'
                   'echo accepted']
            env = {**os.environ, "REVIEW_REPO": str(repository), "REVIEW_OLD": old, "REVIEW_NEW": new}
            same = subprocess.run(cmd, cwd=ROOT, env={**env, "REVIEW_NEW": old},
                                  capture_output=True, text=True, timeout=5)
            self.assertEqual(0, same.returncode, same.stderr)
            self.assertIn("accepted", same.stdout)
            no_terminal = subprocess.run(cmd, cwd=ROOT, env=env, input="proceed\n",
                                         capture_output=True, text=True, timeout=5)
            self.assertNotEqual(0, no_terminal.returncode)
            self.assertNotIn("accepted", no_terminal.stdout)
            self.assertIn("tools/release_cam.sh", no_terminal.stdout)
            master, slave = pty.openpty()
            try:
                child = subprocess.Popen(cmd, cwd=ROOT, env=env, stdin=slave, stdout=slave, stderr=slave)
                os.close(slave)
                slave = -1
                os.write(master, b"diff\nproceed\n")
                self.assertEqual(0, child.wait(timeout=8))
                chunks = []
                while True:
                    try:
                        data = os.read(master, 65536)
                    except OSError:
                        break
                    if not data:
                        break
                    chunks.append(data)
                transcript = b"".join(chunks)
                self.assertIn(b"accepted", transcript)
                self.assertIn(b"tools/release_cam.sh", transcript)
                self.assertIn(b"before", transcript)
                self.assertIn(b"after", transcript)
            finally:
                if slave != -1:
                    os.close(slave)
                os.close(master)

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
