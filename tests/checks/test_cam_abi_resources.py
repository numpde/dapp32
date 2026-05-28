from __future__ import annotations

import unittest

from .cam_manifest_resources import CamManifestResourceValidator


class CamAbiResourceTest(unittest.TestCase):
    def setUp(self) -> None:
        self.validator = CamManifestResourceValidator()

    def test_cam_abi_resources_are_checked_in_and_manifest_referenced(self) -> None:
        failures = [
            *self.validator.collect_manifest_failures(self.validator.validate_manifest_abi_uris),
            *self.validator.collect_manifest_failures(self.validator.validate_no_orphan_abi_files),
        ]

        if failures:
            self.fail("\n".join(failures))


if __name__ == "__main__":
    unittest.main()
