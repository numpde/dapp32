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
        self.upstream = self.directory / "rpc-url"
        self.upstream.write_text("https://example.com/private?token=fixture-secret\n")
        self.upstream.chmod(0o600)
        self.calls = self.directory / "compose-calls"
        self.stub = self.directory / "compose-stub.sh"
        self.stub.write_text(
            'printf "%s\\n" "$@" > "$COMPOSE_CALLS"\n'
            'printf "project=%s\\ninput=%s\\n" "$COMPOSE_PROJECT_NAME" "$RPC_URL_FILE" >> "$COMPOSE_CALLS"\n'
        )

    def make(self, target: str, upstream: Path | str | None = None) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        for name in ("MAKEFLAGS", "MFLAGS", "MAKEOVERRIDES", "RPC_URL_FILE", "RPC_URL"):
            environment.pop(name, None)
        environment.update({
            "LOCAL_UID": str(os.getuid()),
            "LOCAL_GID": str(os.getgid()),
            "COMPOSE_PROJECT_NAME": "rpc-lane-check",
            "RPC_INDEXER_COMPOSE_PROJECT_NAME": "rpc-base-sepolia",
            "COMPOSE_CALLS": str(self.calls),
        })
        if upstream is not None:
            environment["RPC_URL_FILE"] = str(upstream)
        return subprocess.run(
            ["make", "--no-print-directory", "-s", target, f"DOCKER_COMPOSE=bash {self.stub}"],
            cwd=self.checkout,
            env=environment,
            text=True,
            capture_output=True,
            check=False,
            timeout=10,
        )

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
        cases = (None, "rpc-url", public_file, in_checkout, self.directory,
                 linked_directory / "rpc-url", self.directory / "missing",
                 f"{self.directory}/checkout/../rpc-url")
        for path in cases:
            with self.subTest(path=path):
                result = self.make("rpc/indexer/up", path)
                self.assertNotEqual(0, result.returncode)
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
