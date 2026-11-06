"""Run the instance selector through the real shell owner with a mapped fake engine."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from .common import ROOT


DOCKER = r'''#!/usr/bin/env python3
import os, pathlib, sys
args = sys.argv[1:]
if args[:2] != ["--host", os.environ["CAM_DOCKER_ENDPOINT"]]:
    raise SystemExit(f"Wrong selected engine: {args}")
args = args[2:]
if args[:2] == ["image", "inspect"]:
    print("sha256:" + "b" * 64)
elif "config" in args and "--images" in args:
    print(os.environ["TEST_PROBE_IMAGE"])
elif "release-instance" in args:
    if os.environ.get("LOCAL_UID") + ":" + os.environ.get("LOCAL_GID") != os.environ["TEST_MAPPED_IDS"]:
        raise SystemExit("The instance selector did not receive its mapped owner identity")
    stage = pathlib.Path(os.environ["RELEASE_CONFIG_STAGE_DIR"])
    index = args.index("release-instance")
    mode = args[index + 1]
    instance = pathlib.Path(args[index + 4])
    if mode == "prepare":
        if not json.loads((instance / "instance.json").read_text())["selection"]:
            raise SystemExit("Private instance inputs were unavailable")
        (stage / "arguments").write_bytes(b"")
        (stage / "operation").write_text("source/publish\\n")
    elif mode != "finish":
        raise SystemExit("Unexpected instance operation")
elif "compose" in args:
    pass
else:
    raise SystemExit(f"Unexpected Docker call: {args}")
'''


class InstanceIdentityLauncherTest(unittest.TestCase):
    def test_private_instance_uses_mapped_identity_before_config_read(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            instance = root / "instance"
            instance.mkdir(mode=0o700)
            (instance / "instance.json").write_text(json.dumps({"selection": True}))
            (instance / "instance.json").chmod(0o600)
            bin_dir = root / "bin"
            bin_dir.mkdir()
            fake = bin_dir / "docker"
            fake.write_text(DOCKER)
            fake.chmod(0o755)
            for ids in ("0:0", f"{os.getuid()}:{os.getgid()}"):
                with self.subTest(ids=ids):
                    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}",
                           "CAM_DOCKER_ENDPOINT": "unix:///tmp/dapp32-mapping-test.sock",
                           "TEST_MAPPED_IDS": ids,
                           "TEST_PROBE_IMAGE": "docker.io/library/python:3.13-alpine@sha256:" + "a" * 64}
                    script = r'''
reject_release_path_symlinks() { :; }
python3() {
  if [[ ${1-} == -I && ${2-} == -S && ${3-} == -B && ${4-} == tools/release_identity.py ]]; then
    printf '%s\\n' "$TEST_MAPPED_IDS"
  else
    command python3 "$@"
  fi
}
export -f reject_release_path_symlinks python3
source tools/release_process.sh
release_process_init
release_instance pay-to-play source/publish
'''
                    # The shell launcher is sourced so the identity probe is mocked,
                    # not the Compose or instance-selection logic.
                    script = "source tools/release_instance.sh\n" + script
                    completed = subprocess.run(
                        ["bash", "-euo", "pipefail", "-c", script],
                        cwd=ROOT, env={**env, "INSTANCE": str(instance)}, text=True,
                        capture_output=True, timeout=45)
                    self.assertEqual(0, completed.returncode, completed.stdout + completed.stderr)
                    self.assertTrue((instance / "instance.json").is_file())
