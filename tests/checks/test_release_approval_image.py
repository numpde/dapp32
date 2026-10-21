from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest

from .common import ROOT, rendered_compose_config


class ReleaseApprovalImageTest(unittest.TestCase):
    def test_dependency_fetch_and_context_creation_have_separate_authority(self) -> None:
        config = rendered_compose_config(
            ("compose/package-deps.yml", "compose/release/approval-image.yml"),
            env={
                "PACKAGE_INPUT_DIR": "/tmp/approval-image-manifests",
                "RELEASE_APPROVAL_SOURCE_DIR": "/tmp/approval-image-source",
                "RELEASE_APPROVAL_CONTEXT_DIR": "/tmp/approval-image-context",
            },
        )
        services = config["services"]
        stage = services["package-stage"]
        context = services["release-approval-context"]

        self.assertEqual({"package_internal"}, set(stage["networks"]))
        self.assertEqual(
            [
                ("bind", "/tmp/approval-image-manifests", "/input", True),
                ("volume", "package-out", "/out", None),
            ],
            [(v["type"], v["source"], v["target"], v.get("read_only")) for v in stage["volumes"]],
        )
        self.assertEqual("none", context["network_mode"])
        self.assertTrue(context["read_only"])
        self.assertEqual("1000:1000", context["user"])
        self.assertEqual(
            [
                ("bind", "/tmp/approval-image-source", "/source", True),
                ("volume", "package-out", "/dependencies", True),
                ("bind", "/tmp/approval-image-context", "/context", None),
            ],
            [(v["type"], v["source"], v["target"], v.get("read_only")) for v in context["volumes"]],
        )
        self.assertEqual({"RELEASE_APPROVAL_TEST_SOURCE": "/source/js", "RELEASE_APPROVAL_TEST_DEPENDENCIES": "/dependencies"}, context["environment"])
        self.assertIn("/tmp:rw,nosuid,nodev,size=256m", context["tmpfs"])
        self.assertEqual(["sh", "-ec"], context["command"][:2])
        self.assertIn("node --experimental-strip-types --test /source/containers/release-approval/prepare-context.test.mjs", context["command"][2])
        self.assertIn("node /source/containers/release-approval/prepare-context.mjs /source/js /dependencies /source/containers/release-approval /context", context["command"][2])


class _ReleaseCommandHarness:
    """Run the real entrypoint and process helper with Bash function boundaries.

    Temporary files are read by Bash/Python, never executed from /tmp (the
    checks container deliberately mounts it noexec). No Docker daemon or Git
    executable is involved.
    """

    def __init__(
        self, kind: str, *, block: str = "stage", hold_down: bool = True,
        down_status: int = 0, child_status: int = 0,
    ) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="release-cancel-test-")
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.work = self.root / "work"
        self.output = self.root / "published"
        self.events = self.root / "events"
        self.log = self.root / "console.log"
        self.unrelated = self.root / "unrelated"
        self.unrelated.write_text("leave this alone\n", encoding="utf-8")
        self.repo.mkdir()
        self.work.mkdir()
        self.events.touch()
        for name in ("release_approval_image_build.sh", "release_rehearsal.sh", "release_process.sh"):
            destination = self.repo / "tools" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / "tools" / name, destination)
        files = {
            "js/package.json": "{}\n",
            "js/package-lock.json": "{}\n",
            "js/packages/example/package.json": "{}\n",
            "js/apps/example/package.json": "{}\n",
            "dapps/placeholder": "fixture\n",
            "containers/release-approval/Dockerfile": "FROM fixture-base\n",
            "containers/release-approval/prepare-context.mjs": "// fixture\n",
            "containers/node-deps/Dockerfile": "FROM fixture-base\n",
            "containers/https-egress-proxy/Dockerfile": "FROM fixture-base\n",
            "compose/package-deps.yml": "services: {}\n",
            "compose/release/approval-image.yml": "services: {}\n",
            "compose/release/rehearsal.yml": "services: {}\n",
            "tools/release_approval_pty_check.py": "# replaced by a Bash function boundary\n",
        }
        for name, content in files.items():
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8")
        source_files = sorted(path for path in self.repo.rglob("*") if path.is_file())
        self.archive = self.root / "candidate.tar"
        with tarfile.open(self.archive, "w") as archive:
            for path in source_files:
                archive.add(path, arcname=str(path.relative_to(self.repo)), recursive=False)
        file_list = self.root / "files"
        file_list.write_bytes(b"".join(
            str(path.relative_to(self.repo)).encode() + b"\0" for path in source_files
        ))
        for name in ("dapps/dependencies/owned", "js/node_modules/owned"):
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("copied dependency\n", encoding="utf-8")
        io_boundary = self.root / "tar_boundary.py"
        io_boundary.write_text(
            "import os, shutil, sys, tarfile\n"
            "args = sys.argv[1:]\n"
            "if '--create' in args:\n"
            "    shutil.copyfile(os.environ['TEST_ARCHIVE'], args[args.index('--file') + 1])\n"
            "else:\n"
            "    source = args[args.index('-xf') + 1] if '-xf' in args else args[args.index('--file') + 1]\n"
            "    target = args[args.index('-C') + 1] if '-C' in args else args[args.index('--directory') + 1]\n"
            "    with tarfile.open(source) as archive:\n"
            "        archive.extractall(target, filter='data')\n",
            encoding="utf-8",
        )
        bash_env = self.root / "boundaries.bash"
        bash_env.write_text(r"""
event() { printf '%s\n' "$*" >>"$TEST_EVENTS"; }
# exec preserves the process-group leader tracked by release_process.sh.
setsid() {
  event "owned $BASHPID"
  exec "$TEST_SETSID" "$TEST_BASH" -c '"$@"' bash "$@"
}
timeout() {
  while [[ "$1" == --* ]]; do shift; done
  shift
  "$@"
}
id() { printf '1000\n'; }
realpath() { local last; for last; do :; done; printf '%s\n' "$last"; }
mktemp() {
  if [[ "$*" == *published.tmp.* ]]; then
    command mkdir "$TEST_PARTIAL"
    printf '%s\n' "$TEST_PARTIAL"
  else
    printf '%s\n' "$TEST_WORK"
  fi
}
git() {
  local argument output=
  case " $* " in
    *" cat-file -t "*) printf 'commit\n' ;;
    *" archive "*)
      for argument; do
        case "$argument" in --output=*) output=$(printf '%s' "$argument" | cut -d= -f2-) ;; esac
      done
      command cp "$TEST_ARCHIVE" "$output" ;;
    *" rev-parse --local-env-vars "*) printf 'GIT_DIR\n' ;;
    *" rev-parse HEAD "*) printf '%s\n' "$TEST_COMMIT" ;;
    *" ls-files "*) command cat "$TEST_FILES" ;;
    *" init "*|*" add "*|*" commit "*) : ;;
    *) event "unexpected git $*"; return 90 ;;
  esac
}
tar() { command "$TEST_PYTHON" "$TEST_TAR" "$@"; }
block_child() {
  trap 'trap "" INT TERM HUP; event child-term; if [[ "$TEST_BLOCK" == pty ]]; then IFS= read -r reply; fi; event child-stopped; exit "$TEST_CHILD_STATUS"' TERM
  event "child-ready $BASHPID"
  IFS= read -r reply
  return 91
}
docker() {
  local project= argument previous=
  if [[ "$1" == image && "$2" == inspect ]]; then
    case "$*" in
      *"{{.Id}}"*) printf '%s\n' "$TEST_IMAGE" ;;
      *org.opencontainers.image.revision*) printf '%s\n' "$TEST_COMMIT" ;;
    esac
    return 0
  fi
  if [[ "$1" == build ]]; then
    if [[ "$TEST_BLOCK" == image ]]; then block_child; return; fi
    printf '%s\n' "$TEST_IMAGE"
    return 0
  fi
  if [[ "$1" != compose ]]; then event "unexpected docker $*"; return 90; fi
  for argument; do
    if [[ "$previous" == -p || "$previous" == --project-name ]]; then project=$argument; fi
    previous=$argument
  done
  event "compose $project $*"
  case " $* " in
    *" down "*)
      event "down-start $project"
      if [[ "$TEST_HOLD_DOWN" == 1 ]]; then IFS= read -r reply; fi
      event "down-done $project"
      return "$TEST_DOWN_STATUS" ;;
    *" build "*)
      if [[ "$TEST_BLOCK" == stage ]]; then block_child; fi ;;
    *" rehearsal-prepare "*)
      printf '# fixture inputs\n' >"$RELEASE_REHEARSAL_DIR/control/inputs.env" ;;
    *" up "*|*" run "*) : ;;
    *) event "unexpected compose $*"; return 90 ;;
  esac
}
python3() {
  if [[ "$1" != tools/release_approval_pty_check.py ]]; then
    event "unexpected python3 $*"; return 90
  fi
  block_child
}
""", encoding="utf-8")
        bash = shutil.which("bash")
        setsid = shutil.which("setsid")
        if not bash or not setsid:
            self.temp.cleanup()
            raise AssertionError("release cancellation checks require Bash and setsid")
        env = dict(os.environ)
        env.update({
            "BASH_ENV": str(bash_env),
            "TEST_BASH": bash,
            "TEST_SETSID": setsid,
            "TEST_PYTHON": sys.executable,
            "TEST_TAR": str(io_boundary),
            "TEST_ARCHIVE": str(self.archive),
            "TEST_FILES": str(file_list),
            "TEST_WORK": str(self.work),
            "TEST_PARTIAL": str(self.root / "published.tmp.fixture"),
            "TEST_EVENTS": str(self.events),
            "TEST_COMMIT": "a" * 40,
            "TEST_IMAGE": "sha256:" + "b" * 64,
            "TEST_BLOCK": block,
            "TEST_HOLD_DOWN": str(int(hold_down)),
            "TEST_DOWN_STATUS": str(down_status),
            "TEST_CHILD_STATUS": str(child_status),
            "LOCAL_UID": "1000",
            "LOCAL_GID": "1000",
        })
        if kind == "image":
            argv = [bash, str(self.repo / "tools/release_approval_image_build.sh"), "a" * 40, str(self.output)]
            self.project = "cam-approval-image-work"
        else:
            argv = [bash, str(self.repo / "tools/release_rehearsal.sh"), "escrow", "docker compose", "approval-pty"]
            digest = hashlib.sha256(str(self.work).encode()).hexdigest()[:24]
            self.project = "cam-rehearsal-" + digest
        self.log_stream = self.log.open("w", encoding="utf-8")
        self.process = subprocess.Popen(
            argv, cwd=self.repo, env=env, stdin=subprocess.PIPE,
            stdout=self.log_stream, stderr=subprocess.STDOUT, text=True,
            start_new_session=True,
        )

    def __enter__(self) -> "_ReleaseCommandHarness":
        return self

    def lines(self) -> list[str]:
        return self.events.read_text(encoding="utf-8").splitlines()

    def wait_for(self, prefix: str) -> list[str]:
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            lines = self.lines()
            if any(line.startswith(prefix) for line in lines):
                return lines
            if self.process.poll() is not None:
                break
            time.sleep(0.01)
        raise AssertionError(
            f"Missing event {prefix!r}; events={self.lines()!r}\n"
            + self.log.read_text(encoding="utf-8")
        )

    def release(self) -> None:
        assert self.process.stdin is not None
        self.process.stdin.write("continue\n")
        self.process.stdin.flush()

    def finish(self) -> int:
        status = self.process.wait(timeout=10)
        if any(line.startswith("unexpected ") for line in self.lines()):
            raise AssertionError(self.lines())
        return status

    def assert_owned_cleanup(self, case: unittest.TestCase) -> None:
        down = [line for line in self.lines() if line.startswith("compose ") and " down " in line]
        case.assertEqual(1, len(down), self.lines())
        case.assertTrue(down[0].startswith("compose " + self.project + " "), down)
        case.assertIn("--volumes", down[0])
        case.assertIn("--remove-orphans", down[0])
        case.assertEqual("leave this alone\n", self.unrelated.read_text(encoding="utf-8"))

    def __exit__(self, *_: object) -> None:
        # Closing the test's input releases every fake read even on assertion
        # failure; kill only groups allocated and recorded by this harness.
        if self.process.stdin is not None:
            self.process.stdin.close()
            self.process.stdin = None
        try:
            self.process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            for line in self.lines():
                if line.startswith("owned "):
                    try:
                        os.killpg(int(line.split()[1]), signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.process.wait(timeout=3)
        self.log_stream.close()
        self.temp.cleanup()


class ReleaseApprovalImageCancellationTest(unittest.TestCase):
    def test_parent_signals_stop_launch_before_owned_cleanup(self) -> None:
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            for phase in ("stage", "image"):
                with self.subTest(signal=signum, phase=phase):
                    with _ReleaseCommandHarness("image", block=phase) as run:
                        run.wait_for("child-ready ")
                        os.kill(run.process.pid, signum)
                        lines = run.wait_for("down-start ")
                        self.assertLess(lines.index("child-stopped"), next(
                            index for index, line in enumerate(lines) if line.startswith("down-start ")
                        ))
                        # Repeated terminal signals cannot interrupt teardown.
                        os.killpg(run.process.pid, signal.SIGINT)
                        os.killpg(run.process.pid, signal.SIGHUP)
                        self.assertIsNone(run.process.poll())
                        run.release()
                        self.assertEqual(128 + signum, run.finish())
                        run.assert_owned_cleanup(self)
                        self.assertFalse(run.work.exists())
                        self.assertFalse(run.output.exists())

    def test_failed_teardown_retains_mounted_image_inputs(self) -> None:
        with _ReleaseCommandHarness("image", hold_down=False, down_status=1) as run:
            run.wait_for("child-ready ")
            os.kill(run.process.pid, signal.SIGTERM)
            self.assertEqual(1, run.finish())
            run.assert_owned_cleanup(self)
            self.assertTrue((run.work / "source/js/package.json").is_file())
            self.assertTrue((run.work / "context").is_dir())
            self.assertIn(str(run.work), run.log.read_text(encoding="utf-8"))

    def test_success_keeps_published_image_provenance(self) -> None:
        with _ReleaseCommandHarness("image", block="none", hold_down=False) as run:
            self.assertEqual(0, run.finish())
            run.assert_owned_cleanup(self)
            self.assertFalse(run.work.exists())
            provenance = json.loads((run.output / "approval-image.json").read_text(encoding="utf-8"))
            self.assertEqual("sha256:" + "b" * 64, provenance["imageId"])
            self.assertEqual("a" * 40, provenance["approvalToolSourceCommit"])
            self.assertFalse(any(" image rm " in line or " system prune " in line for line in run.lines()))


if __name__ == "__main__":
    unittest.main()
