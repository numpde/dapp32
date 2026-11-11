"""Pin release outcomes against a stateful engine peer, without network or Docker."""

from io import BytesIO
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from tools import viewer_update as updater


OLD, NEW = "a" * 40, "b" * 40
OLD_ID, NEW_ID, BACK_ID, OTHER_ID = ["sha256:" + c * 64 for c in "1234"]
PROJECT = "fixture-viewer"
REPOSITORY = "cam-viewer-" + PROJECT


def viewer_image(identifier, revision, tags):
    return {"Id": identifier, "RepoTags": tags, "Config": {"Labels": {
        "org.opencontainers.image.source": updater.SOURCE,
        "org.opencontainers.image.revision": revision, "com.cam.role": "viewer",
        "com.cam.viewer.project": PROJECT, "com.cam.viewer.modified": "false"}}}


class ViewerUpdateTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.images = {
            OLD_ID: viewer_image(OLD_ID, OLD, [REPOSITORY + ":current"]),
            BACK_ID: viewer_image(BACK_ID, "c" * 40, [REPOSITORY + ":rollback"]),
            OTHER_ID: viewer_image(OTHER_ID, "d" * 40, ["unrelated:keep"]),
        }
        self.container = {"Image": OLD_ID, "State": {"Running": True, "Health": {"Status": "healthy"}}}
        self.container["HostConfig"] = {"PortBindings": {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8080"}]}}
        self.target = NEW
        self.dirty = ""
        self.changed_runtime = False
        self.fail_build = False
        self.fail_activate = False
        self.fail_rollback = False
        self.fail_cleanup = False
        self.fail_public = False
        self.fail_retention_tag = False
        self.missing_updater = False
        for name, replacement in (("run", self.run_peer), ("docker", self.docker_peer),
                                  ("make", self.make_peer), ("public_revision", self.public_peer)):
            mock = patch.object(updater, name, replacement)
            mock.start()
            self.addCleanup(mock.stop)
        environment = patch.dict(os.environ, VIEWER_COMPOSE_PROJECT_NAME=PROJECT,
                                 VIEWER_BIND_HOST="127.0.0.1", VIEWER_PORT="8080",
                                 VIEWER_PUBLIC_ORIGIN="https://viewer.example", CAM_DOCKER_ENDPOINT="unix:///tmp/fixture.sock")
        environment.start()
        self.addCleanup(environment.stop)

    def run_peer(self, *args, **kwargs):
        self.calls.append(args)
        if args[:3] == ("git", "status", "--porcelain"):
            return self.dirty
        if args[:2] == ("git", "rev-parse"):
            return self.target
        if args[:2] == ("git", "show"):
            return "changed model" if self.changed_runtime and args[2].startswith(NEW) else "stable model"
        if args[:2] == ("git", "cat-file") and self.missing_updater:
            raise subprocess.CalledProcessError(128, args)
        return ""

    def docker_peer(self, *args):
        self.calls.append(args)
        if args[:2] == ("container", "ls"):
            return "container"
        if args[:2] == ("container", "inspect"):
            return json.dumps([self.container])
        if args[:2] == ("image", "inspect"):
            selected = [value for identifier, value in self.images.items()
                        if args[2] == identifier or args[2] in value["RepoTags"]]
            return json.dumps(selected)
        if args[:2] == ("image", "ls"):
            reference = next((value.removeprefix("reference=") for value in args if value.startswith("reference=")), None)
            return "\n".join(identifier for identifier, value in self.images.items()
                             if reference is None or reference in value["RepoTags"])
        if args[:2] == ("image", "tag"):
            if self.fail_retention_tag and args[3] == REPOSITORY + ":rollback":
                raise ValueError("retention tag failed")
            for value in self.images.values():
                if args[3] in value["RepoTags"]:
                    value["RepoTags"].remove(args[3])
            self.images[args[2]]["RepoTags"].append(args[3])
            return ""
        if args[:2] == ("image", "rm"):
            if self.fail_cleanup:
                raise ValueError("cleanup denied")
            for value in self.images.values():
                if args[2] in value["RepoTags"]:
                    value["RepoTags"].remove(args[2])
            return ""
        if args[:2] == ("image", "prune"):
            return ""
        raise AssertionError(args)

    def make_peer(self, target, *, image=None):
        self.calls.append(("make", target, image))
        if target == "viewer/image/build":
            if self.fail_build:
                raise ValueError("build failed")
            self.images[NEW_ID] = viewer_image(NEW_ID, NEW, [image])
        if target == "viewer/up":
            self.container["Image"] = image
            if image == NEW_ID and self.fail_activate or image != NEW_ID and self.fail_rollback:
                raise ValueError("activation failed")
            self.container["State"]["Health"]["Status"] = "healthy"

    def public_peer(self, origin, revision):
        self.calls.append(("public", revision))
        if self.fail_public and revision == NEW:
            raise ValueError("public revision mismatch")

    def test_success_rotates_rollback_only_after_public_observation(self):
        updater.update()
        self.assertEqual(NEW_ID, self.container["Image"])
        self.assertIn(REPOSITORY + ":rollback", self.images[OLD_ID]["RepoTags"])
        self.assertIn(REPOSITORY + ":current", self.images[NEW_ID]["RepoTags"])
        self.assertEqual(["unrelated:keep"], self.images[OTHER_ID]["RepoTags"])
        self.assertLess(self.calls.index(("public", NEW)), self.calls.index(("image", "tag", OLD_ID, REPOSITORY + ":rollback")))

    def test_no_change_aligns_source_without_rebuilding(self):
        self.target = OLD
        updater.update()
        self.assertIn(("git", "checkout", "--detach", OLD), self.calls)
        self.assertFalse(any(call[0] == "make" for call in self.calls))

    def test_historical_source_cannot_remove_the_timer_entrypoint(self):
        self.missing_updater = True
        with self.assertRaisesRegex(ValueError, "no viewer updater"):
            updater.update()
        self.assertFalse(any(call[:2] == ("git", "checkout") for call in self.calls))
        self.assertEqual(OLD_ID, self.container["Image"])

    def test_dirty_source_and_runtime_migrations_stop_before_build(self):
        for dirty, changed, message in ((" M source", False, "local source"), ("", True, "migrate runtime")):
            self.dirty, self.changed_runtime = dirty, changed
            with self.assertRaisesRegex(ValueError, message):
                updater.update()
        self.assertEqual(OLD_ID, self.container["Image"])
        self.assertFalse(any(call[0] == "make" for call in self.calls))

    def test_build_failure_leaves_running_image_and_release_tags(self):
        self.fail_build = True
        with self.assertRaisesRegex(ValueError, "build failed"):
            updater.update()
        self.assertEqual(OLD_ID, self.container["Image"])
        self.assertIn(REPOSITORY + ":rollback", self.images[BACK_ID]["RepoTags"])

    def test_activation_and_public_failure_restore_actual_previous_image(self):
        for failure in ("fail_activate", "fail_public"):
            with self.subTest(failure=failure):
                setattr(self, failure, True)
                with self.assertRaises(ValueError):
                    updater.update()
                self.assertEqual(OLD_ID, self.container["Image"])
                self.assertIn(REPOSITORY + ":rollback", self.images[BACK_ID]["RepoTags"])
                setattr(self, failure, False)

    def test_failed_rollback_preserves_candidate_and_recovery_images(self):
        self.fail_activate = self.fail_rollback = True
        with self.assertRaisesRegex(RuntimeError, "Rollback could not be confirmed"):
            updater.update()
        self.assertIn(REPOSITORY + ":" + NEW, self.images[NEW_ID]["RepoTags"])
        self.assertFalse(any(call[:2] in (("image", "rm"), ("image", "prune")) for call in self.calls))

    def test_cleanup_failure_does_not_replace_activation_error(self):
        self.fail_activate = self.fail_cleanup = True
        with self.assertRaisesRegex(ValueError, "activation failed"):
            updater.update()
        self.assertEqual(OLD_ID, self.container["Image"])

    def test_unhealthy_runtime_uses_retained_rollback_without_promoting_it(self):
        self.container["State"]["Health"]["Status"] = "unhealthy"
        self.fail_activate = True
        with self.assertRaises(ValueError):
            updater.update()
        self.assertEqual(BACK_ID, self.container["Image"])
        self.assertIn(REPOSITORY + ":rollback", self.images[BACK_ID]["RepoTags"])

    def test_owned_retirement_preserves_referenced_and_externally_tagged_images(self):
        self.images[NEW_ID] = viewer_image(NEW_ID, NEW, [REPOSITORY + ":obsolete"])
        updater.retire_images(PROJECT, REPOSITORY)
        self.assertEqual([], self.images[NEW_ID]["RepoTags"])
        self.assertIn(REPOSITORY + ":current", self.images[OLD_ID]["RepoTags"])
        self.assertIn(REPOSITORY + ":rollback", self.images[BACK_ID]["RepoTags"])
        self.assertEqual(["unrelated:keep"], self.images[OTHER_ID]["RepoTags"])

    def test_retention_tag_failure_keeps_actual_previous_image(self):
        self.images[OLD_ID]["RepoTags"] = [REPOSITORY + ":" + OLD]
        self.fail_retention_tag = True
        with self.assertRaisesRegex(ValueError, "retention tag failed"):
            updater.update()
        self.assertIn(REPOSITORY + ":current", self.images[OLD_ID]["RepoTags"])
        self.assertIn(REPOSITORY + ":rollback", self.images[BACK_ID]["RepoTags"])

    def test_unhealthy_runtime_refuses_incompatible_retained_rollback(self):
        self.container["State"]["Health"]["Status"] = "unhealthy"
        self.images[BACK_ID]["Config"]["Labels"]["com.cam.viewer.modified"] = "true"
        with self.assertRaisesRegex(ValueError, "clean viewer-owned identity"):
            updater.update()
        self.assertFalse(any(call[0] == "make" for call in self.calls))


class PublicViewerTest(unittest.TestCase):
    def test_observes_entry_revision_and_rejects_https_downgrade(self):
        class Response(BytesIO):
            def geturl(self):
                return self.url
        index = Response(b'<script type="module" src="/assets/main.js"></script>')
        bundle = Response(NEW.encode())
        index.url = bundle.url = "https://viewer.example/"
        with patch.object(updater, "urlopen", side_effect=[index, bundle]):
            updater.public_revision("https://viewer.example", NEW)
        downgrade = Response(b"")
        downgrade.url = "http://viewer.example/"
        with patch.object(updater, "urlopen", return_value=downgrade), self.assertRaisesRegex(ValueError, "redirected"):
            updater.public_revision("https://viewer.example", NEW)


class UpdateCancellationTest(unittest.TestCase):
    def test_cancellation_stops_ready_child_group_before_returning(self):
        # Establish a live descendant before interrupting the supervisor. Its
        # process state at return proves cancellation, without a delayed-write
        # assertion that could pass before an orphan gets around to writing.
        with tempfile.TemporaryDirectory() as directory:
            ready = Path(directory) / "ready"
            program = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',sys.argv[1]]); time.sleep(10)"
            child = f"import os,time; open({str(ready)!r},'w').write(str(os.getpid())); time.sleep(10)"
            supervisor = f'''import signal,sys
sys.path.insert(0, {str(updater.ROOT)!r})
from tools import viewer_update as updater
signal.signal(signal.SIGTERM, updater.interrupted)
try:
    updater.execute([sys.executable, '-c', sys.argv[1], sys.argv[2]], timeout=30, capture=True)
except TimeoutError:
    sys.exit(37)
'''
            process = subprocess.Popen([sys.executable, "-I", "-B", "-c", supervisor, program, child])
            try:
                deadline = time.monotonic() + 5
                while not ready.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.01)
                self.assertTrue(ready.exists(), "descendant must be running before cancellation")
                descendant = int(ready.read_text())
                process.send_signal(signal.SIGTERM)
                self.assertEqual(37, process.wait(timeout=5))
                status = Path(f"/proc/{descendant}/stat")
                if status.exists():
                    self.assertEqual("Z", status.read_text().split()[2], "descendant must have exited before rollback may run")
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait()
