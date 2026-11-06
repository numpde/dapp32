"""Reject literal Docker engine-selection bypasses in first-party runtime source.

Ported from nmr-provider-tools aef5cb5's Docker context posture check. This
gate has no grandfathered violations. It also covers argv literals, context
switching, short CLI flags, workflows and JavaScript launchers. It cannot prove
selection through arbitrary computed commands; launcher behavior needs its own
tests when the runtime selection boundary is implemented.
"""

from __future__ import annotations

import ast
import os
import re
import unittest
from pathlib import Path

from ..common import ROOT, SKIP_DIRS


_ENGINE_COMMANDS = (
    "attach|build|buildx|builder|commit|compose|container|cp|create|events|exec|"
    "export|history|image|images|import|info|inspect|kill|load|login|logout|logs|"
    "network|pause|port|ps|pull|push|rename|restart|rm|rmi|run|save|service|stack|"
    "start|stats|stop|swarm|system|tag|top|trust|unpause|update|version|volume|wait"
)
_LITERAL_NAME = r"[A-Za-z0-9_][A-Za-z0-9_.-]*"
_DOCKER = r'''(?<![A-Za-z0-9_])(?:docker|["']docker["'])'''
_SPACE = r"(?:[ \t]|\\[ \t]*\n)+"
_PATTERNS = (
    (re.compile(rf"{_DOCKER}{_SPACE}(?:{_ENGINE_COMMANDS})\b"), "implicit engine selection"),
    (re.compile(rf'''["']docker["']\s*,\s*["'](?:{_ENGINE_COMMANDS})["']'''), "implicit engine selection in argv"),
    (re.compile(r'''\bdocker\s+["']?\$'''), "implicit engine selection in computed command"),
    (re.compile(r'''["']docker["']\s*,\s*(?![\s"'])\S'''), "implicit engine selection in computed argv"),
    (re.compile(rf'''{_DOCKER}{_SPACE}--host{_SPACE}(?!["']?\${{1,2}}\{{?CAM_DOCKER_ENDPOINT\b)'''), "unselected Docker endpoint"),
    (re.compile(rf'''{_DOCKER}{_SPACE}--context(?:=|\s+)'''), "Docker context resolved during operation"),
    (re.compile(rf'''{_DOCKER}{_SPACE}(?:--config|-H|-c)(?:=|\s+)'''), "noncanonical Docker global option"),
    (re.compile(rf'''{_DOCKER}{_SPACE}--host='''), "noncanonical Docker host option"),
    (re.compile(rf'''{_DOCKER}{_SPACE}--host{_SPACE}[^\s]+{_SPACE}(?:--host(?:=|\s)|-H(?:=|\s))'''), "multiple Docker host options"),
    (re.compile(r'''\bdocker\s+[^\n;|]*\s--context(?:=|\s+)'''), "Docker context resolved during operation"),
    (re.compile(r'''\b(?:exec\.Command(?:Context)?|spawn|execFile)\s*\([^\n]*["']docker["']'''), "Docker process requires an owned endpoint boundary"),
    (re.compile(r"\bcontext\s+(?:use|show)\b"), "mutable current-context selection"),
    (re.compile(rf'''(?:--context(?:=|\s+)|\bdocker\s+-c\s+)["']?{_LITERAL_NAME}\b'''), "hardcoded context"),
    (re.compile(rf'''["']--context["']\s*,\s*["']{_LITERAL_NAME}["']'''), "hardcoded context in argv"),
    (re.compile(rf'''["']docker["']\s*,\s*["']-c["']\s*,\s*["']{_LITERAL_NAME}["']'''), "hardcoded context in argv"),
    (re.compile(rf'''\bcontext\s+inspect\s+["']?{_LITERAL_NAME}\b'''), "hardcoded inspected context"),
    (re.compile(rf'''\bDOCKER_CONTEXT[ \t]*[:?+]?=[ \t]*["']?{_LITERAL_NAME}(?![A-Za-z0-9_.=-])'''), "hardcoded context assignment"),
    (re.compile(rf'''["']DOCKER_CONTEXT["']\s*[:=]\s*["']{_LITERAL_NAME}["']'''), "hardcoded context assignment"),
    (re.compile(rf'''\bDOCKER_CONTEXT\s*:\s*["']?{_LITERAL_NAME}\b'''), "hardcoded context assignment"),
    (re.compile(r'''\$\{DOCKER_CONTEXT(?::?[-=])["']?[^}\s"']'''), "fallback context"),
    (re.compile(r'''unix:///[A-Za-z0-9_.-][^\s"'`,;)}]*'''), "hardcoded Docker socket"),
    (re.compile(r'''(?:--host(?:=|\s+)|\bdocker\s+-H\s+)["']?(?:tcp|ssh|http|https|npipe)://'''), "hardcoded remote Docker endpoint"),
    (re.compile(r'''["']--host["']\s*,\s*["'](?:tcp|ssh|http|https|npipe)://'''), "hardcoded remote Docker endpoint in argv"),
    (re.compile(r'''["']docker["']\s*,\s*["']-H["']\s*,\s*["'](?:tcp|ssh|http|https|npipe)://'''), "hardcoded remote Docker endpoint in argv"),
)


# silent-defaults: allow-default -- Callers opt into the specific source formats and metadata ownership they scan.
def docker_context_violations(source: str, *, python: bool = False, workflow: bool = False,
                              metadata_owner: bool = False) -> list[tuple[int, str]]:
    # Keep newlines for useful locations, while excluding standalone comments.
    code = "\n".join("" if line.lstrip().startswith(("#", "//")) else line
                     for line in source.splitlines())
    failures = set()
    if not metadata_owner:
        for match in re.finditer(r"\bdocker\s+context\s+(?:inspect|ls)\b", code):
            failures.add((code.count("\n", 0, match.start()) + 1, "Docker context metadata belongs to the selector"))
    for pattern, reason in _PATTERNS:
        if python and reason == "implicit engine selection":
            continue  # Python diagnostic strings are not shell commands.
        for match in pattern.finditer(code):
            if reason == "hardcoded Docker socket" and match.group() == "unix:///dev/null":
                continue  # This character device is a fail-closed Make inspection endpoint, not a socket.
            before = code[code.rfind("\n", 0, match.start()) + 1:match.start()]
            if reason in {"implicit engine selection", "unselected Docker endpoint"} and re.search(r"\bprintf\s+'[^']*$", before):
                continue  # Single-quoted printf text is not executed by the shell.
            if workflow and reason == "hardcoded context assignment" and re.search(r"\bmake(?:\s+[^\s;&|]+)*\s+$", before):
                continue  # CI deliberately selects its runner's context on Make's command line.
            failures.add((code.count("\n", 0, match.start()) + 1, reason))
    if python:
        approved = ast.dump(ast.parse('os.environ["CAM_DOCKER_ENDPOINT"]', mode="eval").body)
        for node in ast.walk(ast.parse(source)):
            if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
                    and node.func.attr in {"run", "Popen", "check_output", "check_call", "call", "system"}
                    and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
                for line, reason in docker_context_violations(node.args[0].value):
                    failures.add((node.lineno + line - 1, reason))
            if not isinstance(node, (ast.List, ast.Tuple)) or not node.elts:
                continue
            if not isinstance(node.elts[0], ast.Constant) or node.elts[0].value != "docker":
                continue
            if (len(node.elts) < 3 or not isinstance(node.elts[1], ast.Constant)
                    or node.elts[1].value != "--host" or ast.dump(node.elts[2]) != approved
                    or (len(node.elts) > 3 and isinstance(node.elts[3], ast.Constant)
                        and node.elts[3].value in {"--host", "-H", "--context", "-c", "--config"})):
                failures.add((node.lineno, "Docker argv must use the selected endpoint"))
    return sorted(failures)


def runtime_source(path: Path) -> bool:
    relative = path.relative_to(ROOT)
    if relative == Path("Makefile"):
        return True
    if relative.parts[0] not in {"tools", "js", "ops", "containers", "compose", ".github"}:
        return False
    if any(part in {"test", "tests", "fixtures"} for part in relative.parts):
        return False
    if any(marker in path.name for marker in (".test.", ".spec.")):
        return False
    return path.name in {"Makefile", "Dockerfile"} or path.suffix in {
        "",
        ".mk", ".sh", ".py", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".go", ".yml", ".yaml",
    }


def runtime_sources() -> list[Path]:
    paths = [ROOT / "Makefile"]
    for name in ("tools", "js", "ops", "containers", "compose", ".github"):
        for directory, children, files in os.walk(ROOT / name):
            children[:] = sorted(set(children) - SKIP_DIRS - {"test", "tests", "fixtures"})
            paths.extend(path for filename in sorted(files)
                         if runtime_source(path := Path(directory) / filename))
    return paths


class DockerContextPostureTest(unittest.TestCase):
    def test_rejects_engine_selection_bypasses(self) -> None:
        for source in (
            "docker ps", "docker compose up", "timeout 10s docker wait abc",
            "docker buildx build .", "docker context use $chosen", "docker context show",
            "docker --context default ps", "docker --context=production ps",
            "docker -c science ps", "docker context inspect default",
            "DOCKER_CONTEXT ?= default", "export DOCKER_CONTEXT=production",
            'environment = {"DOCKER_CONTEXT": "default"}',
            'DOCKER_CONTEXT: "science"', 'context=${DOCKER_CONTEXT:-default}',
            "docker --host unix:///var/run/docker.sock ps",
            "docker -H tcp://example.test:2375 ps",
            '["docker",\n "run", "fixture"]', '["--context", "production"]',
            '["docker", "-c", "science"]', '["docker", "-H", "ssh://example.test"]',
            'docker "$kind" ls', '["docker", *arguments]', '["docker", operation]',
            'docker --host "$DOCKER_HOST" ps', 'docker --context "$context" ps',
            '''printf '%s' "$(docker ps)"''',
            'make network/local/down DOCKER_CONTEXT=production',
            'docker -H "$OTHER" ps', 'docker --host="$OTHER" ps',
            'docker --config "$X" --host "$OTHER" ps',
            'docker --host "$CAM_DOCKER_ENDPOINT" --context "$OTHER" ps',
            'docker --host "$CAM_DOCKER_ENDPOINT" --host "$OTHER" ps',
            'exec.Command("docker", "ps")', 'spawn("docker", ["ps"])',
            "docker context inspect --format '{{.Endpoints.docker.Host}}'",
            "'docker' info", '"docker" info', "docker \\\n info",
        ):
            with self.subTest(source=source):
                self.assertTrue(docker_context_violations(source), source)

    def test_preserves_explicit_selection_and_metadata_discovery(self) -> None:
        for source in (
            'docker --host "$CAM_DOCKER_ENDPOINT" ps',
            '["docker", "--host", selected_endpoint, "run"]',
            '[[ $endpoint == unix:///* ]]',
            'if [[ $name == default ]]; then inspect_selected_context; fi',
            '# Run make tests DOCKER_CONTEXT=default',
            '// docker context use default',
            'head -c 4096 file', "ulimit -c 0", "bash -c 'run_command'",
            '["bash", "-c", "run_command"]',
            'DOCKER_CONTEXT= CAM_DOCKER_ENDPOINT="$CAM_DOCKER_ENDPOINT" make child',
            "printf 'docker ps'", "printf 'docker --host %q pull %q' \"$CAM_DOCKER_ENDPOINT\" \"$image\"",
        ):
            with self.subTest(source=source):
                self.assertEqual([], docker_context_violations(source))
        self.assertEqual([], docker_context_violations('run: make tests/checks DOCKER_CONTEXT=default', workflow=True))
        self.assertEqual([], docker_context_violations('docker context ls --format "{{.Name}}"', metadata_owner=True))
        self.assertEqual([], docker_context_violations('docker context inspect "$selected_context"', metadata_owner=True))

    def test_inspection_dead_endpoint_is_not_a_docker_socket(self) -> None:
        # An intentionally unusable character device fails closed during Make -n.
        self.assertEqual([], docker_context_violations("override DOCKER_HOST := unix:///dev/null"))
        for source in ("override DOCKER_HOST := unix:///var/run/docker.sock",
                       "override DOCKER_HOST := unix:///tmp/engine.sock"):
            with self.subTest(source=source):
                self.assertIn((1, "hardcoded Docker socket"), docker_context_violations(source))

    def test_python_argv_requires_the_selected_endpoint_without_flagging_diagnostics(self) -> None:
        for source in ('subprocess.run(["docker", "ps"])', 'subprocess.run("docker ps", shell=True)',
                       'subprocess.run(["docker", "--host", arbitrary, "ps"])',
                       'subprocess.run(["docker", "--host", os.environ["CAM_DOCKER_ENDPOINT"], "--host", other, "ps"])'):
            with self.subTest(source=source):
                self.assertTrue(docker_context_violations(source, python=True))
        for source in ('raise RuntimeError(f"docker logs failed: {error}")',
                       'subprocess.run(["docker", "--host", os.environ["CAM_DOCKER_ENDPOINT"], "ps"])'):
            with self.subTest(source=source):
                self.assertEqual([], docker_context_violations(source, python=True))

    def test_reports_multiline_argv_location(self) -> None:
        self.assertEqual([(2, "implicit engine selection in argv")],
                         docker_context_violations('# comment\n["docker",\n "run"]'))

    def test_covers_runtime_languages_without_scanning_test_fixtures(self) -> None:
        for relative in ("Makefile", "tools/docker", "tools/engine.mk", "js/tools/launch.cjs", "ops/run.go", "js/src/app.tsx",
                         "compose/checks.yml", ".github/workflows/checks.yml"):
            with self.subTest(relative=relative):
                self.assertTrue(runtime_source(ROOT / relative))
        for relative in ("tests/checks/test_engine.py", "js/tools/engine.test.ts",
                         "js/packages/example/test/engine.ts", "notes/docker.md"):
            with self.subTest(relative=relative):
                self.assertFalse(runtime_source(ROOT / relative))

    def test_runtime_sources_require_explicit_engine_selection(self) -> None:
        failures = [f"{path.relative_to(ROOT)}:{line}: {reason}"
                    for path in runtime_sources()
                    for line, reason in docker_context_violations(path.read_text(encoding="utf-8"), python=path.suffix == ".py",
                                                                  workflow=path.is_relative_to(ROOT / ".github/workflows"),
                                                                  metadata_owner=path == ROOT / "tools/docker_context.sh")]
        if failures:
            self.fail("Docker calls must use the operation's explicitly selected local endpoint:\n"
                      + "\n".join(failures))
