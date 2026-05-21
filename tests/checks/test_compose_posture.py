from __future__ import annotations

import unittest

from .common import iter_files, read_text


class ComposePostureTest(unittest.TestCase):
    def test_compose_files_do_not_set_project_name(self) -> None:
        for path in iter_files("compose"):
            if path.suffix not in {".yml", ".yaml"}:
                continue

            with self.subTest(path=str(path)):
                for line_number, line in enumerate(read_text(path).splitlines(), start=1):
                    if line.startswith("name:"):
                        self.fail(f"{path}:{line_number}: do not set Compose project name in checked-in YAML")
