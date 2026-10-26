from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from .common import ROOT, compose_sequence_or_empty, rendered_compose_config


class CamSourceExportTest(unittest.TestCase):
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
        self.assertFalse(mounts["/component-artifacts"].get("read_only", False))
        self.assertFalse(any(mount.get("bind", {}).get("create_host_path", False) for mount in mounts.values()))

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
