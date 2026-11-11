"""Exercise configured file creation and all Make/systemd handoffs offline."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from tools import viewer_unit_files as creator
from .common import ROOT


PEER = '''import json,os,sys
with open(os.environ["SYSTEMD_CALLS"], "a") as stream:
    stream.write(json.dumps(sys.argv[1:]) + "\\n")
if "daemon-reload" in sys.argv:
    sys.exit(int(os.environ["RELOAD_STATUS"]))
print("ActiveState=inactive\\nResult=success\\nExecMainStatus=0")
'''

SETTINGS = {
    "DOCKER_CONTEXT": "chosen-local-context",
    "VIEWER_COMPOSE_PROJECT_NAME": "cam-viewer",
    "VIEWER_BIND_HOST": "127.0.0.1",
    "VIEWER_PORT": "8080",
    "VIEWER_PUBLIC_ORIGIN": "https://viewer.example.org",
}


class ViewerUnitFilesTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        peer = self.root / "peer.py"
        peer.write_text(PEER)
        self.calls = self.root / "systemd-calls"
        self.trace = self.root / "docker-calls"
        self.environment = dict(os.environ,
            PATH=f"{ROOT / 'tests/fixtures/viewer-units'}:{ROOT / 'tests/fixtures/docker-context'}:{os.environ['PATH']}",
            XDG_CONFIG_HOME=str(self.root / "configuration"), SYSTEMD_CALLS=str(self.calls),
            UNIT_TEST_PEER=str(peer), RELOAD_STATUS="0", TRACE=str(self.trace),
            ENDPOINT="unix:///tmp/unit-fixture.sock")
        for name in SETTINGS:
            if name in self.environment:
                del self.environment[name]
        self.directory = self.root / "configuration/systemd/user"

    def make(self, *arguments):
        return subprocess.run(["make", "--no-print-directory", *arguments], cwd=ROOT,
                              env=self.environment, stdin=subprocess.DEVNULL,
                              capture_output=True, text=True, timeout=15)

    def create(self, settings):
        return self.make("viewer/update/unit-files/create", *(name + "=" + value for name, value in settings.items()))

    def operations(self):
        if not self.calls.exists():
            return []
        return [json.loads(line) for line in self.calls.read_text().splitlines()]

    def test_create_uses_explicit_settings_without_docker_or_activation(self):
        result = self.create(SETTINGS)
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual({creator.SERVICE, creator.TIMER}, {path.name for path in self.directory.iterdir()})
        service = (self.directory / creator.SERVICE).read_text()
        self.assertIn('WorkingDirectory=' + str(ROOT) + '/\n', service)
        self.assertIn('"DOCKER_CONTEXT=chosen-local-context"', service)
        for name, value in SETTINGS.items():
            self.assertIn('"' + name + '=' + value + '"', service)
        self.assertEqual((ROOT / "tools/systemd" / creator.TIMER).read_bytes(), (self.directory / creator.TIMER).read_bytes())
        self.assertEqual([["systemctl", "--user", "daemon-reload"]], self.operations())
        self.assertFalse(self.trace.exists(), "file creation must not inspect Docker")

    def test_existing_file_or_dangling_symlink_refuses_both_outputs(self):
        self.directory.mkdir(parents=True)
        for name in (creator.SERVICE, creator.TIMER):
            for symlink in (False, True):
                with self.subTest(name=name, symlink=symlink):
                    existing = self.directory / name
                    if symlink:
                        existing.symlink_to(self.root / "missing")
                    else:
                        existing.write_text("operator configuration")
                    result = self.create(SETTINGS)
                    self.assertNotEqual(0, result.returncode)
                    self.assertIn("Refusing to replace", result.stderr)
                    self.assertEqual([existing], list(self.directory.iterdir()))
                    if not symlink:
                        self.assertEqual("operator configuration", existing.read_text())
                    existing.unlink()
        self.assertEqual([], self.operations())

    def test_required_inputs_are_not_filled_from_make_defaults(self):
        for omitted in SETTINGS:
            with self.subTest(omitted=omitted):
                settings = {name: value for name, value in SETTINGS.items() if name != omitted}
                result = self.create(settings)
                self.assertNotEqual(0, result.returncode)
                self.assertIn(omitted + " must be supplied explicitly", result.stderr)
        self.assertFalse(self.directory.exists())
        self.assertFalse(self.trace.exists())

    def test_invalid_settings_and_make_expressions_fail_before_writes(self):
        for name, value in (("VIEWER_COMPOSE_PROJECT_NAME", "Invalid.Name"),
                            ("VIEWER_BIND_HOST", "localhost"), ("VIEWER_PORT", "80"),
                            ("VIEWER_PUBLIC_ORIGIN", "https://user:password@viewer.example.org"),
                            ("VIEWER_PUBLIC_ORIGIN", "https://viewer.example.org/path"),
                            ("VIEWER_PORT", "$(shell touch " + str(self.root / "injected") + ")")):
            with self.subTest(name=name, value=value):
                self.assertNotEqual(0, self.create(SETTINGS | {name: value}).returncode)
        self.assertFalse(self.directory.exists())
        self.assertFalse((self.root / "injected").exists())
        self.assertFalse(self.trace.exists())

    def test_reload_failure_retains_complete_files_and_does_not_activate(self):
        self.environment["RELOAD_STATUS"] = "7"
        result = self.create(SETTINGS)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("Both unit files were created", result.stderr)
        self.assertEqual({creator.SERVICE, creator.TIMER}, {path.name for path in self.directory.iterdir()})
        self.assertEqual([["systemctl", "--user", "daemon-reload"]], self.operations())

    def test_racing_second_file_is_preserved_and_own_partial_file_is_removed(self):
        original_open = os.open
        def race(path, flags, mode):
            if Path(path).name == creator.TIMER:
                Path(path).write_text("another creator")
            return original_open(path, flags, mode)
        with patch.dict(os.environ, self.environment | SETTINGS), patch.object(creator.os, "open", race):
            with self.assertRaises(FileExistsError):
                creator.create(SETTINGS["DOCKER_CONTEXT"])
        self.assertFalse((self.directory / creator.SERVICE).exists())
        self.assertEqual("another creator", (self.directory / creator.TIMER).read_text())
        self.assertEqual([], self.operations())

    def test_special_checkout_path_is_a_literal_working_directory_not_an_exec_argument(self):
        checkout = self.root / 'checkout space %n $literal "quoted" @VIEWER_PORT@'
        (checkout / "tools/systemd").mkdir(parents=True)
        for name in (creator.SERVICE, creator.TIMER):
            shutil.copyfile(ROOT / "tools/systemd" / name, checkout / "tools/systemd" / name)
        with patch.dict(os.environ, self.environment | SETTINGS), patch.object(creator, "ROOT", checkout):
            creator.create(SETTINGS["DOCKER_CONTEXT"])
        service = (self.directory / creator.SERVICE).read_text()
        self.assertIn('space %%n $literal "quoted"', service)
        self.assertNotIn('space %n', service)
        self.assertIn('@VIEWER_PORT@', service, "checkout text is not expanded as another template field")

    def test_template_owns_the_command_and_incomplete_templates_fail_before_writing(self):
        checkout = self.root / "template-source"
        (checkout / "tools/systemd").mkdir(parents=True)
        for name in (creator.SERVICE, creator.TIMER):
            shutil.copyfile(ROOT / "tools/systemd" / name, checkout / "tools/systemd" / name)
        source = checkout / "tools/systemd" / creator.SERVICE
        template = source.read_text().replace("--no-print-directory", "--warn-undefined-variables")
        source.write_text(template)
        with patch.dict(os.environ, self.environment | SETTINGS), patch.object(creator, "ROOT", checkout):
            self.assertIn("--warn-undefined-variables", creator.service_text(SETTINGS["DOCKER_CONTEXT"]))
            for replacement in ("", "@VIEWER_PORT@ @VIEWER_PORT@"):
                source.write_text(template.replace("@VIEWER_PORT@", replacement))
                with self.assertRaisesRegex(ValueError, "exactly one @VIEWER_PORT@"):
                    creator.create(SETTINGS["DOCKER_CONTEXT"])
        self.assertFalse(self.directory.exists())
        self.assertEqual([], self.operations())

    def test_host_configuration_cannot_be_written_inside_the_repository(self):
        with patch.dict(os.environ, self.environment | SETTINGS | {"XDG_CONFIG_HOME": str(ROOT / "private-unit-settings")}):
            with self.assertRaisesRegex(ValueError, "outside the repository"):
                creator.create(SETTINGS["DOCKER_CONTEXT"])
        self.assertEqual([], self.operations())

    def test_root_cannot_create_units_whose_update_command_would_refuse_to_run(self):
        with patch.object(creator.os, "geteuid", return_value=0):
            with self.assertRaisesRegex(ValueError, "non-root deployment user"):
                creator.create(SETTINGS["DOCKER_CONTEXT"])
        self.assertFalse(self.directory.exists())
        self.assertEqual([], self.operations())

    def test_xdg_standard_default_is_used_when_unset_or_empty(self):
        for index, value in enumerate((None, "")):
            home = self.root / ("user-" + str(index))
            with patch.dict(os.environ, self.environment | SETTINGS), patch.object(creator.Path, "home", return_value=home):
                if value is None:
                    del os.environ["XDG_CONFIG_HOME"]
                else:
                    os.environ["XDG_CONFIG_HOME"] = value
                creator.create(SETTINGS["DOCKER_CONTEXT"])
            self.assertTrue((home / ".config/systemd/user" / creator.SERVICE).is_file())

    def test_native_management_commands_need_no_context_or_docker(self):
        commands = {
            "viewer/update/timer/enable-and-start": ["systemctl", "--user", "enable", "--now", "cam-viewer-update.timer"],
            "viewer/update/timer/disable-and-stop": ["systemctl", "--user", "disable", "--now", "cam-viewer-update.timer"],
            "viewer/update/service/logs/recent": ["journalctl", "--user", "-u", "cam-viewer-update.service", "-n", "100", "--no-pager"],
        }
        for target, expected in commands.items():
            with self.subTest(target=target):
                result = self.make(target)
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual(expected, self.operations()[-1])
        result = self.make("viewer/update/timer/status")
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn("ActiveState=inactive", result.stdout)
        self.assertEqual(3, len(self.operations()[-3:]))
        self.assertTrue(any("list-timers" in operation for operation in self.operations()))
        self.assertFalse(self.trace.exists())

    def test_mixed_goals_still_select_docker_before_systemd_effects(self):
        result = self.make("viewer/update/timer/status", "viewer/status", "DOCKER_CONTEXT=missing")
        self.assertNotEqual(0, result.returncode)
        self.assertTrue(self.trace.exists())
        self.assertEqual([], self.operations())
