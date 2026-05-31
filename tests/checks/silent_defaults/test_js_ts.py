from __future__ import annotations

import re
import unittest
from pathlib import Path

from ..common import ROOT
from .test_shared_scanner import line_findings, repo_files


JS_NULLISH_FALLBACK_RE = re.compile(r"\?\?\s*(?P<value>[^;,)]+)")
JS_ENV_OR_SEARCH_DEFAULT_RE = re.compile(
    r"(?:process\.env|import\.meta\.env|searchParams|URLSearchParams|params\.get|\.get\()[^;\n]*(?:\?\?|\|\|)"
)
JS_ASSIGNMENT_OR_RETURN_DEFAULT_RE = re.compile(
    r"\b(?:const|let|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*[^;\n|]+?\|\|\s*"
    r"(?:[\"'`{\[]|\d|true|false|null|undefined)"
    r"|\breturn\s+[^;\n|]+?\|\|\s*(?:[\"'`{\[]|\d|true|false|null|undefined)"
)
JS_TERNARY_DEFAULT_RE = re.compile(
    r"\b(?:const|let|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*"
    r"(?P<truthy>[A-Za-z_][A-Za-z0-9_]*)\s*\?\s*(?P=truthy)\s*:\s*(?:[\"'`{\[]|\d|true|false|null)"
    r"|\b(?:const|let|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*"
    r"(?P<undefined>[A-Za-z_][A-Za-z0-9_]*)\s*={2,3}\s*undefined\s*\?\s*"
    r"(?:[\"'`{\[]|\d|true|false|null)\s*:\s*(?P=undefined)"
)
JS_DESTRUCTURING_DEFAULT_RE = re.compile(
    r"\b(?:const|let|var)\s+\{[^}\n]*\b[A-Za-z_][A-Za-z0-9_]*\s*=\s*"
    r"(?:[\"'`{\[]|\d|true|false|null|undefined)"
)
JS_PARAMETER_DESTRUCTURING_VALUE_RE = re.compile(
    r"^\s*[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[\"'`{\[]|\d|true|false|null|undefined|[A-Z_][A-Za-z0-9_]*)"
)
JS_OPTION_OBJECT_DEFAULT_RE = re.compile(
    r"(?:function\s+[A-Za-z0-9_]+\s*\([^)\n]*\{[^)\n]*\}\s*:\s*[A-Za-z0-9_<>, ]+\s*=\s*\{\}"
    r"|\([^)\n]*\{[^)\n]*\}\s*:\s*[A-Za-z0-9_<>, ]+\s*=\s*\{\}\)\s*=>"
    r"|\}\s*:\s*[A-Za-z0-9_<>, ]+\s*=\s*\{\}\)\s*(?::|\{))"
)
JS_DEFAULT_PARAMETER_RE = re.compile(
    r"(?:function\s+[A-Za-z0-9_]+\s*\([^)\n]*|(?:const|let|var)\s+[A-Za-z0-9_]+\s*=\s*\([^)\n]*)"
    r"\b[A-Za-z_][A-Za-z0-9_]*\s*(?<![=!<>])=(?!=|>)\s*(?:[\"'`{\[]|\d|true|false|null|undefined)"
)
JS_TYPED_PARAMETER_DEFAULT_RE = re.compile(
    r"(?:^|[(,])\s*[A-Za-z_][A-Za-z0-9_]*\s*:\s*[^=;\n,)]+\s*=\s*"
    r"(?:[\"'`{\[]|\d|true|false|null|undefined)"
)
JS_EXCEPTION_FALLBACK_RE = re.compile(
    r"\breturn\s+(?:\[\]|\{\}|[\"'`].*[\"'`]|[0-9]+\b|true\b|false\b|null\b|undefined\b)"
)


def js_ts_files() -> list[Path]:
    return repo_files(
        (
            "js/**/*.js",
            "js/**/*.jsx",
            "js/**/*.mjs",
            "js/**/*.ts",
            "js/**/*.tsx",
            "js/**/*.mts",
            "tests/**/*.js",
            "tests/**/*.jsx",
            "tests/**/*.mjs",
            "tests/**/*.ts",
            "tests/**/*.tsx",
            "tests/**/*.mts",
        )
    )


class JsTsSilentDefaultsTest(unittest.TestCase):
    maxDiff = None

    def test_matchers_flag_representative_js_ts_defaults(self) -> None:
        self.assertRegex("x ?? fallback", JS_NULLISH_FALLBACK_RE)
        self.assertRegex("process.env.FOO || 'bar'", JS_ENV_OR_SEARCH_DEFAULT_RE)
        self.assertRegex("const port = configuredPort || '8080'", JS_ASSIGNMENT_OR_RETURN_DEFAULT_RE)
        self.assertRegex("return configuredPort || '8080'", JS_ASSIGNMENT_OR_RETURN_DEFAULT_RE)
        self.assertRegex("const port = configuredPort ? configuredPort : '8080'", JS_TERNARY_DEFAULT_RE)
        self.assertRegex("const { port = '8080' } = config", JS_DESTRUCTURING_DEFAULT_RE)
        self.assertTrue(js_source_has_parameter_destructuring_default("function run({\n  port = DEFAULT_PORT,\n}: Options) {}"))
        self.assertRegex("function run({ port }: Options = {}) {}", JS_OPTION_OBJECT_DEFAULT_RE)
        self.assertRegex("}: MockPublicClientOptions = {}): {", JS_OPTION_OBJECT_DEFAULT_RE)
        self.assertRegex('function run(port = "8080") {}', JS_DEFAULT_PARAMETER_RE)
        self.assertRegex('function run(port: string = "8080") {}', JS_TYPED_PARAMETER_DEFAULT_RE)
        self.assertRegex('  path: string = "",', JS_TYPED_PARAMETER_DEFAULT_RE)
        self.assertTrue(js_source_has_exception_fallback("try { run() } catch { return [] }"))

    def test_js_ts_files_do_not_hide_runtime_fallbacks(self) -> None:
        files = js_ts_files()
        findings: list[str] = []
        findings.extend(line_findings(files, JS_NULLISH_FALLBACK_RE, "JS/TS nullish fallback", skip_comments=False))
        findings.extend(line_findings(files, JS_ENV_OR_SEARCH_DEFAULT_RE, "JS/TS env/search fallback", skip_comments=False))
        findings.extend(
            line_findings(files, JS_ASSIGNMENT_OR_RETURN_DEFAULT_RE, "JS/TS assignment/return fallback", skip_comments=False)
        )
        findings.extend(line_findings(files, JS_TERNARY_DEFAULT_RE, "JS/TS ternary fallback", skip_comments=False))
        findings.extend(line_findings(files, JS_DESTRUCTURING_DEFAULT_RE, "JS/TS destructuring default", skip_comments=False))
        findings.extend(js_parameter_destructuring_default_findings(files))
        findings.extend(line_findings(files, JS_OPTION_OBJECT_DEFAULT_RE, "JS/TS option object default", skip_comments=False))
        findings.extend(line_findings(files, JS_DEFAULT_PARAMETER_RE, "JS/TS default parameter", skip_comments=False))
        findings.extend(line_findings(files, JS_TYPED_PARAMETER_DEFAULT_RE, "JS/TS typed default parameter", skip_comments=False))
        findings.extend(js_exception_fallback_findings(files))

        self.assertEqual([], findings)


def js_exception_fallback_findings(paths: list[Path]) -> list[str]:
    findings: list[str] = []
    for path in paths:
        findings.extend(
            js_exception_fallback_findings_for_source(
                path.read_text(encoding="utf-8"),
                str(path.relative_to(ROOT)),
            )
        )
    return findings


def js_parameter_destructuring_default_findings(paths: list[Path]) -> list[str]:
    findings: list[str] = []
    for path in paths:
        findings.extend(
            js_parameter_destructuring_default_findings_for_source(
                path.read_text(encoding="utf-8"),
                str(path.relative_to(ROOT)),
            )
        )
    return findings


def js_parameter_destructuring_default_findings_for_source(source: str, label: str) -> list[str]:
    findings: list[str] = []
    in_parameter_object = False
    for line_number, line in enumerate(source.splitlines(), start=1):
        if not in_parameter_object and re.search(r"\bfunction\b[^{\n]*\(\s*\{", line):
            in_parameter_object = True

        if in_parameter_object and JS_PARAMETER_DESTRUCTURING_VALUE_RE.search(line):
            findings.append(f"{label}:{line_number}: JS/TS parameter destructuring default: {line.strip()}")

        if in_parameter_object and re.search(r"^\s*\}\s*[:)]", line):
            in_parameter_object = False

    return findings


def js_exception_fallback_findings_for_source(source: str, label: str) -> list[str]:
    findings: list[str] = []
    catch_depth: int | None = None
    for line_number, line in enumerate(source.splitlines(), start=1):
        segment = line
        catch_match = re.search(r"\bcatch\b", line)
        if catch_depth is None and catch_match is not None:
            catch_depth = 0
            segment = line[catch_match.start():]

        if catch_depth is not None:
            for match in JS_EXCEPTION_FALLBACK_RE.finditer(line):
                findings.append(f"{label}:{line_number}: JS/TS exception fallback: {match.group(0).strip()}")

            catch_depth += segment.count("{") - segment.count("}")
            if catch_depth <= 0:
                catch_depth = None

    return findings


def js_source_has_exception_fallback(source: str) -> bool:
    return bool(js_exception_fallback_findings_for_source(source, "<inline>"))


def js_source_has_parameter_destructuring_default(source: str) -> bool:
    return bool(js_parameter_destructuring_default_findings_for_source(source, "<inline>"))


if __name__ == "__main__":
    unittest.main()
