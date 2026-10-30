from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from .common import ROOT, rendered_compose_config
from .text.test_rendered_compose_posture import makefile_compose_unit


STUBS = r'''
timeout() {
  [[ "$1 $2 $3 $4 $5" == '-s TERM -k 15s 120s' ]] || return 94
  shift 5
  "$@"
}
git() {
  [[ "${GIT_NO_REPLACE_OBJECTS-}" == 1 ]] || return 95
  local expression="${!#}" tool
  tool="${expression##*/}"
  case "$3" in
    rev-parse) cat "$CASE_ROOT/trees/$tool" ;;
    show) printf 'FROM docker.io/library/fixture@sha256:%064d\n' 1 ;;
    archive) printf 'archive:%s' "$(cat "$CASE_ROOT/trees/$tool")" ;;
    *) return 91 ;;
  esac
}
docker() {
  printf '%s\n' "$*" >> "$CASE_ROOT/calls"
  local tag="" tree="" value key count id
  if [[ "$1 $2" == 'image ls' ]]; then
    [[ "$TOOL_FAILURE" != inventory ]] || return 1
    for value in "$@"; do if [[ "$value" == reference=* ]]; then tag="${value#reference=}"; fi; done
    if [[ -f "$CASE_ROOT/cache/$tag" ]]; then cut -d ' ' -f1 "$CASE_ROOT/cache/$tag"; fi
  elif [[ "$1" == pull ]]; then
    touch "$CASE_ROOT/base-ready"
  elif [[ "$1" == build ]]; then
    [[ "$TOOL_FAILURE" != build ]] || return 1
    while [[ $# -gt 0 ]]; do
      case "$1" in --tag) tag="$2"; shift ;; --label) tree="${2#*=}"; shift ;; esac
      shift
    done
    [[ "$(cat)" == "archive:$tree" ]] || return 92
    count=$(cat "$CASE_ROOT/count"); count=$((count + 1)); printf '%s' "$count" > "$CASE_ROOT/count"
    printf -v id 'sha256:%064x' "$count"
    printf '%s %s\n' "$id" "$tree" > "$CASE_ROOT/cache/$tag"
    cp "$CASE_ROOT/cache/$tag" "$CASE_ROOT/cache/$id"
    printf '%s\n' "$id"
  elif [[ "$1 $2" == 'image inspect' ]]; then
    [[ "$TOOL_FAILURE" != inspect ]] || return 1
    key="${!#}"
    if [[ "$key" == docker.io/library/fixture@sha256:* && "$TOOL_FAILURE" == base-missing && ! -f "$CASE_ROOT/base-ready" ]]; then
      printf 'No such image: %s\n' "$key" >&2; return 1
    fi
    if [[ "$key" == docker.io/library/fixture@sha256:* ]]; then printf 'sha256:%064d\n' 1; return; fi
    cat "$CASE_ROOT/cache/$key"
    if [[ "$TOOL_RETAG" == 1 ]]; then
      for tag in "$CASE_ROOT/cache/"cam-release-tool-*; do
        if [[ "$(cut -d ' ' -f1 "$tag")" == "$key" ]]; then printf 'sha256:%064d %040d\n' 999 999 > "$tag"; fi
      done
    fi
  else return 93; fi
}
'''


class ReleaseToolImagesTest(unittest.TestCase):
    # silent-defaults: allow-default -- The ordinary fixture leaves image tags unchanged; retag=True exercises replacement.
    def run_case(self, script, *, failure="", retag=False):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "cache").mkdir()
            (root / "trees").mkdir()
            (root / "output").mkdir()
            (root / "count").write_text("0")
            for tool, char in zip(("checks", "foundry", "node-deps", "rpc-proxy"), "abcd"):
                (root / "trees" / tool).write_text(char * 40)
            result = subprocess.run(["bash", "-eu", "-o", "pipefail", "-c",
                'source tools/release_tool_images.sh\n' + STUBS + script], cwd=ROOT,
                env={**os.environ, "CASE_ROOT": str(root), "TOOL_FAILURE": failure, "TOOL_RETAG": str(int(retag))},
                capture_output=True, text=True, check=False, timeout=10)
            outputs = {path.name: path.read_text() for path in (root / "output").iterdir()}
            return result, int((root / "count").read_text()), outputs

    def test_image_acquisition_precedes_consumers_and_preserves_failure_boundaries(self):
        pin = "docker.io/library/fixture@sha256:" + "a" * 64
        for state in ("present", "missing", "daemon-error", "pull-error"):
            with self.subTest(state=state):
                script = r'''source tools/release_tool_images.sh
docker() {
  if [[ "$1 $2" == "image inspect" ]]; then
    case "$TEST_STATE" in
      present) printf 'sha256:%064d\n' 1 ;;
      daemon-error) printf 'Cannot connect to Docker daemon\n' >&2; return 1 ;;
      *) printf 'Error response from daemon: No such image: %s\n' "${!#}" >&2; return 1 ;;
    esac
  elif [[ "$1" == pull ]]; then
    printf 'pull:%s\n' "${!#}"
    [[ "$TEST_STATE" != pull-error ]]
  else return 99; fi
}
timeout() { shift 5; "$@"; }
release_acquire_image "$TEST_PIN" || exit "$?"
printf 'consumer\n'
'''
                result = subprocess.run(["bash", "-eu", "-c", script], cwd=ROOT,
                    env={**os.environ, "TEST_STATE": state, "TEST_PIN": pin},
                    capture_output=True, text=True, timeout=5, check=False)
                self.assertEqual(state in ("present", "missing"), result.returncode == 0, result.stderr)
                if state == "present":
                    self.assertNotIn("pull:", result.stderr)
                if state in ("missing", "pull-error"):
                    self.assertIn("pull:" + pin, result.stderr)
                if state == "daemon-error":
                    self.assertNotIn("pull:", result.stderr)
                    self.assertIn("Cannot connect to Docker daemon", result.stderr)
                self.assertEqual(state in ("present", "missing"), "consumer" in result.stdout)

    def test_local_image_ids_and_mutable_tags_cannot_be_acquired(self):
        for image in ("sha256:" + "a" * 64, "node:latest"):
            result = subprocess.run(["bash", "-eu", "-c",
                'source tools/release_tool_images.sh; docker() { exit 99; }; release_acquire_image "$TEST_IMAGE"'],
                cwd=ROOT, env={**os.environ, "TEST_IMAGE": image}, capture_output=True, text=True, timeout=5, check=False)
            self.assertEqual(2, result.returncode)
            self.assertIn("pinned by SHA-256", result.stderr)

    def test_compose_prerequisites_skip_local_produced_image_ids(self):
        pin = "registry.example/tool@sha256:" + "a" * 64
        script = r'''source tools/release_tool_images.sh
compose() { [[ "$*" == "config --images" ]] || return 91; printf '%s\n' "$TEST_PIN" "sha256:$(printf 'b%.0s' {1..64})"; }
release_acquire_image() { printf 'acquire:%s\n' "$1"; }
release_acquire_compose_images compose
'''
        result = subprocess.run(["bash", "-eu", "-c", script], cwd=ROOT,
            env={**os.environ, "TEST_PIN": pin}, capture_output=True, text=True, timeout=5, check=False)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(["acquire:" + pin], result.stdout.splitlines())

    def test_archived_base_is_acquired_before_build_and_reused_from_cache(self):
        result, builds, _ = self.run_case('''
release_tool_image /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa node-deps
release_tool_image /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa node-deps
cat "$CASE_ROOT/calls"
''', failure="base-missing")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual(1, builds)
        calls = result.stdout.splitlines()
        pulls = [i for i, call in enumerate(calls) if call.startswith("pull --quiet ")]
        self.assertEqual(1, len(pulls))
        self.assertEqual("pull --quiet docker.io/library/fixture@sha256:" + f"{1:064d}", calls[pulls[0]])
        build = next(i for i, call in enumerate(calls) if call.startswith("build "))
        self.assertLess(pulls[0], build)

    def test_identical_tool_inputs_reuse_images_across_application_commits(self):
        for operation in ("contracts", "ui", "cam"):
            with self.subTest(operation=operation):
                result, builds, overlays = self.run_case(f'''
release_tool_images_prepare /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output" {operation}
release_tool_images_prepare /fixture bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$CASE_ROOT/output" {operation}
''')
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                self.assertEqual(4, builds)
                self.assertIn("Reusing", result.stderr)
                self.assertEqual({"images-dependencies.yml", "images-check.yml", "images-deploy.yml"}, overlays.keys())
                for text in overlays.values():
                    self.assertIn("sha256:", text)
                    self.assertIn("build: !reset null", text)
                    self.assertIn("pull_policy: never", text)
                    self.assertNotIn("release-approval:", text)

    def test_image_preparation_requires_an_explicit_operation(self):
        for script in (
            'release_tool_images_prepare /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output"',
            'release_tool_images_prepare_artifact /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$CASE_ROOT/output"',
        ):
            with self.subTest(script=script):
                result, builds, outputs = self.run_case(script)
                self.assertNotEqual(0, result.returncode)
                self.assertEqual(0, builds)
                self.assertEqual({}, outputs)

    def test_only_a_changed_tool_context_rebuilds(self):
        result, builds, _ = self.run_case(r'''
release_tool_images_prepare /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output" contracts
printf '%040d' 17 > "$CASE_ROOT/trees/foundry"
release_tool_images_prepare /fixture bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$CASE_ROOT/output" contracts
''')
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(5, builds)

    def test_network_setup_reuses_only_the_proxy_tool_and_preserves_the_fixed_reader(self):
        result, builds, overlays = self.run_case(r'''
release_tool_images_prepare_network /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output"
release_tool_images_prepare_network /fixture bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$CASE_ROOT/output"
''')
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(1, builds)
        self.assertEqual({"images-setup-rpc.yml"}, overlays.keys())
        with tempfile.TemporaryDirectory() as temporary:
            overlay = Path(temporary) / "images-setup-rpc.yml"
            overlay.write_text(overlays[overlay.name])
            before = rendered_compose_config("compose/release/setup-rpc.yml")["services"]
            after = rendered_compose_config(("compose/release/setup-rpc.yml", str(overlay)))["services"]
            self.assertEqual(before.keys(), after.keys())
            self.assertEqual(before["rpc-chain-read"], after["rpc-chain-read"])
            self.assertNotIn("build", after["rpc-proxy"])
            self.assertRegex(after["rpc-proxy"]["image"], r"^sha256:[0-9a-f]{64}$")

    def test_artifact_completion_has_only_read_only_rpc_and_artifact_authority(self):
        for operation, prefix, native in (("contracts", "CONTRACT", "contract"), ("ui", "UI", "ui"), ("cam", "CAM", "cam")):
            with self.subTest(operation=operation):
                result, builds, overlays = self.run_case(f'''
release_tool_images_prepare_artifact /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output" {operation}
release_tool_images_prepare_artifact /fixture bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$CASE_ROOT/output" {operation}
''')
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                self.assertEqual(3 if operation == "cam" else 4, builds)
                self.assertEqual({"images-artifact.yml", "images-dependencies.yml"}, overlays.keys())
                with tempfile.TemporaryDirectory() as temporary:
                    overlay = Path(temporary) / "images-artifact.yml"
                    overlay.write_text(overlays[overlay.name])
                    files = makefile_compose_unit(f"{prefix}_RELEASE_ARTIFACT_COMPOSE_FILES")
                    services = rendered_compose_config((*files, str(overlay)), env={"RELEASE_SOURCE_DIR": "/tmp/original-source"})["services"]
                    expected = {"release-artifact-dependencies", "release-artifact", "release-artifact-rpc-proxy", f"release-{native}-publish"}
                    if operation != "cam":
                        expected.add(f"release-{native}-verify")
                    self.assertEqual(expected, services.keys())
                    admission = services["release-artifact-dependencies"]
                    self.assertEqual("none", admission["network_mode"])
                    self.assertNotIn("depends_on", admission)
                    self.assertEqual({"/input/js", "/work/js/node_modules"}, {mount["target"] for mount in admission["volumes"]})
                    self.assertTrue(all(mount["read_only"] for mount in admission["volumes"]))
                    self.assertEqual("run-js-workspace", admission["command"][0])
                    methods = set(services["release-artifact-rpc-proxy"]["environment"]["RPC_ALLOWED_METHODS"].split())
                    self.assertNotIn("eth_sendRawTransaction", methods)
                    self.assertNotIn("eth_sendTransaction", methods)
                    artifact = services["release-artifact"]
                    self.assertEqual({"release-artifact-rpc-proxy"}, artifact["depends_on"].keys())
                    self.assertEqual([f"/{native}-candidate"], [mount["target"] for mount in artifact["volumes"] if mount.get("read_only") is not True])
                    self.assertIn("/tmp/original-source/js", {mount["source"] for mount in artifact["volumes"]})
                    publisher = services[f"release-{native}-publish"]
                    self.assertEqual("none", publisher["network_mode"])
                    self.assertEqual([f"/{native}-artifact"], [mount["target"] for mount in publisher["volumes"] if mount.get("read_only") is not True])
                    for service in services.values():
                        self.assertNotIn("build", service)
                        self.assertEqual("never", service["pull_policy"])
                        self.assertFalse(service.get("secrets"))
                        self.assertNotIn("PRIVATE_KEY", service["environment"])

    def test_recovery_keeps_historical_app_runtime_and_current_admission_and_transport(self):
        for operation, prefix, native in (("contracts", "CONTRACT", "contract"), ("ui", "UI", "ui"), ("cam", "CAM", "cam")):
            with self.subTest(operation=operation):
                result, _, overlays = self.run_case(r'''
release_tool_image() {
  case "$2:$3" in
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:node-deps) printf 'sha256:%064d\n' 1 ;;
    bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:node-deps) printf 'sha256:%064d\n' 2 ;;
    bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb:rpc-proxy) printf 'sha256:%064d\n' 3 ;;
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:checks) printf 'sha256:%064d\n' 4 ;;
    aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:foundry) printf 'sha256:%064d\n' 5 ;;
    *) return 88 ;;
  esac
}
release_tool_images_prepare_artifact /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$CASE_ROOT/output" ''' + operation)
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                with tempfile.TemporaryDirectory() as directory:
                    overlay = Path(directory) / "images-artifact.yml"
                    overlay.write_text(overlays[overlay.name])
                    files = makefile_compose_unit(f"{prefix}_RELEASE_ARTIFACT_COMPOSE_FILES")
                    services = rendered_compose_config((*files, str(overlay)))["services"]
                    self.assertEqual("sha256:" + "1".zfill(64), services["release-artifact"]["image"])
                    self.assertEqual("sha256:" + "1".zfill(64), services[f"release-{native}-publish"]["image"])
                    self.assertEqual("sha256:" + "2".zfill(64), services["release-artifact-dependencies"]["image"])
                    self.assertEqual("sha256:" + "3".zfill(64), services["release-artifact-rpc-proxy"]["image"])
                    if operation != "cam":
                        self.assertEqual("sha256:" + "5".zfill(64), services[f"release-{native}-verify"]["image"])
                    dependencies = Path(directory) / "images-dependencies.yml"
                    dependencies.write_text(overlays[dependencies.name])
                    verifier = rendered_compose_config(("compose/deps.yml", str(dependencies)))["services"]["soldeer-verify"]
                    self.assertEqual("sha256:" + "4".zfill(64), verifier["image"])

    def test_engine_or_build_failure_publishes_no_runtime_overrides(self):
        for operation in ("contracts", "ui", "cam"):
            for failure in ("inventory", "build", "inspect"):
                with self.subTest(operation=operation, failure=failure):
                    result, _, outputs = self.run_case('release_tool_images_prepare /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output" ' + operation, failure=failure)
                    self.assertNotEqual(0, result.returncode)
                    self.assertEqual({}, outputs)

    def test_runtime_uses_inspected_ids_even_if_the_cache_tag_changes(self):
        for operation in ("contracts", "ui", "cam"):
            with self.subTest(operation=operation):
                result, _, overlays = self.run_case('release_tool_images_prepare /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output" ' + operation, retag=True)
                self.assertEqual(0, result.returncode, result.stdout + result.stderr)
                self.assertTrue(all("999" not in text for text in overlays.values()))

    def test_rendered_release_phases_change_only_helper_image_selection(self):
        for operation, prefix in (("contracts", "CONTRACT"), ("ui", "UI"), ("cam", "CAM")):
            result, _, overlays = self.run_case('release_tool_images_prepare /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output" ' + operation)
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            files = (*makefile_compose_unit(f"{prefix}_RELEASE_DEPLOY_COMPOSE_FILES"), "compose/release/reference.yml", "compose/release/approval.yml")
            if operation == "cam":
                files = (*files, "compose/release/cam.yml")
            selected = {"release-plan", "release-reference-export", "release-reference-prepare", "release-rpc-proxy", "deploy-release",
                        "release-artifact-dependencies", "release-artifact-rpc-proxy", "release-artifact"}
            if operation == "cam":
                selected.add("release-cam-publish")
            else:
                native = "contract" if operation == "contracts" else "ui"
                selected.update({f"release-{native}-verify", f"release-{native}-publish"})
            phases = (("dependencies", ("compose/deps.yml",), {"soldeer-verify"}),
                      ("check", makefile_compose_unit(f"{prefix}_RELEASE_CHECK_COMPOSE_FILES") if operation != "cam" else ("compose/release/check.yml",), {"release-check"}),
                      ("deploy", files, selected))
            with tempfile.TemporaryDirectory() as temporary:
                for phase, files, selected in phases:
                    with self.subTest(operation=operation, phase=phase):
                        overlay = Path(temporary) / f"images-{phase}.yml"
                        overlay.write_text(overlays[overlay.name])
                        before = rendered_compose_config(files, env={"RELEASE_OPERATION": operation, "CAM_RELEASE_HASH": "0x" + "c" * 64})["services"]
                        after = rendered_compose_config((*files, str(overlay)), env={"RELEASE_OPERATION": operation, "CAM_RELEASE_HASH": "0x" + "c" * 64})["services"]
                        self.assertEqual(before.keys(), after.keys(), "image overrides must not introduce services")
                        if phase == "deploy":
                            services = selected | {"release-approval"}
                            if operation == "cam":
                                services.add("release-cam-root-source")
                            self.assertEqual(services, after.keys())
                        for service in selected:
                            self.assertNotIn("build", after[service])
                            self.assertRegex(after[service]["image"], r"^sha256:[0-9a-f]{64}$")
                            self.assertEqual("never", after[service]["pull_policy"])
                            original = {key: value for key, value in before[service].items() if key not in {"build", "image", "pull_policy"}}
                            changed = {key: value for key, value in after[service].items() if key not in {"build", "image", "pull_policy"}}
                            self.assertEqual(original, changed, "image reuse must preserve runtime confinement")
                        for service in before.keys() - selected:
                            self.assertEqual(before[service], after[service], "unselected services must remain unchanged")
