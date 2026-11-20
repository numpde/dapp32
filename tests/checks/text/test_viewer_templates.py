"""Keep template variable names aligned with the build's environment wiring."""

import re
import unittest

from ..common import read_text, rendered_compose_config, repo_path


class ViewerTemplateNamesTest(unittest.TestCase):
    def test_every_template_variable_reaches_the_builder_under_the_same_name(self):
        templates = "\n".join(read_text(repo_path(path)) for path in (
            "js/apps/cam-web/index.html", "js/apps/cam-web/vite.config.js",
        ))
        names = set(re.findall(r"%([A-Z][A-Z0-9_]*)%", templates))
        self.assertTrue(names, "Viewer deployment templates must declare their variables")
        supplied = {name: f"fixture-{name}" for name in names}
        config = rendered_compose_config("compose/viewer-image.yml", env=supplied)
        forwarded = config["services"]["viewer-build"]["environment"]
        self.assertLessEqual(names, forwarded.keys())
        self.assertEqual(supplied, {name: forwarded[name] for name in names})
