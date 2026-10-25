from __future__ import annotations

import re
import unittest
from pathlib import Path

from ..common import ROOT
from .test_shared_scanner import repo_files


JS_NULLISH_FALLBACK_RE = re.compile(r"\?\?\s*(?P<value>[^;,)]+)")
JS_ENV_OR_SEARCH_DEFAULT_RE = re.compile(
    r"(?:process\.env|import\.meta\.env|searchParams|URLSearchParams|params\.get|\.get\()[^;\n]*(?:\?\?|\|\|)"
)
JS_ASSIGNMENT_OR_RETURN_DEFAULT_RE = re.compile(
    r"\b(?:const|let|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*[^;\n|]+?\|\|\s*"
    r"(?:[\"'`{\[]|\d|true|false|null|undefined)"
    r"|\breturn\s+[^;\n|]+?\|\|\s*(?:[\"'`{\[]|\d|true|false|null|undefined)"
)
JS_COMPOUND_ASSIGNMENT_DEFAULT_RE = re.compile(r"\b[A-Za-z_][A-Za-z0-9_.\[\]]*\s*(?:\|\|=|\?\?=)\s*")
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
    r"(?:^|[,{])\s*(?P<assignment>[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:[\"'`{\[]|\d|true|false|null|undefined|[A-Z_][A-Za-z0-9_]*))"
)
JS_PARAMETER_OBJECT_START_RE = re.compile(
    r"(?:\bfunction\b[^({]*\(\s*\{"
    r"|(?:const|let|var)\s+[A-Za-z_][A-Za-z0-9_]*\s*=\s*(?:async\s*)?\(\s*\{"
    r"|^[ \t]*[A-Za-z_][A-Za-z0-9_]*\s*\(\s*\{)",
    re.MULTILINE,
)
JS_PARAMETER_TOKEN_RE = re.compile(
    r"\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`"
    r"|//[^\n]*|/\*[\s\S]*?\*/|[{}();]"
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

    def test_parameter_defaults_do_not_include_object_initializers_or_function_bodies(self) -> None:
        sources = (
            "const options = {\n  update() {\n    enabled = true;\n  },\n};",
            "const options = ({\n  update() {\n    enabled = true;\n  },\n});",
            "run({\n  update() {\n    enabled = true;\n  },\n});",
            "function render({ account }: Options) {\n  return <View\n    account={account}\n  />;\n}",
            "const render = ({ account }: Options) => {\n  return <View\n    account={account}\n  />;\n};",
            "run({ account }: Options) {\n  if (account) {\n    currentView = { account };\n  }\n}",
            "function run({\n  account,\n}: Options) {\n  currentView = { account };\n}",
        )
        for source in sources:
            with self.subTest(source=source):
                self.assertEqual([], js_parameter_destructuring_default_findings_for_source(source, "fixture"))

    def test_parameter_defaults_include_inline_multiline_and_nested_destructuring(self) -> None:
        sources = (
            "function run({ port = DEFAULT_PORT }: Options) {}",
            "const run = ({ port = DEFAULT_PORT }: Options) => {};",
            "run({ port = DEFAULT_PORT }: Options) {}",
            "function run({\n  port = DEFAULT_PORT,\n}: Options) {}",
            "const run = ({\n  port = DEFAULT_PORT,\n}: Options) => {};",
            "run({\n  port = DEFAULT_PORT,\n}: Options) {}",
            "function run({ nested: { port = DEFAULT_PORT } }: Options) {}",
            "function run({ label = '}', port = DEFAULT_PORT }: Options) {}",
        )
        for source in sources:
            with self.subTest(source=source):
                self.assertTrue(js_source_has_parameter_destructuring_default(source))

    def test_first_destructured_parameter_defaults_survive_following_parameters(self) -> None:
        sources = (
            "const run = ({\n  port = DEFAULT_PORT,\n}, other) => {};",
            "run({\n  port = DEFAULT_PORT,\n}, other) {}",
            "const run = ({\n  port = DEFAULT_PORT,\n}: Options, other: boolean = false) => {};",
            "run({\n  port = DEFAULT_PORT,\n}: Options, other: boolean = false) {}",
            "const run = ({ port = DEFAULT_PORT }, callback = () => {}) => {};",
        )
        for source in sources:
            with self.subTest(source=source):
                self.assertTrue(js_source_has_parameter_destructuring_default(source))

    def test_call_objects_with_following_arguments_are_not_parameter_objects(self) -> None:
        sources = (
            "run({\n  update() {\n    enabled = true;\n  },\n}, other);",
            "const result = run({\n  update() {\n    enabled = true;\n  },\n}, other);",
            "const options = ({\n  update() {\n    enabled = true;\n  },\n}, () => {});",
        )
        for source in sources:
            with self.subTest(source=source):
                self.assertEqual([], js_parameter_destructuring_default_findings_for_source(source, "fixture"))

    def test_matchers_flag_representative_js_ts_defaults(self) -> None:
        self.assertRegex("x ?? fallback", JS_NULLISH_FALLBACK_RE)
        self.assertRegex("process.env.FOO || 'bar'", JS_ENV_OR_SEARCH_DEFAULT_RE)
        self.assertRegex("const port = configuredPort || '8080'", JS_ASSIGNMENT_OR_RETURN_DEFAULT_RE)
        self.assertRegex("return configuredPort || '8080'", JS_ASSIGNMENT_OR_RETURN_DEFAULT_RE)
        self.assertRegex("options.port ??= '8080'", JS_COMPOUND_ASSIGNMENT_DEFAULT_RE)
        self.assertRegex("config.enabled ||= true", JS_COMPOUND_ASSIGNMENT_DEFAULT_RE)
        self.assertRegex("const port = configuredPort ? configuredPort : '8080'", JS_TERNARY_DEFAULT_RE)
        self.assertRegex("const { port = '8080' } = config", JS_DESTRUCTURING_DEFAULT_RE)
        self.assertTrue(js_source_has_parameter_destructuring_default("function run({\n  port = DEFAULT_PORT,\n}: Options) {}"))
        self.assertTrue(js_source_has_parameter_destructuring_default("const run = ({\n  port = DEFAULT_PORT,\n}: Options) => {}"))
        self.assertTrue(js_source_has_parameter_destructuring_default("run({\n  port = DEFAULT_PORT,\n}: Options) {}"))
        self.assertRegex("function run({ port }: Options = {}) {}", JS_OPTION_OBJECT_DEFAULT_RE)
        self.assertRegex("}: MockPublicClientOptions = {}): {", JS_OPTION_OBJECT_DEFAULT_RE)
        self.assertRegex('function run(port = "8080") {}', JS_DEFAULT_PARAMETER_RE)
        self.assertRegex('function run(port: string = "8080") {}', JS_TYPED_PARAMETER_DEFAULT_RE)
        self.assertRegex('  path: string = "",', JS_TYPED_PARAMETER_DEFAULT_RE)
        self.assertTrue(js_source_has_exception_fallback("try { run() } catch { return [] }"))

    def test_js_ts_files_do_not_hide_runtime_fallbacks(self) -> None:
        findings = []
        for path in js_ts_files():
            findings.extend(js_default_findings_for_source(path.read_text(), str(path.relative_to(ROOT))))
        self.assertEqual([], findings)

    def test_reasoned_default_waiver_is_local_and_raw_detection_remains(self) -> None:
        source = '// silent-defaults: allow-default -- Missing labels use the control text.\nconst label = aria ?? text\n'
        self.assertRegex(source, JS_NULLISH_FALLBACK_RE)
        self.assertEqual([], js_default_findings_for_source(source, 'fixture'))
        self.assertTrue(js_default_findings_for_source(source + 'const port = env.PORT ?? 8080\n', 'fixture'))
        self.assertTrue(js_default_findings_for_source(source.replace('aria ?? text', 'text'), 'fixture'))
        self.assertTrue(js_default_findings_for_source(source.replace(' -- Missing labels use the control text.', ''), 'fixture'))
        stale = '// silent-defaults: allow-default -- This is not an exception fallback.\nreturn "ordinary"\n'
        self.assertTrue(js_default_findings_for_source(stale, 'fixture'))
        nested = 'try {} catch {\n// silent-defaults: allow-default -- This handler returns a visible error label.\nreturn "known" }\nfunction ordinary() { return "outside" }\ntry {} catch { return "unwaived" }\n'
        findings = js_default_findings_for_source(nested, 'fixture')
        self.assertEqual(1, len(findings), findings)
        self.assertIn('unwaived', findings[0])


def js_default_findings_for_source(source: str, label: str) -> list[str]:
    patterns = (
        (JS_NULLISH_FALLBACK_RE, "JS/TS nullish fallback"),
        (JS_ENV_OR_SEARCH_DEFAULT_RE, "JS/TS env/search fallback"),
        (JS_ASSIGNMENT_OR_RETURN_DEFAULT_RE, "JS/TS assignment/return fallback"),
        (JS_COMPOUND_ASSIGNMENT_DEFAULT_RE, "JS/TS compound assignment fallback"),
        (JS_TERNARY_DEFAULT_RE, "JS/TS ternary fallback"),
        (JS_DESTRUCTURING_DEFAULT_RE, "JS/TS destructuring default"),
        (JS_OPTION_OBJECT_DEFAULT_RE, "JS/TS option object default"),
        (JS_DEFAULT_PARAMETER_RE, "JS/TS default parameter"),
        (JS_TYPED_PARAMETER_DEFAULT_RE, "JS/TS typed default parameter"),
    )
    lines = source.splitlines()
    findings: list[str] = []
    for line_number, line in enumerate(lines, 1):
        for pattern, rule in patterns:
            for match in pattern.finditer(line):
                findings.append(f"{label}:{line_number}: {rule}: {match.group(0).strip()}")
    findings.extend(js_parameter_destructuring_default_findings_for_source(source, label))
    findings.extend(js_exception_fallback_findings_for_source(source, label))
    # Waivers filter actual locations after detection; source and brace context
    # remain intact for every matcher, including nested exception handlers.
    locations = [int(re.match(re.escape(label) + r":(\d+):", finding).group(1)) for finding in findings]
    waived: set[int] = set()
    invalid: list[str] = []
    for index, line in enumerate(lines):
        if not line.lstrip().startswith('// silent-defaults'):
            continue
        prefix, separator, reason = line.strip().partition(' -- ')
        target = index + 2
        if prefix != '// silent-defaults: allow-default' or not separator or not reason.strip() or target not in locations:
            invalid.append(f"{label}:{index + 1}: JS/TS default waiver must immediately precede a finding and give a reason")
        else:
            waived.add(target)
    return [finding for finding, line in zip(findings, locations) if line not in waived] + invalid


def js_parameter_destructuring_default_findings_for_source(source: str, label: str) -> list[str]:
    findings: list[str] = []
    lines = source.splitlines()
    for start in JS_PARAMETER_OBJECT_START_RE.finditer(source):
        object_start = start.end() - 1
        depth = 0
        ignored_spans: list[tuple[int, int]] = []
        for token in JS_PARAMETER_TOKEN_RE.finditer(source, object_start):
            if token.group() == "{":
                depth += 1
            elif token.group() == "}":
                depth -= 1
                if depth == 0:
                    object_end = token.end()
                    break
            else:
                ignored_spans.append((token.start(), token.end()))
        else:
            continue

        # Following parameters can contain callbacks; only the outer ')' ends the header.
        if not re.search(r"\bfunction\b", start.group()):
            parentheses = 1
            braces = 0
            for token in JS_PARAMETER_TOKEN_RE.finditer(source, object_end):
                if token.group() == "(":
                    parentheses += 1
                elif token.group() == ")":
                    parentheses -= 1
                    if parentheses == 0:
                        break
                elif token.group() == "{":
                    braces += 1
                elif token.group() == "}":
                    braces -= 1
                elif token.group() == ";" and parentheses == 1 and braces == 0:
                    break
            if parentheses != 0:
                continue
            suffix = r"=>" if re.match(r"(?:const|let|var)\b", start.group()) else r"\{"
            if not re.match(r"\s*(?::[^=;]+)?" + suffix, source[token.end():]):
                continue

        for default in JS_PARAMETER_DESTRUCTURING_VALUE_RE.finditer(source, object_start, object_end):
            if any(begin <= default.start() < end for begin, end in ignored_spans):
                continue
            line_number = source.count("\n", 0, default.start("assignment")) + 1
            findings.append(f"{label}:{line_number}: JS/TS parameter destructuring default: {lines[line_number - 1].strip()}")

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
