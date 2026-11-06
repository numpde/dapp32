from __future__ import annotations

import os
import errno
import fcntl
import pty
import select
import signal
import time
from pathlib import Path
import subprocess
import tempfile
import termios
import unittest

from .common import ROOT


SELECTOR = ROOT / "tools/docker_context.sh"
FAKE_DOCKER = ROOT / "tests/fixtures/docker-context"


class DockerContextSelectionTest(unittest.TestCase):
    # silent-defaults: allow-default -- The selector fixture uses a local synthetic socket unless a test supplies one.
    def run_selector(self, arguments: list[str], endpoint: str = "unix:///tmp/selected.sock", mode: str = ""):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trace = root / "trace"
            environment = os.environ | {
                "PATH": f"{FAKE_DOCKER}:{os.environ['PATH']}", "TRACE": str(trace), "ENDPOINT": endpoint,
                "DOCKER_HOST": "tcp://ambient", "DOCKER_CONTEXT": "ambient",
                "DOCKER_TLS": "1", "DOCKER_TLS_VERIFY": "1", "DOCKER_CERT_PATH": "/ambient", "FAKE_MODE": mode,
            }
            result = subprocess.run(["bash", str(SELECTOR), *arguments], env=environment,
                                    capture_output=True, text=True, timeout=15, stdin=subprocess.DEVNULL,
                                    start_new_session=True)
            return result, trace.read_text() if trace.exists() else ""

    def test_explicit_context_resolves_once_without_ambient_engine_overrides(self):
        result, trace = self.run_selector(["command line", "chosen", "undefined", "", "0"])
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("unix:///tmp/selected.sock\n", result.stdout)
        self.assertEqual("unset|unset|unset|unset|unset\n", trace)

    def test_fake_engine_rejects_unexpected_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            environment = os.environ | {"TRACE": str(Path(directory) / "trace"), "ENDPOINT": "unix:///tmp/selected.sock"}
            result = subprocess.run([str(FAKE_DOCKER / "docker"), "--host", environment["ENDPOINT"], "rm", "container"],
                                    env=environment, capture_output=True, text=True, timeout=5)
            self.assertNotEqual(0, result.returncode)

    def test_unix_endpoint_is_reused_for_recursive_make_without_another_lookup(self):
        result, trace = self.run_selector(["command line", "", "command line", "unix:///tmp/first.sock", "1"])
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertEqual("unix:///tmp/first.sock\n", result.stdout)
        self.assertEqual("", trace)

    def test_rejects_competing_explicit_context_and_recursive_endpoint(self):
        result, trace = self.run_selector(["command line", "different", "command line", "unix:///tmp/first.sock", "1"])
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("", trace)

    def test_rejects_invalid_contexts_and_endpoints(self):
        for name, endpoint in (("", "unix:///tmp/ok"), ("--host", "unix:///tmp/ok"),
                               ("chosen", "tcp://remote:2375"), ("chosen", "unix:///"),
                               ("chosen", "unix:///tmp/socket?option"), ("chosen", "unix:///tmp/a\nother"),
                               ("chosen", "NUL_CASE")):
            with self.subTest(name=name, endpoint=endpoint):
                result, _ = self.run_selector(["command line", name, "undefined", "", "0"], endpoint)
                self.assertNotEqual(0, result.returncode)
                self.assertEqual("", result.stdout)

    def test_invalid_name_does_not_echo_terminal_control_characters(self):
        result, _ = self.run_selector(["command line", "bad\x1bname", "undefined", "", "0"])
        self.assertNotEqual(0, result.returncode)
        self.assertNotIn("\x1b", result.stderr)

    def test_missing_context_and_hung_inspection_fail(self):
        for name, mode in (("missing", ""), ("chosen", "hang")):
            with self.subTest(name=name, mode=mode):
                result, _ = self.run_selector(["command line", name, "undefined", "", "0"], mode=mode)
                self.assertNotEqual(0, result.returncode)
                self.assertEqual("", result.stdout)

    def run_interactive(self, mode: str, answer: bytes):
        with tempfile.TemporaryDirectory() as directory:
            environment = os.environ | {
                "PATH": f"{FAKE_DOCKER}:{os.environ['PATH']}", "TRACE": str(Path(directory) / "trace"),
                "FAKE_MODE": mode, "ENDPOINT": "unix:///tmp/not-selected.sock",
            }
            master, slave = os.openpty()
            def terminal_session():
                os.setsid()
                fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
            process = None
            try:
                process = subprocess.Popen(["bash", str(SELECTOR), "undefined", "", "undefined", "", "0"],
                                           stdin=slave, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           env=environment, text=True, preexec_fn=terminal_session)
                os.write(master, answer)
                stdout, stderr = process.communicate(timeout=5)
                trace = (Path(directory) / "trace").read_text().splitlines()
                return process.returncode, stdout, stderr, trace
            finally:
                if process is not None and process.poll() is None:
                    process.kill()
                    process.wait()
                os.close(master)
                os.close(slave)

    def test_interactive_selection_uses_the_listed_endpoint(self):
        code, stdout, stderr, trace = self.run_interactive("", b"2\n")
        self.assertEqual(0, code, stderr)
        self.assertEqual("unix:///tmp/second.sock\n", stdout)
        self.assertEqual(1, len(trace), "selection must not resolve the context again")

    def test_interactive_selection_rejects_invalid_metadata_and_cancellation(self):
        for mode, answer in (("listing_failure", b"1\n"), ("listing_nul", b"1\n"),
                             ("listing_empty", b"1\n"), ("listing_duplicate", b"1\n"),
                             ("", b"0\n"), ("", b"\x04")):
            with self.subTest(mode=mode, answer=answer):
                code, stdout, _, _ = self.run_interactive(mode, answer)
                self.assertNotEqual(0, code)
                self.assertEqual("", stdout)

    def test_rejects_invalid_recursive_endpoint_before_lookup(self):
        result, trace = self.run_selector(["undefined", "", "command line", "tcp://remote:2375", "1"])
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("", trace)

    def test_ambient_endpoint_does_not_select_an_engine_without_a_terminal(self):
        result, trace = self.run_selector(["environment", "ambient", "environment", "unix:///tmp/ambient.sock", "0"])
        self.assertNotEqual(0, result.returncode)
        self.assertEqual("", trace)
        self.assertIn("DOCKER_CONTEXT=<local-context>", result.stderr)

    def test_make_pins_endpoint_through_flag_scrubbing_and_recursive_make(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trace = root / "trace"
            calls = root / "calls"
            builder_calls = root / "builder-calls"
            makefile = root / "Makefile"
            injected_shell = root / "bash-env"
            injected_shell.write_text('printf shell-started > "$SHELL_SENTINEL"\ndocker() { printf "hijacked\\n"; }; export -f docker\n')
            makefile.write_text(f'''include {ROOT / "Makefile"}
.PHONY: context-fixture context-child
context-fixture:
\t@docker --host "$$CAM_DOCKER_ENDPOINT" info
\t@timeout 3 docker --host "$$CAM_DOCKER_ENDPOINT" info
\t@env -u MAKEFLAGS -u MAKEOVERRIDES -u MFLAGS $(MAKE) --no-print-directory -f {makefile} context-child $(DOCKER_FORWARD)
context-child:
\t@docker --host "$$CAM_DOCKER_ENDPOINT" info
''')
            environment = {key: value for key, value in os.environ.items()
                           if key not in ("MAKEFLAGS", "MAKEOVERRIDES", "MFLAGS", "GNUMAKEFLAGS", "MAKELEVEL")}
            environment.update({"PATH": f"{FAKE_DOCKER}:{os.environ['PATH']}", "TRACE": str(trace),
                                "DOCKER_CALLS": str(calls), "ENDPOINT": "unix:///tmp/first.sock",
                                "BUILDER_CALLS": str(builder_calls), "BUILDX_BUILDER": "science", "BUILDX_CONFIG": "/ambient", "COMPOSE_BAKE": "true",
                                "DOCKER_HOST": "tcp://ambient", "DOCKER_CONTEXT": "ambient",
                                "DOCKER_TLS": "1", "DOCKER_TLS_VERIFY": "1", "DOCKER_CERT_PATH": "/ambient",
                                "BASH_ENV": str(injected_shell), "SHELL_SENTINEL": str(root / "shell-started"),
                                "BASH_FUNC_docker%%": "() { printf hijacked; }",
                                "BASH_FUNC_timeout%%": "() { printf hijacked; }",
                                "BASH_FUNC_env%%": "() { printf hijacked; }"})
            result = subprocess.run(["make", "--no-print-directory", "-f", str(makefile), "context-fixture",
                                     "DOCKER_CONTEXT=chosen"], cwd=ROOT, env=environment,
                                    capture_output=True, text=True, timeout=15, start_new_session=True)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertFalse((root / "shell-started").exists())
            self.assertEqual(["info", "info", "info"], calls.read_text().splitlines())
            self.assertEqual(["default|unset|unset"] * 3, builder_calls.read_text().splitlines())
            observations = trace.read_text().splitlines()
            self.assertEqual("unset|unset|unset|unset|unset", observations[0])
            self.assertEqual(["unix:///tmp/first.sock|unset|unset|unset|unset"] * 3, observations[1:])

    def test_make_rejects_ambient_goal_list_and_explicit_endpoint_overrides(self):
        for assignment in ("MAKECMDGOALS=help", "DOCKER_HOST=tcp://other", "DOCKER_COMPOSE=other", "BUILDX_BUILDER=other"):
            with self.subTest(assignment=assignment):
                result = subprocess.run(["make", "--no-print-directory", "tests/checks", assignment],
                                        cwd=ROOT, capture_output=True, text=True, timeout=5,
                                        start_new_session=True)
                self.assertNotEqual(0, result.returncode)
                self.assertIn("reserved" if assignment.startswith("MAKECMDGOALS") else "Select the Docker engine", result.stderr)

    def test_make_rejects_environment_goal_list_override(self):
        environment = os.environ | {"MAKECMDGOALS": "help"}
        result = subprocess.run(["make", "--no-print-directory", "tests/checks"], cwd=ROOT,
                                env=environment, capture_output=True, text=True, timeout=5, start_new_session=True)
        self.assertNotEqual(0, result.returncode)
        self.assertIn("MAKECMDGOALS is reserved", result.stderr)

    def test_make_query_and_dry_run_are_passive_across_goal_families(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = Path(directory) / "docker-inspections"
            env = {key: value for key, value in os.environ.items()
                   if key not in ("MAKEFLAGS", "MAKEOVERRIDES", "MFLAGS", "GNUMAKEFLAGS",
                                  "MAKELEVEL", "DOCKER_CONTEXT_INPUT", "CAM_DOCKER_ENDPOINT")}
            env.update({"PATH": f"{FAKE_DOCKER}:{os.environ['PATH']}",
                        "TRACE": str(trace), "ENDPOINT": "unix:///tmp/selected.sock"})
            for options in (
                ("-qp", "tests/live/release-identity"),
                ("--dry-run", "tests/live/release-identity"),
                ("--question", "tests/live/release-identity"),
                ("-qp", "tests/live"),
                ("--dry-run", "tests/checks"),
                ("-qp", "pay-to-play/release/source/publish"),
                ("-rR", "-qp", "help"),
            ):
                with self.subTest(options=options):
                    trace.unlink(missing_ok=True)
                    result = subprocess.run(
                        ["make", "--no-print-directory", *options],
                        cwd=ROOT, env=env, stdin=subprocess.DEVNULL, start_new_session=True,
                        capture_output=True, text=True, timeout=10,
                    )
                    self.assertIn(result.returncode, (0, 1), result.stderr)
                    self.assertNotIn("Docker context selection failed", result.stderr)
                    self.assertFalse(trace.exists(), "Make inspection contacted Docker")

    def test_make_completion_with_a_terminal_does_not_open_context_menu(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = Path(directory) / "docker-inspections"
            env = {key: value for key, value in os.environ.items()
                   if key not in ("MAKEFLAGS", "MAKEOVERRIDES", "MFLAGS", "GNUMAKEFLAGS",
                                  "MAKELEVEL", "DOCKER_CONTEXT_INPUT", "CAM_DOCKER_ENDPOINT")}
            env.update({"PATH": f"{FAKE_DOCKER}:{os.environ['PATH']}",
                        "TRACE": str(trace), "ENDPOINT": "unix:///tmp/selected.sock"})
            pid, terminal = pty.fork()
            if pid == 0:
                os.chdir(ROOT)
                os.execvpe("make", ["make", "--no-print-directory", "-qp",
                                    "tests/live/release-identity"], env)
            observed = bytearray()
            status = None
            terminal_closed = False
            deadline = time.monotonic() + 6
            try:
                while time.monotonic() < deadline:
                    if not terminal_closed and select.select([terminal], [], [], 0.1)[0]:
                        try:
                            observed.extend(os.read(terminal, 65536))
                        except OSError as error:
                            if error.errno != errno.EIO:
                                raise
                            # Linux PTY EOF is EIO. Keep reaping the child without
                            # polling this closed master again.
                            terminal_closed = True
                    finished, value = os.waitpid(pid, os.WNOHANG)
                    if finished:
                        status = value
                        break
                if status is None:
                    os.killpg(pid, signal.SIGKILL)
                    os.waitpid(pid, 0)
            finally:
                os.close(terminal)
            self.assertIsNotNone(status, "Completion query blocked waiting for Docker context input")
            self.assertTrue(os.WIFEXITED(status), observed[-1024:].decode(errors="replace"))
            self.assertNotIn(b"Select a local Docker context (no default)", observed)
            self.assertNotIn(b"Choice [", observed)
            self.assertFalse(trace.exists(), "Completion query inspected Docker")

    def test_command_line_makeflags_cannot_forge_nonexecuting_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            trace = Path(directory) / "docker-inspections"
            env = {key: value for key, value in os.environ.items()
                   if key not in ("MAKEFLAGS", "MAKEOVERRIDES", "MFLAGS", "GNUMAKEFLAGS",
                                  "MAKELEVEL", "DOCKER_CONTEXT_INPUT", "CAM_DOCKER_ENDPOINT")}
            env.update({"PATH": f"{FAKE_DOCKER}:{os.environ['PATH']}",
                        "TRACE": str(trace), "ENDPOINT": "unix:///tmp/selected.sock"})
            command = ["make", "--no-print-directory", "tests/live/release-identity",
                       "MAKEFLAGS=notification", "DOCKER_CONTEXT=chosen"]
            result = subprocess.run(command, cwd=ROOT, env=env, stdin=subprocess.DEVNULL,
                                    start_new_session=True, capture_output=True, text=True,
                                    timeout=10)
            self.assertNotEqual(0, result.returncode)
            self.assertIn("MAKEFLAGS is reserved", result.stderr)
            self.assertFalse(trace.exists())

    def test_recursive_dry_run_never_inherits_a_usable_default_engine(self):
        # GNU Make executes an entire recipe line containing $(MAKE), even -n.
        # A dry run must poison Docker's endpoint rather than falling back to
        # the host default if such a recipe invokes docker before the submake.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            trace = root / "docker-inspections"
            source = root / "recursive.mk"
            source.write_text(
                f"include {ROOT / 'Makefile'}\n"
                ".PHONY: recursive-probe recursive-child\n"
                "recursive-probe:\n"
                f"\t@docker info; $(MAKE) --no-print-directory -f {source} recursive-child\n"
                "recursive-child:\n"
                "\t@echo child\n"
            )
            env = {key: value for key, value in os.environ.items()
                   if key not in ("MAKEFLAGS", "MAKEOVERRIDES", "MFLAGS", "GNUMAKEFLAGS",
                                  "MAKELEVEL", "DOCKER_CONTEXT_INPUT", "CAM_DOCKER_ENDPOINT")}
            env.update({"PATH": f"{FAKE_DOCKER}:{os.environ['PATH']}",
                        "TRACE": str(trace), "ENDPOINT": "unix:///tmp/selected.sock"})
            result = subprocess.run(
                ["make", "--no-print-directory", "-n", "-f", str(source), "recursive-probe"],
                cwd=ROOT, env=env, stdin=subprocess.DEVNULL, start_new_session=True,
                capture_output=True, text=True, timeout=10,
            )
            # GNU Make executes recursive recipe lines even under -n. The fake
            # Docker command must fail closed rather than report a successful
            # dry-run operation against an unspecified daemon.
            self.assertEqual(2, result.returncode, result.stderr)
            self.assertIn(
                "unix:///dev/null|",
                trace.read_text(),
                "Make's recursive -n exception must never fall back to a real Docker endpoint",
            )

    def test_empty_private_docker_config_resolves_default_to_the_fixture_engine(self):
        with tempfile.TemporaryDirectory() as directory:
            environment = os.environ | {"DOCKER_CONFIG": directory, "DOCKER_HOST": "tcp://wrong:2375",
                                        "DOCKER_CONTEXT": "wrong", "DOCKER_TLS_VERIFY": "1"}
            result = subprocess.run(["bash", str(SELECTOR), "command line", "default", "undefined", "", "0"],
                                    env=environment, capture_output=True, text=True, timeout=15,
                                    start_new_session=True)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual("unix:///var/run/docker.sock\n", result.stdout)
