from __future__ import annotations

import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest

from .common import ROOT, compose_volume, rendered_compose_config


FAKE_DOCKER = r'''#!/usr/bin/env python3
import json
import os
from pathlib import Path
import stat
import sys

root = Path(os.environ["CASE_ROOT"])
args = sys.argv[1:]
assert args[:2] == ["--host", os.environ["CAM_DOCKER_ENDPOINT"]]
args = args[2:]
state_file = root / "state.json"
state = json.loads(state_file.read_text())
with (root / "calls.jsonl").open("a") as stream:
    stream.write(json.dumps({
        "args": args,
        "uid": os.environ.get("LOCAL_UID"),
        "gid": os.environ.get("LOCAL_GID"),
        "stage": os.environ.get("DOCS_STAGE_DIR"),
        "image_tag": os.environ.get("DOCS_IMAGE_TAG"),
    }) + "\n")

if args[0] == "compose":
    project_option = "-p" if "-p" in args else "--project-name"
    project = args[args.index(project_option) + 1]
    if "build" in args:
        assert state["project"] in (None, project)
        assert args[-1] == "docs-build"
        state["project"] = project
        state["phases"].append("image-build")
        state_file.write_text(json.dumps(state))
        if state["mode"] == "image-build-fail":
            print("fake image build failed", file=sys.stderr)
            sys.exit(21)
    elif "up" in args:
        assert state["project"] == project
        assert state["phases"] == ["image-build"]
        assert "--no-build" in args and "--no-deps" in args
        assert "-d" in args and "--wait" in args
        assert args[-1] == "docs-hold"
        state["volume"] = f"{project}_docs-artifact"
        state["phases"].append("hold-start")
        state_file.write_text(json.dumps(state))
        if state["mode"] == "holder-start-fail":
            print("fake holder startup failed", file=sys.stderr)
            sys.exit(22)
        state["held"] = True
    elif "run" in args:
        assert state["project"] == project
        assert state["held"]
        assert "--rm" in args and "--no-deps" in args and "-T" in args
        assert state["project"] in (None, project)
        state["project"] = project
        if state["volume"] is None:
            state["volume"] = f"{project}_docs-artifact"
        service = args[-1]
        state["services"].append(service)
        state["phases"].append(service)
        state_file.write_text(json.dumps(state))

        assert os.environ["LOCAL_UID"] == "0" and os.environ["LOCAL_GID"] == "0"
        stage = Path(os.environ["DOCS_STAGE_DIR"])
        assert stage.is_dir() and not stage.is_symlink()
        assert stat.S_IMODE(stage.stat().st_mode) == 0o700
        if service == "docs-build":
            if state["mode"] == "build-fail":
                print("fixture docs build failed", file=sys.stderr)
                sys.exit(17)
        elif service == "docs-export":
            if state["mode"] == "export-fail":
                print("fixture docs export failed", file=sys.stderr)
                sys.exit(18)
            if state["mode"] != "export-invalid":
                site = stage / "site"
                site.mkdir()
                (site / "index.html").write_text("built")
            if state["mode"] == "export-partial-fail":
                print("fixture docs export partially failed", file=sys.stderr)
                sys.exit(18)
            if state["mode"] == "publish-race":
                existing = Path(os.environ["DOCS_OUTPUT_DIR"]) / "site"
                existing.mkdir()
                (existing / "index.html").write_text("competitor")
        else:
            raise AssertionError("unexpected docs service: " + service)
    elif "down" in args:
        assert project == state["project"]
        state["phases"].append("down")
        state["held"] = False
        assert "--volumes" in args and "--remove-orphans" in args
        assert args[args.index("--rmi") + 1] == "all"
        assert os.environ["LOCAL_UID"] == "0" and os.environ["LOCAL_GID"] == "0"
        if state["mode"] == "down-fail":
            print("fixture Compose teardown failed", file=sys.stderr)
            sys.exit(19)
        if state["mode"] != "volume-residue":
            state["volume"] = None
    else:
        raise AssertionError("unexpected Compose operation: " + repr(args))
elif args[0] in ("container", "network", "volume") and args[1] == "ls":
    assert any(arg == f"label=com.docker.compose.project={state['project']}" for arg in args)
    if args[0] == "volume" and state["volume"] is not None:
        print(state["volume"])
else:
    raise AssertionError("unexpected Docker operation: " + repr(args))

state_file.write_text(json.dumps(state))
'''


class DocsBuildLifecycleTests(unittest.TestCase):
    def test_all_services_are_offline_read_only_and_capability_free(self) -> None:
        config = rendered_compose_config("compose/docs.yml", env={
            "LOCAL_UID": "1000",
            "LOCAL_GID": "1000",
            "DOCS_STAGE_DIR": "/tmp/dapp32-docs-stage-test",
            "DOCS_IMAGE_TAG": "docs-confinement-test",
        })
        artifact = config["volumes"]["docs-artifact"]
        self.assertEqual("local", artifact["driver"])
        self.assertNotIn("external", artifact)
        self.assertEqual({
            "type": "tmpfs",
            "device": "tmpfs",
            "o": "size=512m,uid=1000,gid=1000,mode=0700,nosuid,nodev,noexec",
        }, artifact["driver_opts"])

        for name in ("docs-build", "docs-hold", "docs-export"):
            with self.subTest(service=name):
                service = config["services"][name]
                self.assertEqual("none", service["network_mode"])
                self.assertTrue(service["read_only"])
                self.assertEqual("1000:1000", service["user"])
                self.assertEqual(["ALL"], service["cap_drop"])
                self.assertIn("no-new-privileges:true", service["security_opt"])
                self.assertNotEqual("host", service.get("pid"))
                self.assertNotEqual("host", service.get("ipc"))
                self.assertFalse(service.get("privileged"))
                self.assertFalse(service.get("ports"))
                self.assertFalse(service.get("devices"))
                self.assertFalse(service.get("use_api_socket"))

        builder = config["services"]["docs-build"]
        holder = config["services"]["docs-hold"]
        exporter = config["services"]["docs-export"]
        self.assertEqual("dapp32-docs-builder:docs-confinement-test", builder["image"])
        self.assertEqual(builder["image"], holder["image"])
        self.assertEqual(builder["image"], exporter["image"])
        self.assertEqual("never", builder["pull_policy"])
        self.assertEqual("never", holder["pull_policy"])
        self.assertFalse(holder.get("build"))
        self.assertFalse(holder.get("environment"))
        self.assertFalse(holder.get("tmpfs"))
        self.assertEqual(["sleep", "infinity"], holder["command"])
        self.assertEqual(16, holder["pids_limit"])
        self.assertEqual(1, len(holder["volumes"]))
        held_mount = compose_volume(holder, "/artifact")
        self.assertEqual("docs-artifact", held_mount["source"])
        self.assertTrue(held_mount["read_only"])
        self.assertTrue(held_mount["volume"]["nocopy"])
        self.assertEqual("none", builder["build"]["network"])
        self.assertEqual(128, builder["pids_limit"])
        self.assertEqual(32, exporter["pids_limit"])
        self.assertTrue(builder["init"])
        self.assertEqual("never", exporter["pull_policy"])
        self.assertFalse(exporter.get("build"))
        self.assertFalse(exporter.get("environment"))
        self.assertFalse(exporter.get("tmpfs"))
        self.assertEqual("/", exporter["working_dir"])

        for target in ("/work/js", "/tmp"):
            mounts = [mount for mount in builder["tmpfs"] if mount.startswith(target + ":")]
            self.assertEqual(1, len(mounts), target)
            options = mounts[0].split(":", 1)[1].split(",")
            self.assertIn("noexec", options)
            self.assertIn("nosuid", options)
            self.assertIn("nodev", options)
            self.assertIn("mode=0700", options)
        self.assertEqual("docs-artifact", compose_volume(builder, "/out")["source"])
        self.assertTrue(compose_volume(builder, "/out")["volume"]["nocopy"])
        self.assertTrue(compose_volume(builder, "/input/docs")["read_only"])
        self.assertTrue(compose_volume(builder, "/input/node_modules")["read_only"])
        self.assertNotIn("/work/js/node_modules", [mount["target"] for mount in builder["volumes"]])

        artifact_mount = compose_volume(exporter, "/artifact")
        self.assertEqual("docs-artifact", artifact_mount["source"])
        self.assertTrue(artifact_mount["read_only"])
        self.assertTrue(artifact_mount["volume"]["nocopy"])
        stage_mount = compose_volume(exporter, "/export")
        self.assertEqual("/tmp/dapp32-docs-stage-test", stage_mount["source"])
        self.assertFalse(stage_mount.get("read_only"))
        self.assertFalse(stage_mount["bind"].get("create_host_path"))
        self.assertIn("bind: { create_host_path: false }", (ROOT / "compose/docs.yml").read_text(encoding="utf-8"))
        self.assertEqual(2, len(exporter["volumes"]))
        self.assertNotIn("/export", [mount["target"] for mount in builder["volumes"]])

        builder_command = " ".join(str(item) for item in builder["command"])
        self.assertIn("mkdir /work/js/node_modules", builder_command)
        self.assertIn("ln -s", builder_command)
        self.assertIn("prepare-navigation.mjs /work/js/docs", builder_command)
        self.assertIn("exec node node_modules/.bin/vitepress", builder_command)
        self.assertNotIn("exec node_modules/.bin/vitepress", builder_command)

    def run_operation(self, root: Path, mode: str, *, existing_site: bool) -> tuple[subprocess.CompletedProcess[str], list[dict], dict]:
        (root / "output").mkdir()
        if existing_site:
            (root / "output/site").mkdir()
        (root / "docker.py").write_text(FAKE_DOCKER)
        (root / "state.json").write_text(json.dumps({
            "mode": mode,
            "project": None,
            "volume": None,
            "services": [],
            "phases": [],
            "held": False,
        }))
        # The offline checks container mounts /tmp with noexec. Invoke the
        # fake Docker peer through an interpreted Bash startup file, including
        # nested cleanup shells, rather than executing a /tmp script directly.
        bash_env = root / "fake-docker.bash"
        bash_env.write_text(
            'docker() {\n'
            f'  if [[ "$1" == context ]]; then "{ROOT / "tests/fixtures/docker-context/docker"}" "$@";\n'
            '  else "$PYTHON" "$CASE_ROOT/docker.py" "$@"; fi\n'
            '}\n'
        )
        endpoint = "unix:///tmp/docs-test-selected.sock"
        environment = {
            **os.environ,
            "CASE_ROOT": str(root),
            "PYTHON": sys.executable,
            "CAM_DOCKER_ENDPOINT": endpoint,
            "ENDPOINT": endpoint,
            "TRACE": str(root / "selector-trace"),
            "PATH": f"{ROOT / 'tests/fixtures/docker-context'}:{os.environ['PATH']}",
            "BASH_ENV": str(bash_env),
            "DOCS_OUTPUT_DIR": str(root / "output"),
        }
        # The real identity selector is tested separately against rootless/rootful
        # maps. Here simulate its receipt and assert that all Compose calls use it.
        makefile = (
            f"include {ROOT / 'Makefile'}\n"
            "override LANE_GUARD := true\n"
            "override PACKAGE_DEPS_GUARD := true\n"
            'override select_host_output_identity = release_with_mapped_owner() { LOCAL_UID=0 LOCAL_GID=0 "$$@"; }\n'
        )
        expanded = subprocess.run(
            ["make", "--no-print-directory", "-n", "-f", "-", "docs/build",
             "DOCKER_CONTEXT=fixture", f"DOCS_OUTPUT_DIR={root / 'output'}"],
            cwd=ROOT, env=environment, input=makefile,
            capture_output=True, text=True, timeout=15,
        )
        self.assertEqual(0, expanded.returncode, expanded.stderr)

        result = subprocess.run(
            ["bash", "-eu", "-o", "pipefail", "-c", expanded.stdout],
            cwd=ROOT, env=environment, capture_output=True, text=True, timeout=20,
        )
        calls_path = root / "calls.jsonl"
        calls = [json.loads(line) for line in calls_path.read_text().splitlines()] if calls_path.exists() else []
        state = json.loads((root / "state.json").read_text())
        self.assertFalse(list((root / "output").glob(".dapp32-docs-*")), "the host staging directory survived")
        return result, calls, state

    @staticmethod
    def down_calls(calls: list[dict]) -> list[dict]:
        return [call for call in calls if call["args"][0] == "compose" and "down" in call["args"]]

    def test_success_publishes_and_cleans_the_private_stage_and_tmpfs_volume(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, calls, state = self.run_operation(root, "success", existing_site=False)
            self.assertEqual(0, result.returncode, result.stderr)
            self.assertEqual("built", (root / "output/site/index.html").read_text())
            self.assertEqual(["docs-build", "docs-export"], state["services"])
            self.assertEqual(["image-build", "hold-start", "docs-build", "docs-export", "down"], state["phases"])
            self.assertFalse(state["held"])
            self.assertIsNone(state["volume"])
            self.assertEqual(1, len(self.down_calls(calls)))
            self.assertTrue(all(call["uid"] == "0" and call["gid"] == "0"
                                for call in calls if call["args"][0] == "compose"))
            self.assertEqual(1, len({call["stage"] for call in calls if call["args"][0] == "compose"}))
            image_tags = {call["image_tag"] for call in calls if call["args"][0] == "compose"}
            self.assertEqual(1, len(image_tags))
            image_tag = next(iter(image_tags))
            self.assertEqual(24, len(image_tag))
            self.assertTrue(state["project"].endswith(f"-docs-{image_tag}"))
            self.assertFalse(any(call["args"][:2] in (["volume", "create"], ["volume", "rm"])
                                 for call in calls))

    def test_docs_publish_automatically_from_main_without_candidate_branches(self) -> None:
        source = (ROOT / ".github/workflows/docs-pages-candidate.yml").read_text(encoding="utf-8")
        publisher = source.split("  publish:\n", 1)[1]
        self.assertIn("if: (github.event_name == 'push' || github.event_name == 'workflow_dispatch') && github.ref == 'refs/heads/main'", publisher)
        self.assertIn("needs: qualify", publisher)
        self.assertIn("pages: write", publisher)
        self.assertIn("queue: max", publisher)
        self.assertIn("actions/download-artifact@", publisher)
        self.assertIn("source/tools/docs_site.py stage", publisher)
        self.assertIn("git push origin HEAD:refs/heads/gh-pages", publisher)
        self.assertIn("gh api -X POST", publisher)
        self.assertLess(publisher.index("Verify the configured Pages source"),
                        publisher.index("git push origin HEAD:refs/heads/gh-pages"))
        self.assertIn("git ls-remote origin refs/heads/main", publisher)
        self.assertIn("pages/builds/latest", publisher)
        self.assertNotIn("gh pr create", publisher)
        self.assertNotIn('branch="docs/', publisher)
        self.assertFalse((ROOT / ".github/workflows/docs-publish.yml").exists())

        viewer = (ROOT / ".github/workflows/viewer-pages-preview.yml").read_text(encoding="utf-8")
        viewer_publisher = viewer.split("  publish:\n", 1)[1]
        self.assertIn("github.event_name == 'push'", viewer_publisher)
        self.assertIn("github.ref == 'refs/heads/main'", viewer_publisher)
        self.assertIn("needs: candidate", viewer_publisher)
        self.assertIn("pages: write", viewer_publisher)
        self.assertIn("group: gh-pages-publication", viewer_publisher)
        self.assertIn("queue: max", viewer_publisher)
        self.assertIn("git push origin HEAD:refs/heads/gh-pages", viewer_publisher)
        self.assertIn("pages/builds/latest", viewer_publisher)
        self.assertNotIn("gh pr create", viewer_publisher)

    def test_each_operation_owns_a_distinct_project_and_artifact(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            projects: set[str] = set()
            for name in ("first", "second"):
                root = Path(directory) / name
                root.mkdir()
                result, calls, state = self.run_operation(root, "success", existing_site=False)
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual(1, len(self.down_calls(calls)))
                projects.add(state["project"])
            self.assertEqual(2, len(projects))

    def test_publisher_rejects_unowned_viewer_assets_before_transfer(self) -> None:
        workflow = (ROOT / ".github/workflows/docs-pages-candidate.yml").read_text(encoding="utf-8")
        self.assertIn("source/tools/docs_site.py check", workflow)
        self.assertIn("source/tools/docs_site.py stage", workflow)
        self.assertIn("git diff --cached --name-only -- viewer/", workflow)
        self.assertIn("Download the exact qualified artifact", workflow)

    def test_failures_remove_the_stage_and_volume_before_publication(self) -> None:
        for mode, expected, services in (
            ("image-build-fail", 21, []),
            ("holder-start-fail", 22, []),
            ("build-fail", 17, ["docs-build"]),
            ("export-fail", 18, ["docs-build", "docs-export"]),
            ("export-partial-fail", 18, ["docs-build", "docs-export"]),
            ("export-invalid", 1, ["docs-build", "docs-export"]),
        ):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                result, calls, state = self.run_operation(root, mode, existing_site=False)
                self.assertEqual(expected, result.returncode, result.stderr)
                self.assertEqual(services, state["services"])
                self.assertIsNone(state["volume"])
                self.assertEqual(1, len(self.down_calls(calls)))
                self.assertFalse(state["held"])
                self.assertFalse((root / "output/site").exists())

    def test_concurrent_publication_cannot_replace_an_existing_site(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, calls, state = self.run_operation(root, "publish-race", existing_site=False)
            self.assertNotEqual(0, result.returncode)
            self.assertEqual("competitor", (root / "output/site/index.html").read_text())
            self.assertIsNone(state["volume"])
            self.assertEqual(1, len(self.down_calls(calls)))

    def test_cleanup_failures_remain_failures_even_after_publication(self) -> None:
        for mode in ("down-fail", "volume-residue"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                result, calls, state = self.run_operation(root, mode, existing_site=False)
                self.assertNotEqual(0, result.returncode)
                self.assertIsNotNone(state["volume"])
                self.assertIn("Docs project/volume cleanup failed", result.stderr)
                self.assertNotIn("Generated docs:", result.stdout)
                self.assertEqual(1, len(self.down_calls(calls)))

    def test_existing_site_is_rejected_before_docker_runs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result, calls, state = self.run_operation(root, "success", existing_site=True)
            self.assertEqual(2, result.returncode)
            self.assertFalse(calls)
            self.assertFalse(state["services"])
            self.assertTrue((root / "output/site").is_dir())
