from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from .common import repo_path


class RpcIndexerLaneTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.checkout = self.directory / "checkout"
        self.checkout.mkdir()
        shutil.copyfile(repo_path("Makefile"), self.checkout / "Makefile")
        for name in ("compose", "containers", "dapps", "docs", "js", "tests", "tools"):
            (self.checkout / name).mkdir()
        for name in ("release_process.sh", "release-config.sh", "docker_context.sh"):
            shutil.copyfile(repo_path(f"tools/{name}"), self.checkout / "tools" / name)
        self.upstream = self.directory / "rpc-url"
        self.upstream.write_text("https://example.com/private?token=fixture-secret\n")
        self.upstream.chmod(0o600)
        self.calls = self.directory / "compose-calls"
        self.stub = self.directory / "compose-stub.sh"
        self.stub.write_text(
            'printf "%s\\n" "$@" > "$COMPOSE_CALLS"\n'
            'printf "project=%s\\nuid=%s\\ngid=%s\\ninput=%s\\nuri=%s\\norigin=%s\\nresource_origin=%s\\n" "$COMPOSE_PROJECT_NAME" "$LOCAL_UID" "$LOCAL_GID" "${RPC_URL_FILE-}" "${CAM_URI-}" "${BIKE_NFT_GUI_ORIGIN-}" "${CAM_VIEWER_RESOURCE_ORIGIN-}" >> "$COMPOSE_CALLS"\n'
        )

    def make(self, target: str, upstream: Path | str | None = None, *, overrides: tuple[str, ...] | None = None, extra_environment: dict[str, str] | None = None, environment_override: bool | None = None) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        for name in ("MAKEFLAGS", "MFLAGS", "MAKEOVERRIDES", "RPC_URL_FILE", "RPC_URL"):
            if name in environment:
                del environment[name]
        environment.update({
            "LOCAL_UID": str(os.getuid()),
            "LOCAL_GID": str(os.getgid()),
            "COMPOSE_PROJECT_NAME": "rpc-lane-check",
            "RPC_INDEXER_COMPOSE_PROJECT_NAME": "rpc-base-sepolia",
            "COMPOSE_CALLS": str(self.calls),
            "PATH": f"{repo_path('tests/fixtures/docker-context')}:{os.environ['PATH']}",
            "TRACE": os.devnull, "ENDPOINT": "unix:///tmp/context-fixture.sock", "FAKE_MODE": "",
            "DOCKER_DELEGATE": str(self.stub),
        })
        if overrides is None:
            overrides = ()
        if upstream is not None:
            environment["RPC_URL_FILE"] = str(upstream)
        if extra_environment is not None:
            environment.update(extra_environment)
        return subprocess.run(
            ["make", "--no-print-directory", "-s", *(["-e"] if environment_override else []), target, "DOCKER_CONTEXT=fixture", *overrides],
            cwd=self.checkout,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
            timeout=20,
        )

    def prepare_cam_outputs(self) -> None:
        reference = self.checkout / "docs/reference/cam/1.4.0/index.html"
        reference.parent.mkdir(parents=True, exist_ok=True)
        reference.touch()
        for app in ("bike-nft", "escrow", "pay-to-play"):
            path = self.checkout / "dapps" / app / "cam"
            path.mkdir(parents=True, exist_ok=True)
            for name in ("main.json", "protocol.html"):
                (path / name).touch()

    def test_integrity_identity_tracks_the_selected_engine(self) -> None:
        self.prepare_cam_outputs()
        events = self.directory / "engine-events"
        for engine in ("rootful", "rootless", "unavailable", "malformed", "nul", "empty", "oversized"):
            with self.subTest(engine=engine):
                self.calls.unlink(missing_ok=True)
                identity = (f"LOCAL_UID={os.getuid()}", f"LOCAL_GID={os.getgid()}") if engine == "rootless" else ("LOCAL_UID=1234", "LOCAL_GID=1235")
                result = self.make("cam/integrity/refresh", overrides=identity, extra_environment={"TEST_ENGINE": engine, "TEST_EVENTS": str(events)})
                if engine in ("unavailable", "malformed", "nul", "empty", "oversized"):
                    self.assertNotEqual(0, result.returncode)
                    self.assertFalse(self.calls.exists())
                    continue
                self.assertEqual(0, result.returncode, result.stderr)
                actual = self.calls.read_text().splitlines()
                self.assertIn("0:0" if engine == "rootless" else "1234:1235", actual)
                self.assertEqual(engine == "rootless", "--require-owned-outputs" in actual)
                self.assertEqual(engine == "rootless", "namespace UID 0" in result.stderr)
        for identity in ((f"LOCAL_UID={os.getuid() + 1}", f"LOCAL_GID={os.getgid()}"), (f"LOCAL_UID={os.getuid()}", f"LOCAL_GID={os.getgid() + 1}")):
            with self.subTest(mismatched_identity=identity):
                self.calls.unlink(missing_ok=True)
                result = self.make("cam/integrity/refresh", overrides=identity, extra_environment={"TEST_ENGINE": "rootless", "TEST_EVENTS": str(events)})
                self.assertNotEqual(0, result.returncode)
                self.assertFalse(self.calls.exists())
        result = self.make("cam/integrity/refresh", overrides=("COMPOSE_DIR=/tmp/wrong", "CAM_COMPOSE_FILES=-f /tmp/wrong.yml"), extra_environment={"TEST_ENGINE": "rootless", "TEST_EVENTS": str(events)})
        self.assertEqual(0, result.returncode, result.stderr)
        actual = self.calls.read_text().splitlines()
        self.assertIn("compose/cam.yml", actual)
        self.assertNotIn("/tmp/wrong.yml", actual)

    def test_stalled_engine_probe_times_out_and_removes_its_temporary_file(self) -> None:
        self.prepare_cam_outputs()
        temporary = self.directory / "probe-tmp"
        temporary.mkdir()
        result = self.make("cam/integrity/refresh", extra_environment={"TEST_ENGINE": "stalled", "TEST_EVENTS": str(self.directory / "events"), "TMPDIR": str(temporary)})
        self.assertNotEqual(0, result.returncode)
        self.assertIn("Cannot inspect the selected Docker engine security posture", result.stderr)
        self.assertFalse(self.calls.exists())
        self.assertEqual([], list(temporary.iterdir()))

    def test_missing_cam_output_cannot_bypass_preflight(self) -> None:
        self.prepare_cam_outputs()
        (self.checkout / "dapps/bike-nft/cam/main.json").unlink()
        events = self.directory / "engine-events"
        result = self.make("cam/integrity/refresh", overrides=("CAM_RESOURCE_OUTPUT_GUARD=: ",), extra_environment={"TEST_ENGINE": "rootless", "TEST_EVENTS": str(events)})
        self.assertNotEqual(0, result.returncode)
        self.assertFalse(self.calls.exists())
        self.assertFalse(events.exists())

    def test_compose_receives_guarded_identity_despite_internal_overrides(self) -> None:
        self.prepare_cam_outputs()
        events = self.directory / "engine-events"
        poison = "LOCAL_UID=0 LOCAL_GID=0 COMPOSE_PROJECT_NAME=wrong"
        for source in ("command", "environment", "environment-e"):
            with self.subTest(source=source):
                self.calls.unlink(missing_ok=True)
                result = self.make("cam/integrity/refresh", overrides=("LOCAL_UID=1234", "LOCAL_GID=1235", *((f"COMPOSE_ENV={poison}",) if source == "command" else ())), extra_environment={"TEST_ENGINE": "rootful", "TEST_EVENTS": str(events), **({"COMPOSE_ENV": poison} if source != "command" else {})}, environment_override=source == "environment-e")
                self.assertEqual(0, result.returncode, result.stderr)
                actual = self.calls.read_text().splitlines()
                self.assertIn("project=rpc-lane-check", actual)
                self.assertIn("uid=1234", actual)
                self.assertIn("gid=1235", actual)

    def test_lane_bundle_cannot_override_guarded_project_or_identity(self) -> None:
        poison = "LOCAL_UID=0 LOCAL_GID=0 COMPOSE_PROJECT_NAME=wrong"
        for source in ("command", "environment", "environment-e"):
            with self.subTest(source=source):
                self.calls.unlink(missing_ok=True)
                result = self.make("rpc/indexer/logs", overrides=(f"RPC_INDEXER_COMPOSE_ENV={poison}",) if source == "command" else (), extra_environment={"RPC_INDEXER_COMPOSE_ENV": poison} if source != "command" else None, environment_override=source == "environment-e")
                self.assertEqual(0, result.returncode, result.stderr)
                actual = self.calls.read_text().splitlines()
                self.assertIn("project=rpc-base-sepolia", actual)
                self.assertIn(f"uid={os.getuid()}", actual)
                self.assertIn(f"gid={os.getgid()}", actual)

    def test_lane_uri_reaches_compose_as_one_literal_value(self) -> None:
        (self.checkout / "probe.mk").write_text(
            "probe:\n\t@$(LANE_GUARD); $(CAM_URI_GUARD); $(BIKE_NFT_LOCAL_COMPOSE_ENV) $(DOCKER_COMPOSE) config\n"
        )
        uri = "https://example.test/path?a=1&b=2"
        result = self.make("probe", overrides=("-f", "Makefile", "-f", "probe.mk", f"CAM_URI={uri}"))
        self.assertEqual(0, result.returncode, result.stderr)
        self.assertIn(f"uri={uri}", self.calls.read_text().splitlines())
        self.assertIn("project=rpc-lane-check-bike-nft-local", self.calls.read_text().splitlines())

    def test_gui_origin_reaches_compose_as_one_literal_value(self) -> None:
        (self.checkout / "probe.mk").write_text(
            "probe:\n\t@$(LANE_GUARD); $(BIKE_NFT_GUI_BIND_GUARD); $(BIKE_NFT_VIEWER_GUI_COMPOSE_ENV) $(DOCKER_COMPOSE) config\n"
        )
        origin = "http://example&fixture.test:5173"
        result = self.make("probe", overrides=("-f", "Makefile", "-f", "probe.mk", f"BIKE_NFT_GUI_ORIGIN={origin}"))
        self.assertEqual(0, result.returncode, result.stderr)
        actual = self.calls.read_text().splitlines()
        self.assertIn(f"origin={origin}", actual)
        self.assertIn(f"resource_origin={origin}", actual)
        self.assertIn(f"uri={origin}/cam/main.json", actual)
        self.assertIn("project=rpc-lane-check-bike-nft-viewer-gui", actual)

    def test_start_and_shutdown_use_the_same_validated_project(self) -> None:
        poison = "LOCAL_UID=0 LOCAL_GID=0 COMPOSE_PROJECT_NAME=wrong"
        for target in ("rpc/indexer/up", "rpc/indexer/down"):
            with self.subTest(target=target):
                self.calls.unlink(missing_ok=True)
                result = self.make(target, self.upstream, overrides=(f"RPC_INDEXER_COMPOSE_ENV={poison}",))
                self.assertEqual(0, result.returncode, result.stderr)
                actual = self.calls.read_text().splitlines()
                self.assertIn("project=rpc-base-sepolia", actual)
                self.assertIn(f"uid={os.getuid()}", actual)
                self.assertIn(f"gid={os.getgid()}", actual)
                self.assertIn(target.rsplit("/", 1)[1], actual)

    def test_invalid_identity_cannot_bypass_guard_with_internal_overrides(self) -> None:
        result = self.make("rpc/indexer/logs", overrides=("LOCAL_UID=0", "LANE_GUARD=:", "NON_ROOT_GUARD=:", "ACTUAL_UID=1000"))
        self.assertNotEqual(0, result.returncode)
        self.assertFalse(self.calls.exists())

    def test_external_make_expression_is_rejected_before_it_runs(self) -> None:
        for name in ("LOCAL_UID", "COMPOSE_PROJECT_NAME", "RPC_INDEXER_COMPOSE_PROJECT_NAME", "ALLOW_UPDATE", "COMPOSE_ENV", "RPC_INDEXER_COMPOSE_ENV", "LANE_GUARD"):
            for as_environment in (False, True):
                with self.subTest(name=name, as_environment=as_environment):
                    marker = self.directory / "expression-ran"
                    marker.unlink(missing_ok=True)
                    expression = f"$(shell touch {marker})"
                    result = self.make("rpc/indexer/logs", overrides=() if as_environment else (f"{name}={expression}",), extra_environment={name: expression} if as_environment else None, environment_override=as_environment)
                    self.assertNotEqual(0, result.returncode)
                    self.assertFalse(marker.exists())
                    self.assertFalse(self.calls.exists())

    def test_start_uses_protected_file_without_printing_its_contents(self) -> None:
        result = self.make("rpc/indexer/up", self.upstream)
        self.assertEqual(0, result.returncode, result.stderr)
        arguments = self.calls.read_text().splitlines()
        self.assertIn("up", arguments)
        self.assertIn("--wait", arguments)
        self.assertIn("rpc-proxy", arguments)
        self.assertIn("project=rpc-base-sepolia", arguments)
        self.assertIn(f"input={self.upstream}", arguments)
        self.assertIn("rpc-base-sepolia_rpc_internal", result.stdout)
        self.assertIn("http://rpc-base-sepolia-rpc:8080", result.stdout)
        self.assertNotIn("fixture-secret", result.stdout + result.stderr + self.calls.read_text())

    def test_unsafe_upstream_paths_fail_before_compose(self) -> None:
        public_file = self.directory / "public-url"
        shutil.copyfile(self.upstream, public_file)
        public_file.chmod(0o644)
        in_checkout = self.checkout / "rpc-url"
        shutil.copyfile(self.upstream, in_checkout)
        in_checkout.chmod(0o600)
        linked_directory = self.directory / "linked"
        linked_directory.symlink_to(self.directory, target_is_directory=True)
        cases = (
            (None, "Set RPC_URL_FILE"),
            ("rpc-url", "must be an absolute path"),
            (public_file, "must not be group- or world-accessible"),
            (in_checkout, "must be outside the repository"),
            (self.directory, "must be a readable regular file"),
            (linked_directory / "rpc-url", "must not pass through a symlink"),
            (self.directory / "missing", "must be a readable regular file"),
            (f"{self.directory}/checkout/../rpc-url", "must be a normalized absolute path"),
        )
        for path, reason in cases:
            with self.subTest(path=path):
                result = self.make("rpc/indexer/up", path)
                self.assertNotEqual(0, result.returncode)
                self.assertIn(reason, result.stderr)
                self.assertFalse(self.calls.exists(), result.stdout + result.stderr)
                self.assertNotIn("fixture-secret", result.stdout + result.stderr)

    def test_logs_and_shutdown_do_not_need_the_upstream_file(self) -> None:
        self.upstream.unlink()
        for target in ("rpc/indexer/logs", "rpc/indexer/down"):
            with self.subTest(target=target):
                result = self.make(target)
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertIn("input=/dev/null", self.calls.read_text())
                self.assertIn(target.rsplit("/", 1)[1], self.calls.read_text().splitlines())


if __name__ == "__main__":
    unittest.main()
