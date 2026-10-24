from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
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
        self, kind: str, *, block: str, hold_down: bool,
        down_status: int, child_status: int, build_directory: Path | None = None,
    ) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix="release-cancel-test-")
        self.root = Path(self.temp.name)
        self.repo = self.root / "repo"
        self.work = self.root / "work"
        self.build = self.root / "image build"
        self.build.mkdir()
        self.provenance = self.build / "approval-image.json"
        self.provenance.write_text('{"fixture":"leave unchanged"}\n', encoding="utf-8")
        if build_directory is not None:
            self.build = build_directory
        self.stamp = "20261021T000000000000Z"
        if kind in ("rehearsal", "rehearsal-target", "rehearsal-full"):
            self.work = self.build / "rehearsals" / (self.stamp + "-aaaaaaaa")
        self.output = self.root / "published"
        self.events = self.root / "events"
        self.log = self.root / "console.log"
        self.unrelated = self.root / "unrelated"
        self.unrelated.write_text("leave this alone\n", encoding="utf-8")
        self.repo.mkdir()
        if kind in ("image", "image-target"):
            self.work.mkdir()
        self.events.touch()
        for name in ("release_approval_image_build.sh", "release_approval_images.sh", "release_rehearsal.sh", "release_process.sh"):
            destination = self.repo / "tools" / name
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / "tools" / name, destination)
        files = {
            "js/package.json": "{}\n",
            "js/package-lock.json": "{}\n",
            "js/packages/example/package.json": "{}\n",
            "js/apps/example/package.json": "{}\n",
            "dapps/placeholder": "fixture\n",
            "dapps/escrow/cam/main.json": "{}\n",
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
  while [[ "$1" == -* ]]; do
    case "$1" in -s|-k) shift 2 ;; *) shift ;; esac
  done
  shift
  if [[ "$TEST_KIND" == rehearsal-full && "$1 $2" == 'bash tools/release_approval_image_build.sh' ]]; then
    fixture_image_build "$@"
    return
  fi
  # The real timeout reaps its command. Avoid adding a shell parent that can
  # die before the fake builder is reaped under the checks container's PID 1.
  if [[ "$TEST_KIND" == rehearsal-full && "$1 $2" == 'bash -c' ]]; then exec "$@"; fi
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
  if [[ "$1 $2" == 'image ls' ]]; then return 0; fi
  if [[ "$1" == inspect ]]; then
    case "$*" in
      *NetworkSettings*) printf '172.20.0.2\n' ;;
      *State.ExitCode*) printf 'exited 1\n' ;;
      *) return 90 ;;
    esac
    return
  fi
  if [[ "$1" == logs ]]; then printf 'inspectReleaseCamBundle\n'; return; fi
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
    *" up "*)
      if [[ "$*" == *bad-cam.yml* ]]; then return 1; fi
      if [[ "$TEST_BLOCK" == infrastructure ]]; then block_child; fi ;;
    *" ps "*)
      case "$*" in
        *release-anvil|*release-plan) printf '%064d\n' 1 ;;
      esac ;;
    *" run "*) : ;;
    *) event "unexpected compose $*"; return 90 ;;
  esac
}
fixture_image_build() {
  event "fixture-image-build $*"
  if [[ "$TEST_BLOCK" == builder-fail ]]; then return 1; fi
  if [[ "$TEST_BLOCK" == builder ]]; then block_child; fi
  mkdir "$RELEASE_REHEARSAL_DIR/approval-image"
  if [[ "$TEST_BLOCK" == builder-json ]]; then
    printf '{}\n' >"$RELEASE_REHEARSAL_DIR/approval-image/approval-image.json"
  else
    printf '{"imageId":"%s"}\n' "$TEST_IMAGE" >"$RELEASE_REHEARSAL_DIR/approval-image/approval-image.json"
  fi
}
python3() {
  if [[ "$1" == -I ]]; then command "$TEST_PYTHON" "$@"; return; fi
  if [[ "$1" == -c ]]; then printf '%s\n' "$TEST_STAMP"; return; fi
  if [[ "$1" != tools/release_approval_pty_check.py ]]; then
    event "unexpected python3 $*"; return 90
  fi
  printf '{"result":"fixture"}\n' >"$RELEASE_REHEARSAL_DIR/approval-diagnostics.json"
  event "pty $* image=${RELEASE_APPROVAL_IMAGE-unset}"
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
            "TEST_STAMP": self.stamp,
            "TEST_IMAGE": "sha256:" + "b" * 64,
            "TEST_BLOCK": block,
            "TEST_KIND": kind,
            "TEST_HOLD_DOWN": str(int(hold_down)),
            "TEST_DOWN_STATUS": str(down_status),
            "TEST_CHILD_STATUS": str(child_status),
            "LOCAL_UID": "1000",
            "LOCAL_GID": "1000",
            "RELEASE_APPROVAL_SIMULATION": "normal",
            "RELEASE_APPROVAL_IMAGE_OUTPUT_DIR": str(self.build),
        })
        if kind in ("image", "image-target"):
            argv = [bash, str(self.repo / "tools/release_approval_image_build.sh"), "a" * 40, str(self.output)]
            self.project = "cam-approval-image-work"
        else:
            argv = [bash, str(self.repo / "tools/release_rehearsal.sh"), "escrow", "docker compose", "approval-pty"]
            if kind == "rehearsal-full":
                argv[-1] = "release"
                argv.extend(["-f", "compose/release/deploy.yml"])
                env["RELEASE_APPROVAL_IMAGE"] = "sha256:" + "f" * 64
            digest = hashlib.sha256(str(self.work).encode()).hexdigest()[:24]
            self.project = "cam-rehearsal-" + digest
        self.projects = [self.project]
        if kind == "rehearsal-full":
            self.projects.insert(0, self.project + "-planner")
        if kind in ("image-target", "rehearsal-target"):
            # Exercise the target's command with a shorter deadline; its lane
            # guards are covered separately. Keep the real timeout executable.
            target, deadline, test_deadline = {
                "image-target": ("release/approval/image/build", "120s", "1s"),
                "rehearsal-target": ("escrow/release/approval/start/check", "600s", "5s"),
            }[kind]
            if kind == "image-target":
                env.update({"SOURCE_COMMIT": "a" * 40, "RELEASE_APPROVAL_IMAGE_OUTPUT_DIR": str(self.output)})
            generated = subprocess.run(
                ["make", "--no-print-directory", "--dry-run", "-f", str(ROOT / "Makefile"), target,
                 "LANE_GUARD=:", "SOLDEER_DEPS_GUARD=:", "PACKAGE_DEPS_GUARD=:",
                 "DOCKER_COMPOSE=docker compose"],
                cwd=ROOT, env=env, capture_output=True, text=True, check=True,
            )
            recipe = generated.stdout
            recipe = recipe.replace(deadline, test_deadline)
            if kind == "image-target":
                library = self.repo / "tools/release_approval_images.sh"
                library.write_text(library.read_text(encoding="utf-8").replace(deadline, test_deadline), encoding="utf-8")
            # Inner rehearsal timers remain mocked; only the target's outer
            # deadline uses the real executable in this fixture.
            argv = [bash, "-ec", "unset -f timeout\n" + recipe]
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
        case.assertEqual(len(self.projects), len(down), self.lines())
        for project, command in zip(self.projects, down):
            case.assertTrue(command.startswith("compose " + project + " "), down)
            case.assertIn("--volumes", command)
            case.assertIn("--remove-orphans", command)
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
                    # silent-defaults: allow-exception-fallback -- Only fixture-owned groups are signalled; a group already gone needs no further cleanup.
                    except ProcessLookupError:
                        pass
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            # silent-defaults: allow-exception-fallback -- The fixture leader may exit during escalation; wait below still reaps it.
            except ProcessLookupError:
                pass
            self.process.wait(timeout=3)
        self.log_stream.close()
        self.temp.cleanup()


class ReleaseApprovalImageCancellationTest(unittest.TestCase):
    def test_target_deadline_stops_work_before_teardown(self) -> None:
        for phase in ("stage", "image"):
            for down_status in (0, 1):
                with self.subTest(phase=phase, down_status=down_status):
                    with _ReleaseCommandHarness(
                        "image-target", block=phase, hold_down=False,
                        down_status=down_status, child_status=0,
                    ) as run:
                        run.wait_for("child-ready ")
                        self.assertNotEqual(0, run.finish())
                        lines = run.lines()
                        self.assertLess(lines.index("child-stopped"), next(
                            index for index, line in enumerate(lines) if line.startswith("down-start ")
                        ))
                        run.assert_owned_cleanup(self)
                        self.assertEqual(bool(down_status), run.work.exists())
                        self.assertFalse(run.output.exists())
                        if down_status:
                            self.assertIn(str(run.work), run.log.read_text(encoding="utf-8"))

    def test_parent_signals_stop_launch_before_owned_cleanup(self) -> None:
        for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
            for phase in ("stage", "image"):
                with self.subTest(signal=signum, phase=phase):
                    with _ReleaseCommandHarness(
                        "image", block=phase, hold_down=True, down_status=0, child_status=0,
                    ) as run:
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
        with _ReleaseCommandHarness(
            "image", block="stage", hold_down=False, down_status=1, child_status=0,
        ) as run:
            run.wait_for("child-ready ")
            os.kill(run.process.pid, signal.SIGTERM)
            self.assertEqual(1, run.finish())
            run.assert_owned_cleanup(self)
            self.assertTrue((run.work / "source/js/package.json").is_file())
            self.assertTrue((run.work / "context").is_dir())
            self.assertIn(str(run.work), run.log.read_text(encoding="utf-8"))

    def test_success_keeps_published_image_provenance(self) -> None:
        with _ReleaseCommandHarness(
            "image", block="none", hold_down=False, down_status=0, child_status=0,
        ) as run:
            self.assertEqual(0, run.finish())
            run.assert_owned_cleanup(self)
            self.assertFalse(run.work.exists())
            provenance = json.loads((run.output / "approval-image.json").read_text(encoding="utf-8"))
            self.assertEqual("sha256:" + "b" * 64, provenance["imageId"])
            self.assertEqual("a" * 40, provenance["approvalToolSourceCommit"])
            self.assertFalse(any(" image rm " in line or " system prune " in line for line in run.lines()))


if __name__ == "__main__":
    unittest.main()
