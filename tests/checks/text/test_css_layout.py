"""Docs CSS authoring policy, not a browser cascade or DOM simulation.

Layout-dependent declarations need a same-file layout witness on their selector
or a simple selector they refine. Conditional witnesses must enclose the use.
Only authored standalone docs CSS is covered; framework and inline styles are
outside this check. Intentional responsive changes to display alone are allowed.
Selector specificity, layer ordering, !important precedence and DOM class
composition are not resolved; a finding requires source review, not blind edits.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
import unittest

from tests.checks.common import ROOT


@dataclass
class Rule:
    selector: str
    conditions: tuple[str, ...]
    declarations: dict[str, str]
    line: int


def pieces(source: str, delimiters: str):
    """Split only outside CSS strings, comments, functions and attributes."""
    start = index = 0
    stack = []
    while index < len(source):
        char = source[index]
        if source.startswith('/*', index):
            end = source.find('*/', index + 2)
            if end < 0:
                raise ValueError('Unterminated CSS comment')
            index = end + 2
            continue
        if char == '\\':
            index += 2
            continue
        if char in "\"'":
            quote = char
            index += 1
            while index < len(source) and source[index] != quote:
                index += 2 if source[index] == '\\' else 1
            if index == len(source):
                raise ValueError('Unterminated CSS string')
        elif char in '([':
            stack.append(char)
        elif char in ')]':
            if not stack or stack.pop() != {')': '(', ']': '['}[char]:
                raise ValueError('Unbalanced CSS function or attribute')
        elif not stack and char in delimiters:
            yield source[start:index], char, start
            start = index + 1
        index += 1
    if stack:
        raise ValueError('Unclosed CSS function or attribute')
    yield source[start:], '', start


def rules(source: str) -> list[Rule]:
    # Preserve offsets for diagnostics while removing comments before matching.
    source = re.sub(r'''("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|/\*.*?\*/''',
                    lambda m: m[1] if m[1] is not None else re.sub(r'[^\n]', ' ', m[0]),
                    source, flags=re.S)
    result = []
    parents = []
    for fragment, delimiter, offset in pieces(source, '{};'):
        header = fragment.strip()
        if delimiter == '{':
            parents.append((header, offset, {}))
        elif delimiter in (';', '}') and parents:
            if header:
                name, colon, value = header.partition(':')
                if not colon:
                    raise ValueError(f'Cannot parse CSS declaration: {header}')
                declarations = parents[-1][2]
                name = name.strip().lower()
                if name in declarations:
                    del declarations[name]
                declarations[name] = value.strip().lower()
            if delimiter == '}':
                selector, opening, declarations = parents.pop()
                if not selector.startswith('@') and not any('keyframes' in p[0] for p in parents):
                    conditions = tuple(p[0] for p in parents)
                    for entry, _, _ in pieces(selector, ','):
                        result.append(Rule(' '.join(entry.split()), conditions, declarations,
                                           source.count('\n', 0, opening) + 1))
        elif delimiter == '}':
            raise ValueError('Unmatched CSS closing brace')
    if parents:
        raise ValueError('Unclosed CSS rule')
    return result


def refines(selector: str, base: str) -> bool:
    if selector == base:
        return True
    # Deliberately limited implication: appended classes/pseudo-classes, or a
    # simple class selector on the subject of a descendant/child selector.
    suffix = selector[len(base):] if selector.startswith(base) else ''
    if (suffix and suffix[0] in '.:[' and '::' not in suffix
            and len(list(pieces(suffix, ' >+~'))) == 1):
        return True
    if re.fullmatch(r'\.[\w-]+', base):
        subject = list(pieces(selector, ' >+~'))[-1][0].strip()
        return subject != selector and refines(subject, base)
    return False


def layout_findings(source: str) -> list[str]:
    stylesheet = rules(source)
    findings = []
    for rule in stylesheet:
        witnesses = {}
        for other in stylesheet:
            if (refines(rule.selector, other.selector)
                    and rule.conditions[:len(other.conditions)] == other.conditions):
                if other.selector not in witnesses:
                    witnesses[other.selector] = {}
                combined = witnesses[other.selector]
                for name, value in other.declarations.items():
                    if name in combined:
                        del combined[name]
                    combined[name] = value
        exact_display = witnesses[rule.selector].get('display')
        for property_name in rule.declarations.keys() & {'gap', 'row-gap', 'column-gap', 'flex-wrap', 'grid-template-columns'}:
            required = ('flex',) if property_name == 'flex-wrap' else ('grid',) if property_name == 'grid-template-columns' else ('flex', 'grid')
            supported = False
            for witness in witnesses.values():
                display = exact_display if exact_display is not None else witness.get('display')
                if display is not None and any(value in (*required, *(f'inline-{value}' for value in required))
                                               for value in display.removesuffix('!important').strip().split()):
                    supported = True
                if property_name.endswith('gap') and multicolumn(witness):
                    supported = True
            if not supported:
                requirement = '/'.join(required) + (' or multicolumn' if property_name.endswith('gap') else '')
                findings.append(f'line {rule.line}: {rule.selector}: {property_name} has no statically established {requirement} layout; review its prerequisite in this stylesheet')
    return findings


def multicolumn(declarations: dict[str, str]) -> bool:
    count = width = 'auto'
    for name, value in declarations.items():
        if name == 'columns':
            values = [part.strip() for part, _, _ in pieces(value, ' ') if part.strip()]
            count = next((part for part in values if part.isdecimal()), 'auto')
            width = next((part for part in values if not part.isdecimal() and part != 'auto'), 'auto')
        elif name == 'column-count':
            count = value
        elif name == 'column-width':
            width = value
    return any(value not in ('auto', 'initial', 'unset', 'inherit', 'revert', 'revert-layer')
               for value in (count, width))


class CssLayoutPolicyTests(unittest.TestCase):
    def test_gallery_regression(self):
        source = (ROOT / 'docs/gallery/gallery.css').read_text()
        broken = source.replace('.deployment .actions { display: flex; flex-wrap: wrap;', '.deployment .actions {')
        self.assertNotEqual(source, broken)
        self.assertTrue(any('.deployment .actions: gap' in finding for finding in layout_findings(broken)))
        self.assertEqual(layout_findings(source), [])

    def test_missing_prerequisites(self):
        for declaration in ('gap:16px', 'row-gap:1em', 'column-gap:1em', 'flex-wrap:wrap', 'grid-template-columns:1fr'):
            with self.subTest(declaration=declaration):
                self.assertEqual(len(layout_findings(f'.actions {{ {declaration}; }}')), 1)

    def test_compatible_layouts(self):
        for declaration in ('display:flex;gap:1em', 'display:inline-flex;flex-wrap:wrap',
                            'display:grid;grid-template-columns:1fr', 'display:inline-grid;gap:1em',
                            'display:block grid;gap:1em', 'column-count:2;gap:1em',
                            'columns:auto 12em;gap:1em', 'columns:12em 2;gap:1em'):
            with self.subTest(declaration=declaration):
                self.assertEqual(layout_findings(f'.actions {{ {declaration}; }}'), [])

    def test_combined_rules_and_selector_refinements(self):
        self.assertEqual(layout_findings('''
            .grid, .other { display:grid; }
            .grid.two { grid-template-columns:1fr; }
            .parent > .other:has(.a, .b) { gap:1em; }
            .other { row-gap:2em; }
        '''), [])
        self.assertEqual(len(layout_findings('.grid {display:grid} .gridiron {gap:1em}')), 1)

    def test_conditions(self):
        self.assertEqual(layout_findings('''
            .a { display:flex; }
            @media (width < 40rem) { .a {gap:1em} }
            @supports (display:grid) { .b {display:grid} .b {gap:1em} }
        '''), [])
        self.assertEqual(len(layout_findings('''
            @media (width > 40rem) { .a {display:flex} }
            @media (width < 40rem) { .a {gap:1em} }
        ''')), 1)

    def test_layout_cannot_come_from_another_element(self):
        for selector in ('.a.b .child', '.a::before', '.parent > .a::after'):
            with self.subTest(selector=selector):
                self.assertEqual(len(layout_findings(f'.a {{display:flex}} {selector} {{gap:1em}}')), 1)

    def test_explicit_display_overrides_a_layout_witness(self):
        self.assertEqual(len(layout_findings('.a {display:flex} .a {display:block;gap:1em}')), 1)
        self.assertEqual(len(layout_findings('.a {display:flex} .a {display:block} .a {gap:1em}')), 1)

    def test_split_multicolumn_declarations(self):
        self.assertEqual(layout_findings('.a {column-count:2} .a {display:block;column-gap:1em}'), [])
        self.assertEqual(len(layout_findings('.a {display:block;columns:auto auto;gap:1em}')), 1)
        self.assertEqual(len(layout_findings('.a {column-count:2} .a {columns:auto auto;gap:1em}')), 1)
        self.assertEqual(len(layout_findings('.a {columns:2} .a {column-count:auto;column-width:auto;gap:1em}')), 1)

    def test_comment_markers_in_strings_are_not_comments(self):
        self.assertEqual(len(layout_findings('''
            [title="/*"] {color:red}
            .a {gap:1em}
            [title="*/"] {color:blue}
        ''')), 1)

    def test_responsive_stacking_does_not_recheck_old_declarations(self):
        self.assertEqual(layout_findings('.a {display:flex;gap:1em} @media (width < 40rem) {.a {display:block}}'), [])

    def test_strings_comments_and_keyframes(self):
        self.assertEqual(layout_findings('''
            /* .fake {gap:1em} */
            .a { content:"{;gap:1em}"; display:grid; gap:var(--gap, 1em); }
            @keyframes pulse { from {opacity:0} to {opacity:1} }
        '''), [])

    def test_docs_stylesheets(self):
        paths = sorted((ROOT / 'docs').rglob('*.css'))
        self.assertTrue(paths)
        for path in paths:
            with self.subTest(path=path.relative_to(ROOT)):
                self.assertEqual(layout_findings(path.read_text()), [])
