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
        for name in ("release_process.sh", "release-config.sh", "docker_context.sh", "compose_cleanup.sh"):
            shutil.copyfile(repo_path(f"tools/{name}"), self.checkout / "tools" / name)
        (self.checkout / "tools/release_identity.sh").write_text("""# Focused Make/Compose fixture: mapping outcome is supplied by the test.
# Observation and retirement belong to the shared linux-idmap suite.
release_select_container_identity() {
  case "${TEST_ENGINE-}" in
    rootless) RELEASE_CONTAINER_UID=0; RELEASE_CONTAINER_GID=0 ;;
    rootful) RELEASE_CONTAINER_UID="$LOCAL_UID"; RELEASE_CONTAINER_GID="$LOCAL_GID" ;;
    *)
      printf '%s\\\\n' 'Cannot resolve the selected Docker engine owner mapping.' >&2
      return 2 ;;
  esac
  export RELEASE_CONTAINER_UID RELEASE_CONTAINER_GID
}
""")
        self.upstream = self.directory / "rpc-url"
        self.upstream.write_text("https://example.com/private?token=fixture-secret\n")
        self.upstream.chmod(0o600)
        self.calls = self.directory / "compose-calls"
        self.history = self.directory / "compose-history"
        self.stub = self.directory / "compose-stub.sh"
        self.stub.write_text(
            'printf "%s\\n" "$@" > "$COMPOSE_CALLS"\n'
            'printf "%s\\n" "$*" >> "$COMPOSE_HISTORY"\n'
            'printf "project=%s\\nuid=%s\\ngid=%s\\ninput=%s\\nuri=%s\\norigin=%s\\nresource_origin=%s\\n" "$COMPOSE_PROJECT_NAME" "$LOCAL_UID" "$LOCAL_GID" "${RPC_URL_FILE-}" "${CAM_URI-}" "${BIKE_NFT_GUI_ORIGIN-}" "${CAM_VIEWER_RESOURCE_ORIGIN-}" >> "$COMPOSE_CALLS"\n'
            'if [[ ${TEST_FAIL_ABI_CHECK-} == 1 && ${*: -1} == forge-abi-check ]]; then exit 12; fi\n'
            'if [[ ${TEST_FAIL_BROWSER_CHECK-} == 1 && ${*: -1} == browser-ui-check ]]; then exit 12; fi\n'
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
            "COMPOSE_HISTORY": str(self.history),
            "PATH": f"{repo_path('tests/fixtures/docker-context')}:{os.environ['PATH']}",
            "TRACE": os.devnull, "ENDPOINT": "unix:///tmp/context-fixture.sock", "FAKE_MODE": "",
            "DOCKER_DELEGATE": str(self.stub),
            "TEST_ENGINE": "rootful",
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
        for engine in ("rootful", "rootless", "unavailable"):
            with self.subTest(engine=engine):
                self.calls.unlink(missing_ok=True)
                identity = (f"LOCAL_UID={os.getuid()}", f"LOCAL_GID={os.getgid()}")
                result = self.make("cam/integrity/refresh", overrides=identity, extra_environment={"TEST_ENGINE": engine, "TEST_EVENTS": str(events)})
                if engine == "unavailable":
                    self.assertNotEqual(0, result.returncode)
                    self.assertFalse(self.calls.exists())
                    continue
                self.assertEqual(0, result.returncode, result.stderr)
                actual = self.calls.read_text().splitlines()
                self.assertIn("0:0" if engine == "rootless" else f"{os.getuid()}:{os.getgid()}", actual)
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

    def test_unavailable_owner_mapping_does_not_run_compose_or_allocate_scratch(self) -> None:
        self.prepare_cam_outputs()
        temporary = self.directory / "probe-tmp"
        temporary.mkdir()
        result = self.make("cam/integrity/refresh", extra_environment={"TEST_ENGINE": "unavailable", "TEST_EVENTS": str(self.directory / "events"), "TMPDIR": str(temporary)})
        self.assertNotEqual(0, result.returncode)
        self.assertIn("Cannot resolve the selected Docker engine owner mapping", result.stderr)
        self.assertFalse(self.calls.exists())
        self.assertEqual([], list(temporary.iterdir()))

    def test_abi_export_uses_matching_engine_identity_for_both_stages(self) -> None:
        self.prepare_cam_outputs()
        for app in ("bike-nft", "escrow", "pay-to-play"):
            (self.checkout / "dapps" / app / "cam/abi").mkdir()
        events = self.directory / "engine-events"
        for engine in ("rootful", "rootless", "unavailable"):
            with self.subTest(engine=engine):
                self.history.unlink(missing_ok=True)
                result = self.make("cam/abi/export", overrides=("-o", "dapps/deps/verify"), extra_environment={"TEST_ENGINE": engine, "TEST_EVENTS": str(events)})
                if engine == "unavailable":
                    self.assertNotEqual(0, result.returncode)
                    self.assertFalse(self.history.exists())
                    continue
                self.assertEqual(0, result.returncode, result.stderr)
                commands = self.history.read_text().splitlines()
                identity = "0:0" if engine == "rootless" else f"{os.getuid()}:{os.getgid()}"
                for service in ("forge-abi-plan", "forge-abi"):
                    matches = [line for line in commands if line.endswith(f"--user {identity} {service}")]
                    self.assertEqual(1, len(matches), commands)
                cleanup = [line for line in commands if "--project-name rpc-lane-check-abi-export down" in line]
                self.assertEqual(1, len(cleanup), commands)
                self.assertIn("-f compose/forge-abi.yml -f compose/cam.yml", cleanup[0])
                self.assertTrue(cleanup[0].endswith("--rmi local"), cleanup[0])

    def test_abi_export_rejects_ids_that_cannot_access_the_private_plan(self) -> None:
        self.prepare_cam_outputs()
        result = self.make("cam/abi/export", overrides=("-o", "dapps/deps/verify", f"LOCAL_UID={os.getuid() + 1}"), extra_environment={"TEST_ENGINE": "rootful", "TEST_EVENTS": str(self.directory / "events")})
        self.assertNotEqual(0, result.returncode)
        self.assertIn("CAM outputs require the invoking host UID and GID", result.stderr)
        self.assertFalse(self.history.exists())

    def test_abi_check_uses_a_disposable_project(self) -> None:
        events = self.directory / "engine-events"
        result = self.make("cam/abi/check", overrides=("-o", "dapps/deps/verify"), extra_environment={"TEST_ENGINE": "rootless", "TEST_EVENTS": str(events)})
        self.assertEqual(0, result.returncode, result.stderr)
        commands = self.history.read_text().splitlines()
        self.assertTrue(any(line.endswith("--user 0:0 forge-abi-plan") for line in commands), commands)
        self.assertTrue(any(line.endswith("--user 0:0 forge-abi-check") for line in commands), commands)
        self.assertTrue(any("--project-name rpc-lane-check-cam-abi-check-" in line and " down " in line and line.endswith("--rmi local") for line in commands), commands)

    def test_failed_abi_check_still_cleans_up(self) -> None:
        events = self.directory / "engine-events"
        result = self.make("cam/abi/check", overrides=("-o", "dapps/deps/verify"), extra_environment={"TEST_ENGINE": "rootless", "TEST_EVENTS": str(events), "TEST_FAIL_ABI_CHECK": "1"})
        self.assertNotEqual(0, result.returncode)
        commands = self.history.read_text().splitlines()
        self.assertTrue(any("--project-name rpc-lane-check-cam-abi-check-" in line and " down " in line and line.endswith("--rmi local") for line in commands), commands)

    def test_browser_check_cleans_its_disposable_project(self) -> None:
        (self.checkout / "js/node_modules").mkdir()
        (self.checkout / "js/package-lock.json").touch()
        for fail in (False, True):
            with self.subTest(fail=fail):
                self.history.unlink(missing_ok=True)
                result = self.make("viewer/browser/check", extra_environment={"CDP_ORIGIN": "http://127.0.0.1:7777", "VIEWER_URL": "http://127.0.0.1:5174", "TEST_FAIL_BROWSER_CHECK": str(int(fail))})
                self.assertEqual(not fail, result.returncode == 0, result.stderr)
                commands = self.history.read_text().splitlines()
                run = next(line.split() for line in commands if line.endswith("-T browser-ui-check"))
                project = run[run.index("-p") + 1]
                self.assertTrue(project.startswith("rpc-lane-check-browser-check-"), project)
                self.assertTrue(any(f"--project-name {project} down" in line and line.endswith("--rmi local") for line in commands), commands)

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
                result = self.make("cam/integrity/refresh", overrides=(f"LOCAL_UID={os.getuid()}", f"LOCAL_GID={os.getgid()}", *((f"COMPOSE_ENV={poison}",) if source == "command" else ())), extra_environment={"TEST_ENGINE": "rootful", "TEST_EVENTS": str(events), **({"COMPOSE_ENV": poison} if source != "command" else {})}, environment_override=source == "environment-e")
                self.assertEqual(0, result.returncode, result.stderr)
                actual = self.calls.read_text().splitlines()
                self.assertIn("project=rpc-lane-check", actual)
                self.assertIn(f"uid={os.getuid()}", actual)
                self.assertIn(f"gid={os.getgid()}", actual)

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

    def test_indexer_private_upstream_uses_measured_engine_identity(self) -> None:
        for engine in ("rootless", "rootful", "unavailable"):
            with self.subTest(engine=engine):
                self.calls.unlink(missing_ok=True)
                result = self.make("rpc/indexer/up", self.upstream,
                                   extra_environment={"TEST_ENGINE": engine})
                if engine == "unavailable":
                    self.assertNotEqual(0, result.returncode)
                    self.assertFalse(self.calls.exists(), result.stderr)
                else:
                    self.assertEqual(0, result.returncode, result.stderr)
                    actual = self.calls.read_text().splitlines()
                    self.assertIn(f"uid={0 if engine == 'rootless' else os.getuid()}", actual)
                    self.assertIn(f"gid={0 if engine == 'rootless' else os.getgid()}", actual)

    def test_refund_plan_and_execution_map_operator_private_inputs(self) -> None:
        (self.checkout / "js/node_modules").mkdir()
        (self.checkout / "js/package-lock.json").write_text("{}")
        config = self.directory / "refund-config"
        config.write_text("{}")
        config.chmod(0o600)
        key = self.directory / "refund-key"
        key.write_text("fixture")
        key.chmod(0o600)
        state = self.directory / "refund-state"
        state.mkdir(mode=0o700)
        for engine in ("rootless", "rootful", "unavailable"):
            for operation in ("plan", "run"):
                with self.subTest(engine=engine, operation=operation):
                    self.calls.unlink(missing_ok=True)
                    result = self.make("pay-to-play/refunds/" + operation, self.upstream,
                        extra_environment={"TEST_ENGINE": engine,
                                           "REFUND_CONFIG_FILE": str(config),
                                           "REFUND_PRIVATE_KEY_FILE": str(key),
                                           "REFUND_STATE_DIR": str(state),
                                           "CONFIRM_PAY_TO_PLAY_REFUNDS": "YES"})
                    if engine == "unavailable":
                        self.assertNotEqual(0, result.returncode)
                        self.assertFalse(self.calls.exists(), result.stderr)
                    else:
                        self.assertEqual(0, result.returncode, result.stderr)
                        calls = self.calls.read_text().splitlines()
                        self.assertIn(f"uid={0 if engine == 'rootless' else os.getuid()}", calls)
                        self.assertIn(f"gid={0 if engine == 'rootless' else os.getgid()}", calls)
        self.assertEqual(0o700, state.stat().st_mode & 0o777)
        self.assertEqual(0o600, key.stat().st_mode & 0o777)
        self.assertEqual(os.getuid(), state.stat().st_uid)

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
