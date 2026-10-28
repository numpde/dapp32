"""Exercise the real source launcher with greedy, non-networked child executors."""

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from .common import ROOT


DOCKER = r'''#!/usr/bin/env python3
import json, os, pathlib, stat, sys
a = sys.argv[1:]
root = pathlib.Path(os.environ["CASE_ROOT"])
if a[:2] == ["image", "ls"]:
    print("sha256:" + "b" * 64)
elif a[:2] == ["image", "inspect"]:
    print("sha256:" + "b" * 64, "b" * 40)
elif "source-prepare" in a:
    # Compose may consume an attached regular-file stdin even for a noninteractive child.
    if stat.S_ISREG(os.fstat(0).st_mode):
        sys.stdin.buffer.read()
    p = a[len(a) - 1 - a[::-1].index("sh") + 1:]
    mode, *roles = p
    out = pathlib.Path(os.environ["SOURCE_REQUESTS"])
    if mode == "catalog":
        (out / "catalog.json").write_text("{}")
    elif mode == "selection":
        (out / "source-records").write_bytes(b"original/artifact/deployment.json\0manager components camRoot\0replacement/ui/artifact/ui-deployment.json\0ui\0")
        contracts = [("original/artifact/deployment.json", "manager", "manager"),
                     ("original/artifact/deployment.json", "components", "components"),
                     ("original/artifact/deployment.json", "camRoot", "root"),
                     ("replacement/ui/artifact/ui-deployment.json", "ui", "new-ui")]
        (out / "request-links").write_bytes(b"".join((path + "\0" + role + "\0" + key + "\0").encode() for path, role, key in contracts))
        (out / "contracts.json").write_text(json.dumps([{"role": role, "key": key} for _, role, key in contracts]))
    elif mode == "select":
        with (root / "prepared").open("a") as f:
            f.write(os.environ["SOURCE_ARTIFACT"] + "\n")
        (out / "source-roles").write_bytes(b"".join((role + "\0").encode() for role in roles))
        (out / "source-commits").write_text("a" * 40 + "\n")
        (out / "source-state-keys").write_bytes(b"".join((role + "\0" + role + "\0").encode() for role in roles))
        (out / "contracts.json").write_text(json.dumps([{"role": role} for role in roles]))
    else:
        for role in [mode, *roles]:
            (out / (role + ".json")).write_text(json.dumps({"role": role, "origin": os.environ["SOURCE_ARTIFACT"]}))
elif "source-submit" in a:
    if a[-1] == "menu":
        assert sys.stdin.readline().strip() == "1", "preparation consumed the operator's choice"
        (pathlib.Path(os.environ["SOURCE_PUBLICATION_STATE"]) / "selected-keys").write_bytes(b"all\0")
    else:
        requests = pathlib.Path(os.environ["SOURCE_REQUESTS"])
        contracts = json.loads((requests / "contracts.json").read_text())
        bodies = [json.loads((requests / (c["key"] + ".json")).read_text()) for c in contracts]
        assert len(bodies) == 4
        assert "replacement/ui/" in bodies[-1]["origin"]
        (root / "submitted.json").write_text(json.dumps(bodies))
elif "source-state-import" in a:
    assert os.environ["SOURCE_PUBLICATION_STATE"] == str(root / "instance/source-publication/state")
elif a and a[0] in ("compose", "container", "network", "volume"):
    pass  # Owned cleanup only; this fake never talks to a Docker engine.
else:
    raise AssertionError(a)
'''

GIT = r'''#!/usr/bin/env python3
import sys, tarfile
a = sys.argv[1:]
if "archive" in a:
    target = next(value.split("=", 1)[1] for value in a if value.startswith("--output="))
    with tarfile.open(target, "w") as archive:
        entry = tarfile.TarInfo("dapps")
        entry.type = tarfile.DIRTYPE
        entry.mode = 0o755
        archive.addfile(entry)
else:
    print(("b" if "containers/" in a[-1] else "a") * 40)
'''

CP = r'''#!/usr/bin/env python3
import os, pathlib, sys
if "dapps/dependencies" in sys.argv:
    pathlib.Path(sys.argv[-1]).mkdir()
else:
    os.execv(os.environ["REAL_CP"], [os.environ["REAL_CP"], *sys.argv[1:]])
'''


class SourceLauncherTest(unittest.TestCase):
    def test_all_selected_prepares_both_artifacts_with_partial_cache_and_preserves_menu_input(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binaries = root / "bin"
            binaries.mkdir()
            for name, text in (("docker", DOCKER), ("git", GIT), ("cp", CP)):
                path = binaries / name
                path.write_text(text)
                path.chmod(0o755)
            instance = root / "instance"
            original = instance / "original/artifact/deployment.json"
            replacement = instance / "replacement/ui/artifact/ui-deployment.json"
            for path, text in ((original, "{}"), (replacement, '{"replacement":true}')):
                path.parent.mkdir(parents=True)
                path.write_text(text)
            cache = original.parent.parent / "source-publication" / hashlib.sha256(original.read_bytes()).hexdigest() / "requests"
            cache.mkdir(parents=True)
            for role in ("manager", "components", "ui"):
                (cache / f"{role}.json").write_text(json.dumps({"role": role, "origin": str(original)}))
            catalog = root / "catalog.json"
            catalog.write_text("{}")
            env = {name: value for name, value in os.environ.items() if name not in ("SOURCE_ARTIFACT", "SOURCE_CATALOG")}
            env.update(CASE_ROOT=str(root), SOURCE_CATALOG=str(catalog), RELEASE_INSTANCE_ROOT=str(instance),
                       REAL_CP=shutil.which("cp"), REAL_SETSID=shutil.which("setsid"),
                       FAKE_DOCKER=str(binaries / "docker"), FAKE_GIT=str(binaries / "git"), FAKE_CP=str(binaries / "cp"))
            script = r'''
reject_release_path_symlinks() { :; }
docker() { python3 "$FAKE_DOCKER" "$@"; }
git() { python3 "$FAKE_GIT" "$@"; }
cp() { python3 "$FAKE_CP" "$@"; }
realpath() { python3 -c 'import os,sys; print(os.path.normpath(sys.argv[-1]))' "$@"; }
setsid() {
  if [[ "$1" == docker ]]; then shift; exec "$REAL_SETSID" python3 "$FAKE_DOCKER" "$@"
  else exec "$REAL_SETSID" "$@"; fi
}
export -f reject_release_path_symlinks docker git cp realpath setsid
exec bash tools/release_source.sh bike-nft
'''
            completed = subprocess.run(["bash", "-euo", "pipefail", "-c", script], cwd=ROOT, env=env,
                                       input="1\n", text=True, capture_output=True, timeout=15)
            self.assertEqual(0, completed.returncode, completed.stdout + completed.stderr)
            self.assertEqual([str(original), str(replacement)], (root / "prepared").read_text().splitlines())
            submitted = json.loads((root / "submitted.json").read_text())
            self.assertEqual(["manager", "components", "camRoot", "ui"], [body["role"] for body in submitted])
            self.assertEqual(str(replacement), submitted[-1]["origin"])
