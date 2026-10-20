from __future__ import annotations

import unittest

from .common import rendered_compose_config


class ReleaseApprovalImageTest(unittest.TestCase):
    def test_dependency_fetch_and_context_creation_have_separate_authority(self) -> None:
        config = rendered_compose_config(
            ("compose/package-deps.yml", "compose/release/approval-image.yml"),
            env={
                "PACKAGE_INPUT_DIR": "/tmp/approval-image-manifests",
                "RELEASE_APPROVAL_SOURCE_DIR": "/tmp/approval-image-source",
                "RELEASE_APPROVAL_CONTEXT_DIR": "/tmp/approval-image-context",
            },
        )
        services = config["services"]
        stage = services["package-stage"]
        context = services["release-approval-context"]

        self.assertEqual({"package_internal"}, set(stage["networks"]))
        self.assertEqual(
            [
                ("bind", "/tmp/approval-image-manifests", "/input", True),
                ("volume", "package-out", "/out", None),
            ],
            [(v["type"], v["source"], v["target"], v.get("read_only")) for v in stage["volumes"]],
        )
        self.assertEqual("none", context["network_mode"])
        self.assertTrue(context["read_only"])
        self.assertEqual("1000:1000", context["user"])
        self.assertEqual(
            [
                ("bind", "/tmp/approval-image-source", "/source", True),
                ("volume", "package-out", "/dependencies", True),
                ("bind", "/tmp/approval-image-context", "/context", None),
            ],
            [(v["type"], v["source"], v["target"], v.get("read_only")) for v in context["volumes"]],
        )
        self.assertEqual({"RELEASE_APPROVAL_TEST_SOURCE": "/source/js", "RELEASE_APPROVAL_TEST_DEPENDENCIES": "/dependencies"}, context["environment"])
        self.assertIn("/tmp:rw,nosuid,nodev,size=256m", context["tmpfs"])
        self.assertEqual(["sh", "-ec"], context["command"][:2])
        self.assertIn("node --experimental-strip-types --test /source/containers/release-approval/prepare-context.test.mjs", context["command"][2])
        self.assertIn("node /source/containers/release-approval/prepare-context.mjs /source/js /dependencies /source/containers/release-approval /context", context["command"][2])


if __name__ == "__main__":
    unittest.main()
