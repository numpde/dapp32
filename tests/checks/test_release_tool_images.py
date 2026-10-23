from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from .common import ROOT, rendered_compose_config


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
    cat "$CASE_ROOT/cache/$key"
    if [[ "$TOOL_RETAG" == 1 ]]; then
      for tag in "$CASE_ROOT/cache/"dapp32-release-*; do
        if [[ "$(cut -d ' ' -f1 "$tag")" == "$key" ]]; then printf 'sha256:%064d %040d\n' 999 999 > "$tag"; fi
      done
    fi
  else return 93; fi
}
'''


class ReleaseToolImagesTest(unittest.TestCase):
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

    def test_identical_tool_inputs_reuse_images_across_application_commits(self):
        result, builds, overlays = self.run_case(r'''
release_tool_images_prepare /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output"
release_tool_images_prepare /fixture bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$CASE_ROOT/output"
''')
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(4, builds)
        self.assertIn("Reusing", result.stderr)
        for text in overlays.values():
            self.assertIn("sha256:", text)
            self.assertIn("build: !reset null", text)
            self.assertIn("pull_policy: never", text)
            self.assertNotIn("release-approval:", text)

    def test_only_a_changed_tool_context_rebuilds(self):
        result, builds, _ = self.run_case(r'''
release_tool_images_prepare /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output"
printf '%040d' 17 > "$CASE_ROOT/trees/foundry"
release_tool_images_prepare /fixture bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb "$CASE_ROOT/output"
''')
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertEqual(5, builds)

    def test_engine_or_build_failure_publishes_no_runtime_overrides(self):
        for failure in ("inventory", "build", "inspect"):
            with self.subTest(failure=failure):
                result, _, outputs = self.run_case('release_tool_images_prepare /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output"', failure=failure)
                self.assertNotEqual(0, result.returncode)
                self.assertEqual({}, outputs)

    def test_runtime_uses_inspected_ids_even_if_the_cache_tag_changes(self):
        result, _, overlays = self.run_case('release_tool_images_prepare /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output"', retag=True)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertTrue(all("999" not in text for text in overlays.values()))

    def test_rendered_release_phases_change_only_helper_image_selection(self):
        result, _, overlays = self.run_case('release_tool_images_prepare /fixture aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa "$CASE_ROOT/output"')
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        phases = [("dependencies", ("compose/deps.yml",), {"soldeer-verify"})]
        for app in ("bike-nft", "escrow", "pay-to-play"):
            for phase in ("check", "deploy", "verify"):
                files = (f"compose/release/{phase}.yml", f"compose/{app}/release/{phase}.yml")
                if phase == "deploy":
                    files += ("compose/release/reference.yml", "compose/release/approval.yml")
                phases.append((phase, files, None))
        with tempfile.TemporaryDirectory() as temporary:
            for phase, files, selected in phases:
                with self.subTest(phase=phase, files=files):
                    overlay = Path(temporary) / f"images-{phase}.yml"
                    overlay.write_text(overlays[overlay.name])
                    before = rendered_compose_config(files)["services"]
                    after = rendered_compose_config((*files, str(overlay)))["services"]
                    self.assertEqual(before.keys(), after.keys(), "image overrides must not introduce services")
                    if selected is None:
                        selected = set(after) - {"release-approval"}
                    for service in selected:
                        self.assertNotIn("build", after[service])
                        self.assertRegex(after[service]["image"], r"^sha256:[0-9a-f]{64}$")
                        self.assertEqual("never", after[service]["pull_policy"])
                        original = {key: value for key, value in before[service].items() if key not in {"build", "image", "pull_policy"}}
                        changed = {key: value for key, value in after[service].items() if key not in {"build", "image", "pull_policy"}}
                        self.assertEqual(original, changed, "image reuse must preserve runtime confinement")
                    if "release-approval" in before:
                        self.assertEqual(before["release-approval"], after["release-approval"])
